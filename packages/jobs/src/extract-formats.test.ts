import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractDocument, rtfToText } from './extract.js';

const zipOf = async (files: Record<string, string>) => {
  const z = new JSZip();
  for (const [name, body] of Object.entries(files)) z.file(name, body);
  return z.generateAsync({ type: 'nodebuffer' });
};

describe('RTF', () => {
  it('keeps body text and paragraph breaks, drops fonts, colours and control words', async () => {
    const rtf =
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0\\fs24 Notice of \\b Termination\\b0\\par Dated 4 March 2026\\par Caf\\'e9 \\{braces\\}\\par}";
    expect(rtfToText(rtf)).toBe('Notice of Termination\nDated 4 March 2026\nCafé {braces}\n');
    const r = await extractDocument(Buffer.from(rtf, 'latin1'), 'application/rtf');
    expect(r).toMatchObject({ method: 'text', ocrPages: 0, confidence: null });
    expect(r.text).not.toMatch(/Times New Roman|fonttbl|\\par/);
  });
});

describe('OpenDocument and Excel', () => {
  it('reads ODT paragraphs and headings in order', async () => {
    const odt = await zipOf({
      'content.xml':
        '<office:document-content xmlns:office="o" xmlns:text="t"><office:body><office:text><text:h>Heading</text:h><text:p>First <text:span>clause</text:span> &amp; more.</text:p><text:p>Second.</text:p></office:text></office:body></office:document-content>',
    });
    const r = await extractDocument(odt, 'application/vnd.oasis.opendocument.text');
    expect(r.text).toBe('Heading\nFirst clause & more.\nSecond.');
  });

  it('reads the text cells of an XLSX workbook', async () => {
    const xlsx = await zipOf({
      'xl/sharedStrings.xml':
        '<sst><si><t>Client</t></si><si><t>Acme &amp; Sons</t></si><si><t xml:space="preserve">Amount due</t></si></sst>',
    });
    const r = await extractDocument(
      xlsx,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(r.text).toBe('Client\nAcme & Sons\nAmount due');
  });

  it('reports a damaged legacy .doc as unreadable rather than returning garbage', async () => {
    await expect(
      extractDocument(Buffer.from('this is not a Word file'), 'application/msword'),
    ).rejects.toMatchObject({ code: 'EXTRACTION_FAILED', retryable: false });
  });
});
