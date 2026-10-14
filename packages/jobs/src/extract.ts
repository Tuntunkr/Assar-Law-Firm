import type { Readable } from 'node:stream';
import mammoth from 'mammoth';
import { extractText as pdfExtract, getDocumentProxy } from 'unpdf';

/** Non-retryable: the same file will fail the same way. */
export class ExtractionError extends Error {
  readonly retryable = false;
  constructor(
    message: string,
    public readonly code:
      'UNSUPPORTED_FILE_TYPE' | 'NO_TEXT_EXTRACTED' | 'FILE_TOO_LARGE_FOR_AI' | 'EXTRACTION_FAILED',
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'message/rfc822']);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const isExtractable = (contentType: string) =>
  TEXT_TYPES.has(contentType) || contentType === DOCX || contentType === 'application/pdf';

export async function readCapped(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new ExtractionError('File is too large to analyse', 'FILE_TOO_LARGE_FOR_AI');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

const normalize = (t: string) =>
  t
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Plain text, CSV, e-mail, DOCX and text-based PDF are supported. Scanned images/PDFs need OCR,
 * which is not supported, and legacy .doc/.xls/.rtf/.odt are not extracted yet: those fail clearly
 * instead of sending the model nothing.
 */
export async function extractText(content: Buffer, contentType: string): Promise<string> {
  let text: string;
  try {
    if (TEXT_TYPES.has(contentType)) {
      text = content.toString('utf8');
    } else if (contentType === DOCX) {
      text = (await mammoth.extractRawText({ buffer: content })).value;
    } else if (contentType === 'application/pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(content));
      text = (await pdfExtract(pdf, { mergePages: true })).text;
    } else {
      throw new ExtractionError(
        `Text extraction is not supported for ${contentType}`,
        'UNSUPPORTED_FILE_TYPE',
      );
    }
  } catch (e) {
    if (e instanceof ExtractionError) throw e;
    throw new ExtractionError('The document could not be read', 'EXTRACTION_FAILED');
  }
  text = normalize(text);
  if (!text)
    throw new ExtractionError(
      'No text could be extracted (scanned documents need OCR, which is not supported)',
      'NO_TEXT_EXTRACTED',
    );
  return text;
}
