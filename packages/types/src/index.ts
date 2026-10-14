export const ROLES = ['owner', 'admin', 'attorney', 'paralegal', 'billing', 'staff'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that must have MFA enabled. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['owner', 'admin', 'billing'];

export const PERMISSIONS = [
  'org:manage',
  'user:manage',
  'client:read',
  'client:write',
  'matter:read',
  'matter:write',
  'document:read',
  'document:write',
  'task:write',
  'calendar:write',
  'ai:use',
  'ai:approve',
  'billing:read',
  'billing:write',
  'audit:read',
  'workflow:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'MFA_REQUIRED'
  | 'MFA_ENROLLMENT_REQUIRED'
  | 'ACCOUNT_LOCKED'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown[]; requestId: string };
}

export interface Page<T> {
  data: T[];
  page: { nextCursor: string | null; limit: number };
}

/** Real processing states only — never synthesize progress. */
export const JOB_STATUSES = ['queued', 'processing', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** AI output is a draft until a human reviews it. */
export const REVIEW_STATUSES = ['draft', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const AI_TASKS = [
  'summary',
  'document_qa',
  'extraction',
  'chronology',
  'clause_review',
  'drafting',
  'missing_info',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface SourceReference {
  documentId: string;
  version: number;
  locator?: string;
}

/** Static role → permission mapping. Matter-level restrictions are checked separately. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'billing:write'),
  attorney: [
    'client:read',
    'client:write',
    'matter:read',
    'matter:write',
    'document:read',
    'document:write',
    'task:write',
    'calendar:write',
    'ai:use',
    'ai:approve',
  ],
  paralegal: [
    'client:read',
    'client:write',
    'matter:read',
    'matter:write',
    'document:read',
    'document:write',
    'task:write',
    'calendar:write',
    'ai:use',
  ],
  billing: ['client:read', 'matter:read', 'billing:read', 'billing:write'],
  staff: ['client:read', 'matter:read', 'document:read', 'task:write', 'calendar:write'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function roleRequiresMfa(role: Role): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}
