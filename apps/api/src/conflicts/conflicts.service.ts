import { Injectable } from '@nestjs/common';
import {
  MatterModel,
  clients,
  compareTokens,
  conflictChecks,
  matterAccess,
  nameTokens,
  parties,
  type NameMatch,
} from '@assar/database';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';

type Req = Pick<AppRequest, 'ip' | 'id'>;

interface Match {
  matchType: 'exact' | 'similar';
  source: 'client' | 'party';
  /** Present only when the caller is allowed to see the underlying record. */
  name?: string;
  clientId?: string;
  matterId?: string;
  matterNumber?: string;
  matterTitle?: string;
  partyRole?: string;
  /** True when the match is in a matter the caller can't access: a conflict exists, details withheld. */
  restricted: boolean;
}

const MAX_MATCHES_PER_NAME = 50;

@Injectable()
export class ConflictsService {
  constructor(private readonly audit: AuditService) {}

  async check(auth: AuthContext, names: string[], req: Req) {
    const orgId = auth.organizationId;
    const owner = auth.role === 'owner';
    const myRestricted = new Set(
      owner ? [] : (await matterAccess.matterIdsFor(orgId, auth.userId)).map(String),
    );

    const results = [];
    let includesRestricted = false;
    let matchCount = 0;

    for (const query of [...new Set(names)]) {
      const tokens = nameTokens(query);
      const matches: Match[] = [];
      if (tokens.length > 0) {
        const [clientRows, partyRows] = await Promise.all([
          clients.candidatesByTokens(orgId, tokens),
          parties.candidatesByTokens(orgId, tokens),
        ]);

        const matterIds = [...new Set(partyRows.map((p) => String(p.matterId)))];
        const matterRows = matterIds.length
          ? await MatterModel.find({ organizationId: orgId, _id: { $in: matterIds } }).lean()
          : [];
        const matterById = new Map(matterRows.map((m) => [String(m._id), m]));

        for (const c of clientRows) {
          const m: NameMatch = compareTokens(tokens, c.tokens);
          if (m)
            matches.push({
              matchType: m,
              source: 'client',
              name: c.name,
              clientId: String(c._id),
              restricted: false,
            });
        }
        for (const p of partyRows) {
          const m: NameMatch = compareTokens(tokens, p.tokens);
          if (!m) continue;
          const matter = matterById.get(String(p.matterId));
          const visible =
            !!matter && (!matter.restricted || owner || myRestricted.has(String(matter._id)));
          if (visible && matter) {
            matches.push({
              matchType: m,
              source: 'party',
              name: p.name,
              partyRole: p.role,
              matterId: String(matter._id),
              matterNumber: matter.matterNumber,
              matterTitle: matter.title,
              clientId: String(matter.clientId),
              restricted: false,
            });
          } else {
            includesRestricted = true;
            matches.push({ matchType: m, source: 'party', restricted: true });
          }
        }
      }
      matches.sort((a, b) => Number(b.matchType === 'exact') - Number(a.matchType === 'exact'));
      matchCount += matches.length;
      results.push({ query, matches: matches.slice(0, MAX_MATCHES_PER_NAME) });
    }

    await conflictChecks.record({
      organizationId: orgId,
      requestedBy: auth.userId,
      names,
      matchCount,
      includesRestricted,
    });
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'conflict.checked',
      req,
      meta: { names: names.length, matchCount, includesRestricted },
    });
    return {
      checkedAt: new Date(),
      results,
      notice:
        'Automated name matching only. It can miss variants and is not a substitute for attorney review. Matches marked restricted exist in matters you cannot access; contact the responsible attorney.',
    };
  }
}
