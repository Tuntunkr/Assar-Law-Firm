/**
 * Builds a Word document from plain draft text, in the browser. The result is then uploaded like any
 * other file, so it is security-scanned and its text indexed like everything else.
 */
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const looksLikeHeading = (line: string) =>
  line.length > 2 &&
  line.length <= 80 &&
  line === line.toUpperCase() &&
  /[A-Z]/.test(line) &&
  !/[.;,]$/.test(line);

export async function buildDocx(title: string, text: string): Promise<File> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx');
  const children = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      looksLikeHeading(line.trim())
        ? new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
            children: [new TextRun({ text: line.trim(), bold: true })],
          })
        : new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: line })] }),
    );
  const doc = new Document({
    creator: 'Assar',
    title,
    styles: { default: { document: { run: { font: 'Calibri', size: 24 } } } },
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(doc);
  const safe =
    title
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .trim()
      .slice(0, 120) || 'Draft';
  return new File([blob], `${safe}.docx`, { type: DOCX_TYPE });
}
