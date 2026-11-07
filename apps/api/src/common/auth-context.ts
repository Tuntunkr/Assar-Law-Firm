import type { Request } from 'express';
import type { Role, ServiceScope } from '@assar/types';

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

/** A signed-in client-portal user. Every portal query is bound to `clientId`. */
export interface ClientContext {
  clientUserId: string;
  organizationId: string;
  clientId: string;
  sessionTokenHash: string;
  csrfToken: string;
}

/** An automation service token. It is not a user and has no role: only its scopes. */
export interface ServiceContext {
  tokenId: string;
  organizationId: string;
  name: string;
  scopes: ServiceScope[];
}

export type AppRequest = Request & {
  id: string;
  auth?: AuthContext;
  /**
   * The signed-in portal user. NOT named `client`: Node's IncomingMessage already has a `client` property (the socket),
   * so a field with that name is always truthy and silently collides with it.
   */
  portalUser?: ClientContext;
  service?: ServiceContext;
};
