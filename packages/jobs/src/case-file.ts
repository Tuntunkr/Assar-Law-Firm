import {
  clients,
  MatterModel,
  MembershipModel,
  timeline,
  userCanAccessMatter,
} from '@assar/database';
import { hasPermission } from '@assar/types';
import { JobFailure } from './errors.js';

const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : '—';

export interface CaseFile {
  text: string;
  matters: number;
  truncated: boolean;
}

/**
 * The client's case file as plain text: every matter the requester may see, with court details and recent
 * history. This is the model's only source for a case-history summary, so every claim can be checked
 * against it. Matters the requester cannot see are not mentioned at all (not even as a count).
 */
export async function buildCaseFile(
  organizationId: string,
  clientId: string,
  requesterId: string,
  maxChars: number,
): Promise<CaseFile> {
  const [membership, client] = await Promise.all([
    MembershipModel.findOne({ organizationId, userId: requesterId, status: 'active' })
      .select('role')
      .lean(),
    clients.findById(organizationId, clientId),
  ]);
  if (
    !membership ||
    !hasPermission(membership.role, 'client:read') ||
    !hasPermission(membership.role, 'matter:read')
  )
    throw new JobFailure('The requester can no longer read client files', 'ACCESS_REVOKED', false);
  if (!client)
    throw new JobFailure('The client is no longer available', 'SOURCE_UNAVAILABLE', false);

  const all = await MatterModel.find({ organizationId, clientId })
    .sort({ openedAt: 1 })
    .limit(100)
    .lean();
  const visible: typeof all = [];
  for (const m of all)
    if (await userCanAccessMatter(organizationId, m._id, requesterId)) visible.push(m);
  if (visible.length === 0)
    throw new JobFailure(
      'There are no visible matters to summarise for this client',
      'SOURCE_UNAVAILABLE',
      false,
    );

  const hidden = all.filter((m) => !visible.includes(m)).map((m) => m._id);
  const header = `CASE FILE for client "${client.name}" (${client.type}). Generated ${day(new Date())}.\n`;

  // Per-matter budget; the oldest history is dropped first when it does not fit.
  const budget = Math.max(2000, Math.floor((maxChars - header.length) / visible.length));
  let truncated = false;
  const blocks: string[] = [];
  for (const m of visible) {
    const entries = await timeline.forMatters(organizationId, [m._id], {
      limit: 60,
      hiddenMatterIds: hidden,
    });
    const court = m.court
      ? [
          m.court.name,
          m.court.caseNumber && `case no. ${m.court.caseNumber}`,
          m.court.judge && `judge ${m.court.judge}`,
          m.court.courtroom && `courtroom ${m.court.courtroom}`,
          m.court.jurisdiction,
          m.court.filedOn && `filed ${m.court.filedOn}`,
        ]
          .filter(Boolean)
          .join('; ')
      : null;
    const head = [
      `MATTER ${m.matterNumber}: ${m.title}`,
      `Practice area: ${m.practiceArea.replace(/_/g, ' ')}. Status: ${m.status}. Opened: ${day(m.openedAt)}${m.closedAt ? `. Closed: ${day(m.closedAt)}` : ''}.`,
      court ? `Court: ${court}.` : null,
      m.description ? `Description: ${m.description}` : null,
      'History (newest first):',
    ]
      .filter(Boolean)
      .join('\n');
    const lines = entries.map((e) => `- ${day(e.at)} ${e.title}${e.detail ? `: ${e.detail}` : ''}`);
    let body = `${head}\n${lines.join('\n')}`;
    while (body.length > budget && lines.length > 0) {
      lines.pop(); // oldest last
      truncated = true;
      body = `${head}\n${lines.join('\n')}`;
    }
    blocks.push(body.slice(0, budget));
  }
  return { text: `${header}\n${blocks.join('\n\n')}`, matters: visible.length, truncated };
}
