import type { Request } from 'express';
import type { Role } from '@assar/types';

export interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
  sessionTokenHash: string;
  csrfToken: string;
  mfaEnabled: boolean;
  /** Role requires MFA but the user has not enrolled yet: access is limited to enrollment routes. */
  mfaEnrollmentRequired: boolean;
}

export type AppRequest = Request & { id: string; auth?: AuthContext };
