import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DOCX_TYPE, buildDocx } from '../src/lib/docx';

const read = (f: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(f);
  });

describe('buildDocx', () => {
  it('makes a real Word file with the draft text, headings and a safe file name', async () => {
    const file = await buildDocx(
      'Legal notice: Acme/Landlord?',
      'LEGAL NOTICE\nDear Sir,\n\nPay rent of 5,000 & more.\nTHE END.',
    );
    expect(file.type).toBe(DOCX_TYPE);
    expect(file.name).toBe('Legal notice_ Acme_Landlord_.docx');
    const zip = await JSZip.loadAsync(await read(file));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Dear Sir,');
    expect(xml).toContain('Pay rent of 5,000 &amp; more.'); // escaped, so it cannot break the XML
    expect(xml).toContain('LEGAL NOTICE');
    expect(xml).toMatch(/<w:b\/>/); // the all-caps line is bold
  });

  it('survives an empty draft and a very long title', async () => {
    const file = await buildDocx('x'.repeat(300), '');
    expect(file.name.length).toBeLessThanOrEqual(125);
    expect(file.size).toBeGreaterThan(0);
  });
});
