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
  'conflict:check',
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
  'portal:manage',
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
  | 'SERVICE_UNAVAILABLE'
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
    'conflict:check',
    'document:read',
    'document:write',
    'task:write',
    'calendar:write',
    'ai:use',
    'ai:approve',
    'portal:manage',
  ],
  paralegal: [
    'client:read',
    'client:write',
    'matter:read',
    'matter:write',
    'conflict:check',
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

export const CLIENT_TYPES = ['individual', 'organization'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const PRACTICE_AREAS = [
  'litigation',
  'corporate',
  'family',
  'real_estate',
  'employment',
  'intellectual_property',
  'criminal',
  'immigration',
  'tax',
  'other',
] as const;
export type PracticeArea = (typeof PRACTICE_AREAS)[number];

export const MATTER_STATUSES = ['open', 'pending', 'closed', 'archived'] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

export const PARTY_ROLES = [
  'client',
  'opposing_party',
  'opposing_counsel',
  'co_party',
  'witness',
  'expert',
  'other',
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export type ConflictMatchType = 'exact' | 'similar';

/** Scopes a workflow-automation service token can hold. Each maps to specific /v1/automation endpoints. */
export const SERVICE_SCOPES = [
  'reminders:read',
  'notifications:write',
  'tasks:write',
  'matters:read',
  'reports:read',
] as const;
export type ServiceScope = (typeof SERVICE_SCOPES)[number];

export const WORKFLOW_EVENTS = [
  'matter.created',
  'document.scan_clean',
  'ai.output_ready',
] as const;
export type WorkflowEventName = (typeof WORKFLOW_EVENTS)[number];

export type ActorType = 'staff' | 'client' | 'service' | 'system';

// ---- Client portal DTOs (what a client may ever see) ----
export interface PortalMe {
  clientUser: { id: string; name: string; email: string };
  client: { id: string; name: string };
  organization: { name: string; slug: string };
  csrfToken: string;
}
export interface PortalMatter {
  id: string;
  matterNumber: string;
  title: string;
  practiceArea: string;
  status: string;
  /** Status message written for the client by the firm. */
  note: string | null;
  openedAt: string;
  closedAt: string | null;
}
export interface PortalDocument {
  id: string;
  matterId: string;
  title: string;
  /** Only versions the firm has shared. */
  versions: {
    version: number;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sharedAt: string;
  }[];
}
export interface PortalAiOutput {
  id: string;
  matterId: string;
  task: string;
  title: string;
  /** The reviewer's edited text when present, otherwise the approved text. */
  body: string;
  points: { label: string; text: string }[];
  label: string;
  approvedAt: string;
}
