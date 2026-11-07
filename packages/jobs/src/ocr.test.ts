import { existsSync } from 'node:fs';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { extractDocument } from './extract.js';
import { OcrEngine, prepareTessdata } from './ocr.js';

/**
 * The generic family `sans-serif` on this machine drew a face whose letters "is"
 * Tesseract read as "1s" (confidence 93) after the existing 700→1600 upscale.
 * The same pixels drawn in Liberation Sans or DejaVu Sans Bold read as "is".
 * The fixture registers one of those files so the assertion checks recognition,
 * not whichever face the host maps to sans-serif. The upscale itself is unchanged.
 */
const FIXTURE_FONT = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
].find((p) => existsSync(p));
if (!FIXTURE_FONT) {
  throw new Error(
    'OCR fixture font missing. Install fonts-liberation or fonts-dejavu. The test does not fall back to sans-serif.',
  );
}
GlobalFonts.registerFromPath(FIXTURE_FONT, 'AssarOcr');

/** Draws lines of text on a white page, like a clean scan. */
function scan(lines: string[], o: { width?: number; rotate?: boolean } = {}) {
  const width = o.width ?? 1400;
  const canvas = createCanvas(width, 140 + lines.length * 90);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 48px AssarOcr';
  lines.forEach((l, i) => ctx.fillText(l, 60, 100 + i * 90));
  return canvas;
}
const png = (lines: string[], o?: { width?: number }) => scan(lines, o).toBuffer('image/png');
const jpeg = (lines: string[]) => scan(lines).toBuffer('image/jpeg');

