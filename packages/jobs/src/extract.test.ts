import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ExtractionError, extractText, isExtractable, readCapped } from './extract.js';

async function docx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** A minimal single-page text PDF (xref is rebuilt by the parser). */
function pdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF`,
  );
}

describe('extractText', () => {
  it('reads plain text, CSV and e-mail, normalising line endings and blank runs', async () => {
    expect(
      await extractText(Buffer.from('Line one\r\n\r\n\r\n\r\nLine two\0  '), 'text/plain'),
    ).toBe('Line one\n\nLine two');
    expect(await extractText(Buffer.from('a,b\n1,2'), 'text/csv')).toBe('a,b\n1,2');
    expect(await extractText(Buffer.from('Subject: Hi\n\nBody'), 'message/rfc822')).toContain(
      'Body',
    );
  });

  it('reads DOCX paragraphs', async () => {
    const text = await extractText(
      await docx(['First clause.', 'Second clause.']),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(text).toBe('First clause.\n\nSecond clause.');
  });

  it('reads text-based PDFs', async () => {
    expect(
      await extractText(pdf('Payment is due within thirty days'), 'application/pdf'),
    ).toContain('Payment is due within thirty days');
  });

  it('fails clearly (not silently) for unsupported, empty and corrupt files', async () => {
    await expect(extractText(Buffer.from('x'), 'application/vnd.ms-excel')).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE',
      retryable: false,
    });
    // An image without an OCR engine cannot be read, and says so.
    await expect(extractText(Buffer.from('image/png'), 'image/png')).rejects.toBeInstanceOf(
      ExtractionError,
    );
    await expect(extractText(Buffer.from('  \n '), 'text/plain')).rejects.toMatchObject({
      code: 'NO_TEXT_EXTRACTED',
    });
    await expect(
      extractText(
        Buffer.from('not a zip'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    await expect(extractText(Buffer.from('not a pdf'), 'application/pdf')).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
    });
  });

  it('knows which types it can read', () => {
    expect(isExtractable('application/pdf')).toBe(true);
    expect(isExtractable('image/tiff')).toBe(true);
    expect(isExtractable('application/vnd.ms-excel')).toBe(false);
  });
});

describe('readCapped', () => {
  it('reads streams up to the limit and refuses larger ones', async () => {
    expect(
      (await readCapped(Readable.from([Buffer.from('abc'), Buffer.from('def')]), 10)).toString(),
    ).toBe('abcdef');
    await expect(
      readCapped(Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), 10),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE_FOR_AI' });
  });
});
