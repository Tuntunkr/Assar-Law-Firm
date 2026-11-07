import type { Readable } from 'node:stream';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import WordExtractor from 'word-extractor';
import { extractText as pdfExtract, getDocumentProxy, renderPageAsImage } from 'unpdf';
import type { OcrEngine } from './ocr.js';

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
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ODT = 'application/vnd.oasis.opendocument.text';
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/tiff']);

/** Types we can read without OCR. Images and scanned PDFs additionally need an OCR engine. */
export const isExtractable = (contentType: string) =>
  TEXT_TYPES.has(contentType) ||
  contentType === DOCX ||
  contentType === 'application/msword' ||
  contentType === 'application/rtf' ||
  contentType === ODT ||
  contentType === XLSX ||
  contentType === 'application/pdf' ||
  IMAGES.has(contentType);

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

export type ExtractMethod = 'text' | 'ocr' | 'mixed';

export interface Extraction {
  text: string;
  /** How the text was obtained: read from the file, recognised by OCR, or both (mixed PDFs). */
  method: ExtractMethod;
  pages: number;
  ocrPages: number;
  /** Mean OCR confidence (0–100) over the pages that were recognised; null when no OCR was used. */
  confidence: number | null;
  /** True when OCR stopped at the page limit, so the tail of the document is not included. */
  truncated: boolean;
}

export interface ExtractOptions {
  /** Needed for images and for PDF pages that have no text layer. */
  ocr?: OcrEngine | null;
  /** Safety limit on OCR work per document. */
  maxOcrPages?: number;
  /** A PDF page with fewer characters than this is treated as a scan. */
  minPageChars?: number;
}

const xmlText = (xml: string) =>
  xml
    .replace(/<text:(?:line-break|tab)\/>/g, '\n')
    .replace(/<\/(?:text:p|text:h|w:p|row)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Minimal RTF-to-text: drops groups that are not body text, control words and escapes. */
export function rtfToText(rtf: string): string {
  let out = '';
  const skip = new Set([
    'fonttbl',
    'colortbl',
    'stylesheet',
    'info',
    'pict',
    'header',
    'footer',
    'footnote',
  ]);
  const stack: boolean[] = [];
  let skipping = false;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i]!;
    if (c === '{') {
      stack.push(skipping);
      const m = /^\{(\\\*)?\\([a-z]+)/.exec(rtf.slice(i, i + 24));
      // `{\*\x ...}` is an optional destination (metadata), never body text.
      if (m && (m[1] || skip.has(m[2]!))) skipping = true;
    } else if (c === '}') {
      skipping = stack.pop() ?? false;
    } else if (c === '\\') {
      const rest = rtf.slice(i + 1, i + 40);
      const hex = /^'([0-9a-f]{2})/i.exec(rest);
      const word = /^([a-z]+)(-?\d+)? ?/i.exec(rest);
      if (hex) {
        if (!skipping) out += String.fromCharCode(parseInt(hex[1]!, 16));
        i += 3;
      } else if (word) {
        if (!skipping && (word[1] === 'par' || word[1] === 'line')) out += '\n';
        if (!skipping && word[1] === 'tab') out += '\t';
        i += word[0].length;
      } else {
        if (!skipping && /[\\{}]/.test(rest[0] ?? '')) out += rest[0];
        i += 1;
      }
    } else if (!skipping && c !== '\r' && c !== '\n') {
      out += c;
    }
  }
  return out;
}

async function extractPdf(
  content: Buffer,
  o: Required<Pick<ExtractOptions, 'maxOcrPages' | 'minPageChars'>> & ExtractOptions,
): Promise<Extraction> {
  const pdf = await getDocumentProxy(new Uint8Array(content));
  const layer = (await pdfExtract(pdf, { mergePages: false })).text as string[];
  const pages = layer.map((t) => normalize(t));
  let ocrPages = 0;
  let confidenceSum = 0;
  let truncated = false;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i]!.length >= o.minPageChars) continue;
    if (!o.ocr) continue;
    if (ocrPages >= o.maxOcrPages) {
      truncated = true;
      continue;
    }
    const png = Buffer.from(
      await renderPageAsImage(pdf, i + 1, {
        canvasImport: () => import('@napi-rs/canvas'),
        scale: 2,
      }),
    );
    const r = await o.ocr.recognize(png);
    pages[i] = normalize(r.text);
    confidenceSum += r.confidence;
    ocrPages++;
  }
  const withText = pages.filter(Boolean).length;
  return {
    text: pages.filter(Boolean).join('\n\n'),
    method: ocrPages === 0 ? 'text' : ocrPages === withText ? 'ocr' : 'mixed',
    pages: pages.length,
    ocrPages,
    confidence: ocrPages ? Math.round(confidenceSum / ocrPages) : null,
    truncated,
  };
}

/**
 * Reads text from plain text, CSV, e-mail, Word (.docx and legacy .doc), RTF, OpenDocument text, Excel
 * (.xlsx), PDF and images. PDF pages without a text layer and images go through OCR when an engine is
 * supplied; without one they fail clearly instead of returning nothing. Legacy .xls is not supported.
 */
export async function extractDocument(
  content: Buffer,
  contentType: string,
  options: ExtractOptions = {},
): Promise<Extraction> {
  const o = { maxOcrPages: 40, minPageChars: 25, ...options };
  const plain = (text: string, pages = 1): Extraction => ({
    text,
    method: 'text',
    pages,
    ocrPages: 0,
    confidence: null,
    truncated: false,
  });
  let result: Extraction;
  try {
    if (TEXT_TYPES.has(contentType)) {
      result = plain(content.toString('utf8'));
    } else if (contentType === DOCX) {
      result = plain((await mammoth.extractRawText({ buffer: content })).value);
    } else if (contentType === 'application/msword') {
      result = plain((await new WordExtractor().extract(content)).getBody());
    } else if (contentType === 'application/rtf') {
      result = plain(rtfToText(content.toString('latin1')));
    } else if (contentType === ODT) {
      const zip = await JSZip.loadAsync(content);
      result = plain(xmlText(await zip.file('content.xml')!.async('string')));
    } else if (contentType === XLSX) {
      const zip = await JSZip.loadAsync(content);
      const shared = await zip.file('xl/sharedStrings.xml')?.async('string');
      const strings = [...(shared ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) =>
        xmlText(m[1]!),
      );
      result = plain(strings.join('\n'));
    } else if (contentType === 'application/pdf') {
      result = await extractPdf(content, o);
    } else if (IMAGES.has(contentType)) {
      if (!o.ocr)
        throw new ExtractionError(
          'Images need OCR, which is not enabled here',
          'UNSUPPORTED_FILE_TYPE',
        );
      const r = await o.ocr.recognize(content);
      result = {
        text: r.text,
        method: 'ocr',
        pages: 1,
        ocrPages: 1,
        confidence: Math.round(r.confidence),
        truncated: false,
      };
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
  result.text = normalize(result.text);
  if (!result.text)
    throw new ExtractionError(
      o.ocr
        ? 'No readable text was found, even with OCR'
        : 'No text could be extracted (this looks like a scan, and OCR is not enabled here)',
      'NO_TEXT_EXTRACTED',
    );
  return result;
}

/** Text only, without OCR. Kept for callers that just need the string. */
export async function extractText(content: Buffer, contentType: string): Promise<string> {
  return (await extractDocument(content, contentType)).text;
}