/** A PDF whose pages are listed in order: `{ text }` has a text layer, `{ jpeg }` is a picture only. */
function buildPdf(pages: ({ text: string } | { jpeg: Buffer; w: number; h: number })[]): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (b: string | Buffer) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    parts.push(buf);
    length += buf.length;
  };
  const obj = (n: number, body: string | Buffer[]) => {
    offsets[n] = length;
    add(`${n} 0 obj\n`);
    if (typeof body === 'string') add(body);
    else body.forEach(add);
    add('\nendobj\n');
  };
  add('%PDF-1.4\n');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<</Type/Catalog/Pages 2 0 R>>');
  obj(2, `<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>`);
  pages.forEach((p, i) => {
    const page = 3 + i * 3;
    if ('text' in p) {
      const stream = `BT /F1 14 Tf 72 700 Td (${p.text}) Tj ET`;
      obj(
        page,
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${page + 1} 0 R/Resources<</Font<</F1 ${page + 2} 0 R>>>>>>`,
      );
      obj(page + 1, `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
      obj(page + 2, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
    } else {
      const h = Math.round((612 * p.h) / p.w); // keep the picture's aspect ratio
      const draw = `q 612 0 0 ${h} 0 ${792 - h} cm /Im0 Do Q`;
      obj(
        page,
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${page + 1} 0 R/Resources<</XObject<</Im0 ${page + 2} 0 R>>>>>>`,
      );
      obj(page + 1, `<</Length ${draw.length}>>\nstream\n${draw}\nendstream`);
      obj(page + 2, [
        Buffer.from(
          `<</Type/XObject/Subtype/Image/Width ${p.w}/Height ${p.h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${p.jpeg.length}>>\nstream\n`,
        ),
        p.jpeg,
        Buffer.from('\nendstream'),
      ]);
    }
  });
  const xref = length;
  const count = 3 + pages.length * 3;
  add(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) add(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<</Root 1 0 R/Size ${count}>>\nstartxref\n${xref}\n%%EOF`);
  return Buffer.concat(parts);
}

const ocr = new OcrEngine(['eng']);
afterAll(() => ocr.close());
const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

describe('OCR (self-hosted Tesseract)', () => {
  it('uses bundled language data, with nothing downloaded', () => {
    const dir = prepareTessdata(['eng', 'hin']);
    expect(dir).toContain('assar-tessdata');
    expect(() => prepareTessdata(['xyz'])).toThrow(/not installed/);
  });

  it('reads a scanned image (PNG and JPEG) and reports confidence', async () => {
    const lines = [
      'LEGAL NOTICE OF TERMINATION',
      'Tenant shall vacate within thirty days',
      'Dated 4 March 2026',
    ];
    for (const [buf, type] of [
      [png(lines), 'image/png'],
      [jpeg(lines), 'image/jpeg'],
    ] as const) {
      const r = await extractDocument(buf, type, { ocr });
      expect(r).toMatchObject({ method: 'ocr', pages: 1, ocrPages: 1 });
      expect(r.confidence).toBeGreaterThan(70);
      const t = words(r.text);
      expect(t).toContain('legal notice');
      expect(t).toContain('thirty days');
      expect(t).toContain('march 2026');
    }
  }, 60_000);

  it('upscales small images so low-resolution scans are still readable', async () => {
    const src = png(['Rent is 5000 per month'], { width: 700 });
    const prepared = await sharp(await OcrEngine.prepare(src)).metadata();
    expect(prepared.width).toBeGreaterThan(700);
    const r = await extractDocument(src, 'image/png', { ocr });
    expect(words(r.text)).toContain('rent is 5000');
  }, 60_000);

  it('OCRs only the pages of a PDF that have no text layer (mixed document)', async () => {
    const pdf = buildPdf([
      { text: 'Page one has a normal text layer with enough characters' },
      { jpeg: jpeg(['SCANNED PAGE TWO', 'Governing law is India']), w: 1400, h: 320 },
    ]);
    const r = await extractDocument(pdf, 'application/pdf', { ocr });
    expect(r).toMatchObject({ method: 'mixed', pages: 2, ocrPages: 1 });
    const t = words(r.text);
    expect(t).toContain('normal text layer');
    expect(t).toContain('scanned page two');
    expect(t).toContain('governing law');
  }, 90_000);

  it('treats a fully scanned PDF as OCR, and a text PDF never touches OCR', async () => {
    const scanned = await extractDocument(
      buildPdf([
        { jpeg: jpeg(['ENGAGEMENT LETTER', 'Fees are payable monthly']), w: 1400, h: 320 },
      ]),
      'application/pdf',
      { ocr },
    );
    expect(scanned).toMatchObject({ method: 'ocr', ocrPages: 1 });
    expect(words(scanned.text)).toContain('engagement letter');

    const text = await extractDocument(
      buildPdf([{ text: 'Plain text only document with plenty of characters' }]),
      'application/pdf',
      { ocr },
    );
    expect(text).toMatchObject({ method: 'text', ocrPages: 0, confidence: null });
  }, 90_000);

  it('stops at the OCR page limit and says the result is partial', async () => {
    const page = { jpeg: jpeg(['SCAN PAGE']), w: 1400, h: 230 };
    const r = await extractDocument(buildPdf([page, page, page]), 'application/pdf', {
      ocr,
      maxOcrPages: 2,
    });
    expect(r).toMatchObject({ pages: 3, ocrPages: 2, truncated: true });
  }, 90_000);

  it('fails clearly for a scan without an engine, and for a blank page even with one', async () => {
    const scanned = buildPdf([{ jpeg: jpeg(['SCANNED']), w: 1400, h: 230 }]);
    await expect(extractDocument(scanned, 'application/pdf')).rejects.toMatchObject({
      code: 'NO_TEXT_EXTRACTED',
      message: expect.stringMatching(/OCR is not enabled/),
    });
    const blank = createCanvas(800, 400);
    const ctx = blank.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 800, 400);
    await expect(
      extractDocument(blank.toBuffer('image/png'), 'image/png', { ocr }),
    ).rejects.toMatchObject({
      code: 'NO_TEXT_EXTRACTED',
    });
  }, 60_000);

  // Needs a system font with Devanagari glyphs to draw the test page; otherwise there is nothing to read.
  const devanagari = [
    'Kohinoor Devanagari',
    'Devanagari Sangam MN',
    'Noto Sans Devanagari',
    'Lohit Devanagari',
    'Mangal',
  ].find((f) => GlobalFonts.has(f));
  it.skipIf(!devanagari)(
    'reads Hindi when that language is enabled',
    async () => {
      const hin = new OcrEngine(['eng', 'hin']);
      try {
        const canvas = createCanvas(1400, 200);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 1400, 200);
        ctx.fillStyle = '#000';
        ctx.font = `bold 64px "${devanagari}"`;
        ctx.fillText('कानूनी नोटिस', 60, 120);
        const r = await extractDocument(canvas.toBuffer('image/png'), 'image/png', { ocr: hin });
        expect(r.text).toMatch(/[ऀ-ॿ]/); // Devanagari characters were recognised
      } finally {
        await hin.close();
      }
    },
    90_000,
  );
});
