import { memberships } from '@assar/database';
import { ApiError } from './exception.filter';

/** All ids must be active members of the organization; otherwise the request is rejected. */
export async function assertActiveMembers(
  organizationId: string,
  userIds: string[],
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  if ((await memberships.countActive(organizationId, unique)) !== unique.length) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'One or more users are not active members of this organization',
    );
  }
}
