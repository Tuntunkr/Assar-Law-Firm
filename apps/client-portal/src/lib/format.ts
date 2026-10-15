const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
export const formatDate = (iso: string) => date.format(new Date(iso));

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  pending: 'Pending',
  closed: 'Closed',
  archived: 'Archived',
};
export const AREA_LABEL: Record<string, string> = {
  litigation: 'Litigation',
  corporate: 'Corporate',
  family: 'Family',
  real_estate: 'Real estate',
  employment: 'Employment',
  intellectual_property: 'Intellectual property',
  criminal: 'Criminal',
  immigration: 'Immigration',
  tax: 'Tax',
  other: 'Other',
};
