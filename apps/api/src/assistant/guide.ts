import type { Permission } from '@assar/types';

export interface GuideChunk {
  id: string;
  title: string;
  permission: Permission | null;
  text: string;
}

/** One hand-written chunk per dashboard module. */
export const guideChunks: readonly GuideChunk[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    permission: null,
    text: 'The Dashboard is your home screen. It gathers open matters, tasks, and upcoming dates for the firm. Open this screen first each day to see what needs attention.',
  },
  {
    id: 'calendar',
    title: 'Calendar',
    permission: 'calendar:write',
    text: 'Calendar lists hearings, meetings, and deadlines. Schedule the next hearing from this screen. Each entry shows the date and the linked matter.',
  },
  {
    id: 'tasks',
    title: 'Tasks',
    permission: 'task:write',
    text: 'Tasks lists work the firm still has to finish. Add a task, set the due date, and mark it done when the work is finished. Open a task to see who owns it.',
  },
  {
    id: 'clients',
    title: 'Clients',
    permission: 'client:read',
    text: 'Clients keeps the people and organizations your firm represents. The roster lists every client. Open one client to see contact details and linked matters.',
  },
  {
    id: 'matters',
    title: 'Matters',
    permission: 'matter:read',
    text: 'Matters is the case file for one engagement. The docket shows the court, the parties, the timeline, and the tasks on that matter. Open a matter to follow the case.',
  },
  {
    id: 'documents',
    title: 'Documents',
    permission: 'document:read',
    text: 'Documents holds the files stored on a matter. Upload a file, read the extracted text, and download the stored copy. Each file stays with the matter it belongs to.',
  },
  {
    id: 'templates',
    title: 'Templates',
    permission: 'document:read',
    text: 'Templates are reusable starters for firm documents. Pick a template, fill the fields, and generate a draft for the matter. Drafts stay editable after generation.',
  },
  {
    id: 'ai',
    title: 'AI Copilot',
    permission: 'ai:use',
    text: 'AI Copilot reads documents you already stored and drafts a chronology, a summary, or a clause note. Every result stays a draft until a person approves it.',
  },
  {
    id: 'conflicts',
    title: 'Conflict check',
    permission: 'conflict:check',
    text: 'Conflict check compares a new person with existing clients and adverse names before the firm opens a matter. Run it before you accept work.',
  },
  {
    id: 'time',
    title: 'Time tracking',
    permission: 'time:write',
    text: 'Time tracking records hours worked on a matter. Enter the date, the duration, and a short note. The firm uses these entries when it prepares bills.',
  },
  {
    id: 'invoices',
    title: 'Invoices',
    permission: 'billing:read',
    text: 'Invoices lists bills sent to clients. To issue an invoice, open this screen, pick the matter, confirm the amount, and send it. You can also review payment state here.',
  },
  {
    id: 'reports',
    title: 'Reports',
    permission: 'billing:read',
    text: 'Reports sums fees, payments, and outstanding balances. Filter by date range to see how the firm is collecting. This screen is for reading numbers, not editing bills.',
  },
  {
    id: 'team',
    title: 'Team',
    permission: 'user:manage',
    text: 'Team manages firm members and invitations. Owners and admins add people here and choose the role each person holds.',
  },
  {
    id: 'audit',
    title: 'Audit log',
    permission: 'audit:read',
    text: 'The audit log lists sensitive actions inside the firm, with who did the action and when it happened. Use this screen to review changes after the fact.',
  },
  {
    id: 'settings',
    title: 'Settings',
    permission: null,
    text: 'Settings holds the firm profile, billing preferences, and automation. A section appears only when your role is allowed to change it.',
  },
];

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** Drop chunks the caller cannot open, then pick the chunk with the most shared words. */
export function searchGuide(query: string, permissions: Permission[]): GuideChunk | null {
  const queryWords = words(query);
  let best: GuideChunk | null = null;
  let bestScore = 0;
  for (const chunk of guideChunks) {
    if (chunk.permission !== null && !permissions.includes(chunk.permission)) continue;
    const chunkWords = words(`${chunk.title} ${chunk.text}`);
    let score = 0;
    for (const word of queryWords) {
      if (chunkWords.has(word)) score += 1;
    }
    if (score > bestScore) {
      best = chunk;
      bestScore = score;
    }
  }
  return best;
}
