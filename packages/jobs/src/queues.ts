import { Queue, type JobsOptions } from 'bullmq';
import { QUEUE_NAMES, type AiJobData, type ScanJobData } from './names.js';
import { parseRedisUrl } from './redis.js';

export interface JobQueuesOptions {
  redisUrl: string;
  /** Key prefix; tests use a unique one so runs never see each other's jobs. */
  prefix?: string;
  scanAttempts?: number;
  /** Base for exponential backoff between retries. */
  backoffDelayMs?: number;
}

const COMPLETED = { age: 3600, count: 1000 };
const FAILED = { age: 7 * 24 * 3600, count: 5000 };

/** Producer side: used by the API. Workers consume with {@link startWorkers}. */
export class JobQueues {
  readonly scan: Queue<ScanJobData>;
  readonly ai: Queue<AiJobData>;
  readonly prefix: string;

  constructor(private readonly options: JobQueuesOptions) {
    this.prefix = options.prefix ?? 'bull';
    const connection = parseRedisUrl(options.redisUrl);
    this.scan = new Queue(QUEUE_NAMES.scan, { connection, prefix: this.prefix });
    this.ai = new Queue(QUEUE_NAMES.ai, { connection, prefix: this.prefix });
    // Connection errors are surfaced through health checks; don't crash the process on a blip.
    this.scan.on('error', () => undefined);
    this.ai.on('error', () => undefined);
  }

  private opts(attempts: number): JobsOptions {
    return {
      attempts,
      backoff: { type: 'exponential', delay: this.options.backoffDelayMs ?? 5000 },
      removeOnComplete: COMPLETED,
      removeOnFail: FAILED,
    };
  }

  /** `run` makes the id unique per dispatch so a re-scan isn't deduplicated against an old job. */
  enqueueScan(data: ScanJobData, run: string) {
    return this.scan.add('scan', data, {
      ...this.opts(this.options.scanAttempts ?? 3),
      jobId: `scan-${data.versionId}-${run}`,
    });
  }

  enqueueAi(data: AiJobData, runNumber: number, attempts: number) {
    return this.ai.add('ai', data, {
      ...this.opts(attempts),
      jobId: `ai-${data.aiJobId}-${runNumber}`,
    });
  }

  /** Removes a job that hasn't started. Returns false if it is already running or gone. */
  async removeWaitingAi(aiJobId: string, runNumber: number): Promise<boolean> {
    const job = await this.ai.getJob(`ai-${aiJobId}-${runNumber}`);
    if (!job) return false;
    const state = await job.getState();
    if (state !== 'waiting' && state !== 'delayed' && state !== 'prioritized') return false;
    try {
      await job.remove();
      return true;
    } catch {
      return false; // picked up by a worker in the meantime
    }
  }

  async counts() {
    const names = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;
    const [scan, ai] = await Promise.all([
      this.scan.getJobCounts(...names),
      this.ai.getJobCounts(...names),
    ]);
    return { scan, ai };
  }

  /** Throws if Redis is unreachable (or doesn't answer within `timeoutMs`). */
  async ping(timeoutMs = 2000): Promise<void> {
    await Promise.race([
      this.scan.getJobCounts('waiting'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('redis ping timed out')), timeoutMs).unref(),
      ),
    ]);
  }

  async close() {
    await Promise.all([this.scan.close(), this.ai.close()]);
  }
}
