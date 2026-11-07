import { copyFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';

const require = createRequire(import.meta.url);

/** Languages whose trained data ships with this package, so OCR never downloads anything. */
export const BUNDLED_OCR_LANGUAGES = ['eng', 'hin'] as const;

/**
 * Puts every requested language's trained data in one directory (tesseract.js reads them from a single
 * path). Data comes from the installed `@tesseract.js-data/*` packages: documents are never sent anywhere
 * and the worker needs no network access.
 */
export function prepareTessdata(languages: readonly string[]): string {
  const dir = join(tmpdir(), `assar-tessdata-${languages.slice().sort().join('-')}`);
  mkdirSync(dir, { recursive: true });
  for (const lang of languages) {
    const target = join(dir, `${lang}.traineddata.gz`);
    if (existsSync(target)) continue;
    let pkg: string;
    try {
      pkg = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    } catch {
      throw new Error(
        `OCR language "${lang}" is not installed. Bundled: ${BUNDLED_OCR_LANGUAGES.join(', ')}`,
      );
    }
    const source = join(pkg, '4.0.0_best_int', `${lang}.traineddata.gz`);
    try {
      symlinkSync(source, target);
    } catch {
      copyFileSync(source, target); // e.g. a file system that does not allow symlinks
    }
  }
  return dir;
}

export interface OcrResult {
  text: string;
  /** Tesseract's own 0–100 confidence for the page. */
  confidence: number;
}

/**
 * Self-hosted OCR on tesseract.js (WASM, in-process). One worker is created on first use and reused;
 * recognitions run one at a time because the engine is CPU-heavy and not re-entrant.
 */
export class OcrEngine {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  readonly languages: readonly string[];

  constructor(languages: readonly string[] = ['eng']) {
    this.languages = languages;
  }

  private get(): Promise<Worker> {
    this.worker ??= createWorker(this.languages.join('+'), 1, {
      langPath: prepareTessdata(this.languages),
      gzip: true,
      cacheMethod: 'none', // never write language data to a cache, or try to fetch it
      logger: () => undefined,
    });
    return this.worker;
  }

  /** Prepares an image for recognition: upright, grayscale, normalised contrast, a useful size. */
  static async prepare(image: Buffer): Promise<Buffer> {
    const img = sharp(image, { failOn: 'none' }).rotate(); // honour EXIF orientation
    const meta = await img.metadata();
    const width = meta.width ?? 0;
    // Tesseract is most accurate when text is roughly 30px tall: upscale small scans, cap huge ones.
    const target = width > 0 && width < 1200 ? 1600 : width > 4000 ? 3000 : undefined;
    return (target ? img.resize({ width: target }) : img).grayscale().normalise().png().toBuffer();
  }

  recognize(image: Buffer): Promise<OcrResult> {
    const run = async (): Promise<OcrResult> => {
      const [worker, png] = await Promise.all([this.get(), OcrEngine.prepare(image)]);
      const { data } = await worker.recognize(png);
      return { text: data.text, confidence: data.confidence };
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await (await w).terminate();
  }
}
