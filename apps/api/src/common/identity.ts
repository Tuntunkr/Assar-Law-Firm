import { memberships, teams } from '@assar/database';

/** Names for active members of one organization. Other firms' user ids are dropped. */
export async function memberNames(
  organizationId: string,
  userIds: Array<string | null | undefined>,
) {
  const rows = await memberships.displayNames(organizationId, userIds.filter((id) => !!id) as string[]);
  return new Map(rows.map((row) => [row.userId, row.name]));
}

/** Names of teams already stored on this organization's matters. No member list. */
export async function teamNames(organizationId: string, teamIds: string[]) {
  const rows = await teams.displayNames(organizationId, teamIds);
  return new Map(rows.map((row) => [String(row._id), row.name]));
}
