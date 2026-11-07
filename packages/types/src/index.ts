export const ROLES = [
  'owner',
  'admin',
  'attorney',
  'paralegal',
  'billing',
  'staff',
  'intern',
] as const;
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
  'time:write',
  /** Mark a hearing outcome reviewed. Owner and attorney only. */
  'hearing:review',
  /** Approve a date the firm typed. Not a statutory calculation. */
  'deadline:approve',
  /** Approve a client-message preview. Does not itself send. */
  'message:approve',
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
  | 'PAYLOAD_TOO_LARGE'
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
  /** Client-level: summarises the client's whole case file. Private to the requester. */
  'case_history',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface SourceReference {
  documentId: string;
  version: number;
  locator?: string;
}

/** Static role → permission mapping. Matter-level restrictions are checked separately. */
const LAWYER_ONLY: readonly Permission[] = [
  'hearing:review',
  'deadline:approve',
  'message:approve',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'billing:write' && !LAWYER_ONLY.includes(p)),
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
    'time:write',
    'hearing:review',
    'deadline:approve',
    'message:approve',
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
    'time:write',
  ],
  billing: ['client:read', 'matter:read', 'billing:read', 'billing:write'],
  staff: ['client:read', 'matter:read', 'document:read', 'task:write', 'calendar:write'],
  /** Assigned matters and own tasks only. Enforcement is in the access service, not only this list. */
  intern: ['matter:read', 'document:read', 'task:write'],
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

// ---- Billing ----
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'AED', 'SGD'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'check', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const INVOICE_LINE_TYPES = ['time', 'expense', 'adjustment'] as const;
export type InvoiceLineType = (typeof INVOICE_LINE_TYPES)[number];

/** Largest single amount accepted anywhere: 10,000,000.00 in the smallest currency unit. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;

/**
 * Money for a number of minutes at an hourly rate, in cents, rounded half up using integers only
 * (no floating point), so totals are exact and reproducible.
 */
export function timeAmountCents(minutes: number, hourlyRateCents: number): number {
  return Math.floor((minutes * hourlyRateCents + 30) / 60);
}

/** Tax in cents for `amountCents` at `rateBp` basis points (825 = 8.25%), rounded half up, integers only. */
export function taxAmountCents(amountCents: number, rateBp: number): number {
  const sign = amountCents < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(amountCents) * rateBp + 5000) / 10000);
}
export * from './templates.js';
export * from './reminders.js';
export * from './practice.js';
