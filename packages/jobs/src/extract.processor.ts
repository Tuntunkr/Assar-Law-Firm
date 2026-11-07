import { UnrecoverableError, type Job } from 'bullmq';
import { audit, documentTexts, documentVersions } from '@assar/database';
import type { StorageService } from '@assar/storage';
import { ExtractionError, extractDocument, readCapped } from './extract.js';
import type { ExtractJobData, JobLogger } from './names.js';
import type { OcrEngine } from './ocr.js';

export interface ExtractProcessorDeps {
  storage: StorageService;
  logger: JobLogger;
  /** Omit to disable OCR: scans then fail with a clear message instead of being skipped silently. */
  ocr?: OcrEngine | null;
  maxBytes: number;
  maxOcrPages: number;
  /** Development only: also read versions the scanner skipped because scanning is switched off. */
  allowUnscanned: boolean;
}

/**
 * Reads a version's text and stores it. Only versions that passed the security scan are opened.
 * Content problems (unsupported type, no text, corrupt file) are final and recorded on the row;
 * other errors (storage or database hiccups) are retried by the queue.
 */
export function createExtractProcessor(deps: ExtractProcessorDeps) {
  return async (job: Job<ExtractJobData>): Promise<void> => {
    const { organizationId: org, versionId } = job.data;
    const v = await documentVersions.findById(org, versionId);
    if (!v) return;
    const readable = v.status === 'clean' || (v.status === 'skipped' && deps.allowUnscanned);
    if (!readable) return; // never open a file that has not been cleared

    await documentTexts.start({
      organizationId: v.organizationId,
      matterId: v.matterId,
      documentId: v.documentId,
      version: v.version,
      versionId: v._id,
    });
    await documentTexts.setProcessing(org, v._id);

    try {
      const bytes = await readCapped(await deps.storage.read(v.storageKey), deps.maxBytes);
      const r = await extractDocument(bytes, v.contentType, {
        ocr: deps.ocr,
        maxOcrPages: deps.maxOcrPages,
      });
      await documentTexts.save(org, v._id, r);
      await audit.record({
        organizationId: v.organizationId,
        actorId: null,
        action: 'document.text_extracted',
        targetType: 'document_version',
        targetId: String(v._id),
        // Metadata only: never any of the text.
        meta: {
          documentId: String(v.documentId),
          version: v.version,
          method: r.method,
          pages: r.pages,
          ocrPages: r.ocrPages,
          confidence: r.confidence,
          chars: r.text.length,
          truncated: r.truncated,
        },
      } as never);
    } catch (err) {
      if (err instanceof ExtractionError) {
        // Final: the same file will fail the same way.
        await documentTexts.fail(org, v._id, { code: err.code, message: err.message });
        await audit.record({
          organizationId: v.organizationId,
          actorId: null,
          action: 'document.text_failed',
          targetType: 'document_version',
          targetId: String(v._id),
          meta: { documentId: String(v.documentId), version: v.version, code: err.code },
        } as never);
        return;
      }
      const isLast = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      deps.logger.warn(
        {
          versionId,
          attempt: job.attemptsMade + 1,
          final: isLast,
          error: (err as Error).message?.slice(0, 200),
        },
        'text extraction attempt failed',
      );
      if (!isLast) throw err;
      await documentTexts.fail(org, v._id, {
        code: 'EXTRACTION_FAILED',
        message: 'The text could not be read after several attempts',
      });
      throw new UnrecoverableError('text extraction failed after all attempts');
    }
  };
}
