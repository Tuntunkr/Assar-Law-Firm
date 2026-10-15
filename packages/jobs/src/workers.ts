import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { aiJobs, audit, documentVersions } from '@assar/database';
import type { ScanProvider, StorageService } from '@assar/storage';
import { createAiProcessor } from './ai.processor.js';
import { createEventsProcessor } from './events.processor.js';
import type { GrokClient } from './grok.js';
import {
  QUEUE_NAMES,
  type AiJobData,
  type EventSink,
  type JobLogger,
  type ScanJobData,
  type WorkflowEventData,
} from './names.js';
import { parseRedisUrl } from './redis.js';
import { createScanProcessor } from './scan.processor.js';

export interface WorkersConfig {
  redisUrl: string;
  prefix?: string;
  logger: JobLogger;
  storage: StorageService;
  scanProvider: ScanProvider;
  /** Omit to run without AI (AI jobs then stay queued; the API should have AI disabled). */
  grok?: GrokClient | null;
  /** Where processors announce events (e.g. a JobQueues with events enabled). */
  events?: EventSink;
  /** Deliver queued workflow events to the n8n webhooks under this base URL. Omit to leave the events queue unprocessed. */
  deliverEvents?: { baseUrl: string; secret: string; timeoutMs?: number };
  scanConcurrency?: number;
  aiConcurrency?: number;
  maxContextChars?: number;
  maxExtractBytes?: number;
  allowUnscanned?: boolean;
  /** How long a job may go without a lock renewal before it is considered stalled (crashed worker). */
  stalledIntervalMs?: number;
}

export interface WorkerStats {
  scan: { completed: number; failed: number };
  ai: { completed: number; failed: number };
  events: { completed: number; failed: number };
  aiEnabled: boolean;
  eventsEnabled: boolean;
  paused: boolean;
}

export interface WorkerHandle {
  stats(): WorkerStats;
  pause(): Promise<void>;
  resume(): void;
  /** Waits for in-flight jobs, then disconnects. */
  close(): Promise<void>;
}

export function startWorkers(cfg: WorkersConfig): WorkerHandle {
  const connection = { ...parseRedisUrl(cfg.redisUrl), maxRetriesPerRequest: null };
  const common = {
    connection,
    prefix: cfg.prefix ?? 'bull',
    stalledInterval: cfg.stalledIntervalMs ?? 30_000,
  };
  const counters = {
    scan: { completed: 0, failed: 0 },
    ai: { completed: 0, failed: 0 },
    events: { completed: 0, failed: 0 },
  };
  let paused = false;

  const scanWorker = new Worker<ScanJobData>(
    QUEUE_NAMES.scan,
    createScanProcessor({
      storage: cfg.storage,
      provider: cfg.scanProvider,
      logger: cfg.logger,
      events: cfg.events,
    }),
    { ...common, concurrency: cfg.scanConcurrency ?? 4 },
  );

  const aiWorker = cfg.grok
    ? new Worker<AiJobData>(
        QUEUE_NAMES.ai,
        createAiProcessor({
          grok: cfg.grok,
          storage: cfg.storage,
          logger: cfg.logger,
          maxContextChars: cfg.maxContextChars ?? 120_000,
          maxExtractBytes: cfg.maxExtractBytes ?? 25 * 1024 * 1024,
          allowUnscanned: cfg.allowUnscanned ?? false,
          events: cfg.events,
        }),
        { ...common, concurrency: cfg.aiConcurrency ?? 2 },
      )
    : null;

  const eventsWorker = cfg.deliverEvents
    ? new Worker<WorkflowEventData>(
        QUEUE_NAMES.events,
        createEventsProcessor({ ...cfg.deliverEvents, logger: cfg.logger }),
        { ...common, concurrency: 4 },
      )
    : null;

  const wire = (w: Worker, kind: 'scan' | 'ai' | 'events') => {
    w.on('completed', () => counters[kind].completed++);
    w.on('failed', (job, err) => {
      counters[kind].failed++;
      void markDeadIfStalled(kind, job, err);
    });
    w.on('error', (err) => cfg.logger.error({ queue: kind, error: err.message }, 'worker error'));
  };
  wire(scanWorker, 'scan');
  if (aiWorker) wire(aiWorker, 'ai');
  if (eventsWorker) wire(eventsWorker, 'events');

  /**
   * Safety net: if BullMQ gives up on a job that our processor never got to finish (e.g. the worker
   * crashed repeatedly and the job exceeded its stall limit), make the database say so.
   */
  async function markDeadIfStalled(
    kind: 'scan' | 'ai' | 'events',
    job: Job | undefined,
    err: Error,
  ) {
    if (kind === 'events') return; // events have no database record to repair
    if (!job || err instanceof UnrecoverableError || !/stalled/i.test(err.message)) return;
    try {
      if (kind === 'ai') {
        const d = job.data as AiJobData;
        await aiJobs.transition(d.organizationId, d.aiJobId, ['queued', 'processing'], {
          status: 'failed',
          stage: null,
          finishedAt: new Date(),
          error: {
            code: 'WORKER_STALLED',
            message: 'The worker stopped responding while processing this job',
            retryable: true,
          },
        });
      } else {
        const d = job.data as ScanJobData;
        await documentVersions.transition(d.organizationId, d.versionId, ['scanning'], {
          status: 'scan_failed',
        });
        await audit.record({
          organizationId: d.organizationId,
          actorId: null,
          action: 'document.scan_failed',
          targetType: 'document_version',
          targetId: d.versionId,
        } as never);
      }
    } catch (e) {
      cfg.logger.error({ error: (e as Error).message }, 'failed to record stalled job');
    }
  }

  return {
    stats: () => ({
      scan: { ...counters.scan },
      ai: { ...counters.ai },
      events: { ...counters.events },
      aiEnabled: !!aiWorker,
      eventsEnabled: !!eventsWorker,
      paused,
    }),
    async pause() {
      paused = true;
      await Promise.all([scanWorker.pause(), aiWorker?.pause(), eventsWorker?.pause()]);
    },
    resume() {
      paused = false;
      scanWorker.resume();
      aiWorker?.resume();
      eventsWorker?.resume();
    },
    async close() {
      await Promise.all([scanWorker.close(), aiWorker?.close(), eventsWorker?.close()]);
    },
  };
}
