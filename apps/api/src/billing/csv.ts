/**
 * CSV writer that is safe to open in a spreadsheet. A cell that starts with = + - @ (or a tab/CR) would be
 * executed as a formula by Excel/Sheets ("CSV injection"), so it is prefixed with an apostrophe. Fields are
 * quoted and quotes doubled per RFC 4180; line breaks are normalised to spaces.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  s = s.replace(/\r\n|\r|\n/g, ' ');
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== s.trim() || s.startsWith("'")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export const csvRow = (cells: (string | number | boolean | null | undefined)[]) =>
  cells.map(csvCell).join(',');
