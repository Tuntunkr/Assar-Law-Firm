import { z } from 'zod';
import {
  AI_TASKS,
  MAX_PLACEHOLDER_VALUE_CHARS,
  MAX_TEMPLATE_CHARS,
  TEMPLATE_CATEGORIES,
  CURRENCIES,
  MAX_AMOUNT_CENTS,
  MAX_REMINDER_STEPS,
  REMINDER_CHANNELS,
  PAYMENT_METHODS,
  CLIENT_TYPES,
  MATTER_STATUSES,
  PARTY_ROLES,
  PRACTICE_AREAS,
  SERVICE_SCOPES,
  HEARING_RESULTS,
  DEADLINE_KINDS,
  MESSAGE_CHANNELS,
} from '@assar/types';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  /** 6-digit TOTP code or a recovery code. */
  mfaCode: z.string().trim().min(6).max(20).optional(),
});

export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(256);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

export const demoRequestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  firm: z.string().trim().min(2).max(150),
  firmSize: z.enum(['1-5', '6-20', '21-50', '51-200', '200+']),
  message: z.string().trim().max(2000).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
});
export type DemoRequest = z.infer<typeof demoRequestSchema>;

// ---- Auth & organization ----
export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(150),
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: passwordSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2).max(100),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({ name: z.string().trim().min(2).max(100) });

export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const mfaEnableSchema = z.object({ code: totpCodeSchema });
export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(256),
  code: totpCodeSchema,
});

const INVITABLE_ROLES = ['admin', 'attorney', 'paralegal', 'billing', 'staff', 'intern'] as const;
export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(INVITABLE_ROLES),
});

export const updateMemberSchema = z
  .object({
    role: z.enum(INVITABLE_ROLES).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, 'Provide role or status');

export const updateOrganizationSchema = z.object({ name: z.string().trim().min(2).max(150) });

export const auditQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(100).optional(),
});

// ---- Clients, matters, parties, teams ----
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const optionalText = (max: number) => z.string().trim().max(max).optional();

const clientFields = {
  type: z.enum(CLIENT_TYPES),
  name: z.string().trim().min(2).max(200),
  email: emailSchema.optional(),
  phone: optionalText(40),
  address: optionalText(500),
};
export const createClientSchema = z.object(clientFields);
export const updateClientSchema = z
  .object({ ...clientFields, status: z.enum(['active', 'archived']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const clientListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

/** A calendar day kept as the plain string `YYYY-MM-DD`, so it never shifts with time zones. */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => {
    // `toISOString` throws on an invalid date (e.g. Feb 31), so check validity first.
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real date');

/** Where the case is being heard. Every field is optional; an empty object is treated as "no court". */
export const courtSchema = z.object({
  name: optionalText(200),
  caseNumber: optionalText(100),
  judge: optionalText(150),
  courtroom: optionalText(100),
  jurisdiction: optionalText(150),
  filedOn: dateOnly.optional(),
  /** Shape check only. Omitted when blank. Not evidence the case exists. */
  cnr: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{16}$/, 'CNR must be 16 letters or digits. This checks the shape only.')
    .optional(),
  officialUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), 'Use an https link')
    .optional(),
});

export const createMatterSchema = z.object({
  clientId: objectIdSchema,
  title: z.string().trim().min(2).max(200),
  practiceArea: z.enum(PRACTICE_AREAS),
  description: optionalText(5000),
  court: courtSchema.optional(),
  leadAttorneyId: objectIdSchema.optional(),
  teamIds: z.array(objectIdSchema).max(20).default([]),
  restricted: z.boolean().default(false),
  /** Users who may see a restricted matter (the creator is always included). */
  accessUserIds: z.array(objectIdSchema).max(100).default([]),
});
export const updateMatterSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    practiceArea: z.enum(PRACTICE_AREAS),
    description: optionalText(5000),
    court: courtSchema.nullable(),
    status: z.enum(MATTER_STATUSES),
    leadAttorneyId: objectIdSchema.nullable(),
    teamIds: z.array(objectIdSchema).max(20),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const matterListQuerySchema = paginationSchema.extend({
  status: z.enum(MATTER_STATUSES).optional(),
  clientId: objectIdSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export const setMatterAccessSchema = z.object({
  restricted: z.boolean(),
  userIds: z.array(objectIdSchema).max(100).default([]),
});

const partyFields = {
  name: z.string().trim().min(2).max(200),
  type: z.enum(CLIENT_TYPES),
  role: z.enum(PARTY_ROLES),
  email: emailSchema.optional(),
  phone: optionalText(40),
};
export const createPartySchema = z.object(partyFields);
export const updatePartySchema = z
  .object(partyFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: optionalText(500),
  userIds: z.array(objectIdSchema).max(200).default([]),
});
export const updateTeamSchema = z
  .object({ name: z.string().trim().min(2).max(100), description: optionalText(500) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const setTeamMembersSchema = z.object({ userIds: z.array(objectIdSchema).max(200) });

export const conflictCheckSchema = z.object({
  names: z.array(z.string().trim().min(2).max(200)).min(1).max(20),
});

// ---- Documents ----
/** Content types accepted for upload. Anything else is rejected before a URL is issued. */
export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/rtf',
  'application/vnd.oasis.opendocument.text',
  'text/plain',
  'text/csv',
  'message/rfc822',
  'image/png',
  'image/jpeg',
  'image/tiff',
] as const;

/** Strips path separators and control characters so a filename is safe to store and echo. */
const filenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .transform((s) => s.replace(/[\\/\u0000-\u001f\u007f"]/g, '_'))
  .refine((s) => s !== '.' && s !== '..', 'Invalid filename');

const uploadFields = {
  filename: filenameSchema,
  contentType: z.enum(ALLOWED_UPLOAD_TYPES),
  sizeBytes: z.number().int().positive(),
};
export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(250),
  ...uploadFields,
});
export const newVersionSchema = z.object(uploadFields);
export const renameDocumentSchema = z.object({ title: z.string().trim().min(1).max(250) });
/** Timeline paging: pass the `before` of the previous page's last entry to get older ones. */
export const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z
    .string()
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .optional(),
});

/** Search inside the text of documents (including scans read by OCR). */
export const textSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  matterId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export const documentTextQuerySchema = z.object({
  full: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
});

export const documentListQuerySchema = paginationSchema;
/** Firm-wide document search: by title, matter or client. Restricted matters are filtered server-side. */
export const documentSearchQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  matterId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
});

// ---- Calendar & tasks ----
const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

const EVENT_KINDS = ['hearing', 'deadline', 'meeting', 'reminder', 'other'] as const;
const eventFields = {
  kind: z.enum(EVENT_KINDS),
  title: z.string().trim().min(2).max(200),
  description: optionalText(5000),
  startsAt: isoDate,
  endsAt: isoDate.nullable().optional(),
  allDay: z.boolean().default(false),
  location: optionalText(300),
  attendeeIds: z.array(objectIdSchema).max(50).default([]),
  matterId: objectIdSchema.nullable().optional(),
};
export const createEventSchema = z
  .object(eventFields)
  .refine((v) => !v.endsAt || v.endsAt >= v.startsAt, {
    message: 'endsAt must not be before startsAt',
    path: ['endsAt'],
  });
export const updateEventSchema = z
  .object({ ...eventFields, status: z.enum(['scheduled', 'completed', 'cancelled']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const hearingOutcomeSchema = z.object({
  result: z.enum(HEARING_RESULTS),
  notes: z.string().trim().min(1).max(5000),
  nextHearingOn: dateOnly.optional(),
});

export const deadlineFields = {
  matterId: objectIdSchema,
  kind: z.enum(DEADLINE_KINDS),
  title: z.string().trim().min(2).max(200),
  /** Why this date was typed. Not a statute and not a model output. */
  basisNote: z.string().trim().min(2).max(5000),
  dueOn: dateOnly,
  reminderDaysBefore: z.array(z.number().int().min(0).max(365)).max(8).default([7, 3, 1, 0]),
  escalateAfterDays: z.number().int().min(0).max(365).default(1),
};
export const createDeadlineSchema = z.object(deadlineFields);
export const updateDeadlineSchema = z
  .object(deadlineFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const outboxDraftSchema = z.object({
  clientId: objectIdSchema,
  matterId: objectIdSchema.optional(),
  channel: z.enum(MESSAGE_CHANNELS),
  templateLabel: z.string().trim().min(2).max(120),
  body: z.string().trim().min(2).max(5000),
  consent: z.object({
    optedIn: z.literal(true),
    namesFirm: z.literal(true),
    note: z.string().trim().max(500).optional(),
  }),
});

export const webhookAckSchema = z.object({
  eventId: z.string().trim().min(8).max(200),
  outboxId: objectIdSchema,
  status: z.literal('mock_ack'),
});

const MAX_RANGE_MS = 366 * 24 * 3600_000;
export const eventListQuerySchema = paginationSchema
  .extend({
    from: isoDate,
    to: isoDate,
    kind: z.enum(EVENT_KINDS).optional(),
    matterId: objectIdSchema.optional(),
  })
  .refine((v) => v.to > v.from, { message: '`to` must be after `from`', path: ['to'] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_RANGE_MS, {
    message: 'Range may not exceed 366 days',
    path: ['to'],
  });

const taskFields = {
  title: z.string().trim().min(2).max(200),
  description: optionalText(5000),
  priority: z.enum(['low', 'normal', 'high']),
  matterId: objectIdSchema.nullable(),
  assigneeId: objectIdSchema.nullable(),
  dueAt: isoDate.nullable(),
};
export const createTaskSchema = z.object({
  title: taskFields.title,
  description: taskFields.description,
  priority: taskFields.priority.default('normal'),
  matterId: taskFields.matterId.optional(),
  assigneeId: taskFields.assigneeId.optional(),
  dueAt: taskFields.dueAt.optional(),
});
export const updateTaskSchema = z
  .object({ ...taskFields, status: z.enum(['todo', 'in_progress', 'done', 'cancelled']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const taskListQuerySchema = paginationSchema.extend({
  /** A user id, or `me`. */
  assigneeId: z.union([z.literal('me'), objectIdSchema]).optional(),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
  matterId: objectIdSchema.optional(),
  dueBefore: isoDate.optional(),
});

// ---- AI ----
export const createAiJobSchema = z
  .object({
    task: z.enum(AI_TASKS).refine((t) => t !== 'case_history', 'Use the client summary request'),
    matterId: objectIdSchema,
    /** Source documents. Omit `version` to use the latest scanned (clean) version. */
    documents: z
      .array(
        z.object({ documentId: objectIdSchema, version: z.number().int().positive().optional() }),
      )
      .min(1, 'Select at least one source document')
      .max(10),
    /** The question (document_qa) or drafting brief (drafting); optional guidance otherwise. */
    instructions: z.string().trim().min(3).max(4000).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.task === 'document_qa' || v.task === 'drafting') && !v.instructions) {
      ctx.addIssue({
        code: 'custom',
        path: ['instructions'],
        message:
          v.task === 'document_qa' ? 'Enter the question to answer' : 'Enter a drafting brief',
      });
    }
    const ids = v.documents.map((d) => `${d.documentId}:${d.version ?? ''}`);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['documents'], message: 'Duplicate documents' });
    }
  });

/** A summary of a client's whole case file. `instructions` can focus it (e.g. "pending deadlines"). */
export const createClientSummarySchema = z.object({
  clientId: objectIdSchema,
  instructions: z.string().trim().min(3).max(1000).optional(),
});

export const aiJobListQuerySchema = paginationSchema.extend({
  matterId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
  status: z.enum(['queued', 'processing', 'succeeded', 'failed', 'cancelled']).optional(),
  task: z.enum(AI_TASKS).optional(),
});
export const aiOutputListQuerySchema = paginationSchema.extend({
  matterId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
  reviewStatus: z.enum(['draft', 'approved', 'rejected']).optional(),
  task: z.enum(AI_TASKS).optional(),
});
export const approveAiOutputSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  /** Required when the output has unverified items or unsupported authorities. */
  acknowledgeUnverified: z.boolean().default(false),
});
export const rejectAiOutputSchema = z.object({ reason: z.string().trim().min(3).max(2000) });
export const editAiOutputSchema = z.object({ text: z.string().trim().min(1).max(100_000) });

// ---- Document templates ----
const templateFields = {
  name: z.string().trim().min(2).max(150),
  category: z.enum(TEMPLATE_CATEGORIES),
  description: optionalText(500),
  body: z.string().min(10).max(MAX_TEMPLATE_CHARS),
};
export const createTemplateSchema = z.object(templateFields);
export const updateTemplateSchema = z
  .object({
    ...templateFields,
    description: templateFields.description.nullable(),
    status: z.enum(['active', 'archived']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const templateListQuerySchema = z.object({
  status: z.enum(['active', 'archived']).default('active'),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
});
/** Fill a template: facts come from the matter; anything else is supplied in `values`. */
export const renderTemplateSchema = z.object({
  matterId: objectIdSchema.optional(),
  values: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_.]{0,60}$/),
      z.string().max(MAX_PLACEHOLDER_VALUE_CHARS),
    )
    .default({}),
});

// ---- Client portal ----
export const portalLoginSchema = z.object({
  /** The firm's identifier (organization slug), because the same e-mail can belong to several firms. */
  organizationSlug: z.string().trim().toLowerCase().min(3).max(60),
  email: emailSchema,
  password: z.string().min(1).max(256),
});
export const portalAcceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2).max(100),
  password: passwordSchema,
});
export const createPortalInvitationSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2).max(100).optional(),
});
export const setMatterPortalSchema = z.object({
  visible: z.boolean(),
  /** Client-facing status message. `null` clears it; omit to leave unchanged. */
  note: z.string().trim().max(1000).nullable().optional(),
});
export const setSharedSchema = z.object({ shared: z.boolean() });
export const updatePortalUserSchema = z.object({ status: z.enum(['active', 'disabled']) });

// ---- Workflow automation ----
export const createServiceTokenSchema = z.object({
  name: z.string().trim().min(3).max(100),
  scopes: z.array(z.enum(SERVICE_SCOPES)).min(1).max(SERVICE_SCOPES.length),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export const notificationListQuerySchema = paginationSchema.extend({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export const remindersQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(168).default(24),
});
const LINK_TYPES = ['task', 'event', 'matter', 'ai_output', 'document'] as const;
export const automationNotificationSchema = z.object({
  recipientUserId: objectIdSchema,
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().max(1000).optional(),
  link: z.object({ type: z.enum(LINK_TYPES), id: objectIdSchema }).optional(),
  /** Makes the call idempotent: the same key never creates a second notification. */
  dedupeKey: z.string().trim().min(8).max(200),
});
export const automationTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional(),
  matterId: objectIdSchema.optional(),
  assigneeId: objectIdSchema.optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueAt: isoDate.optional(),
});

// ---- Billing ----
/** A calendar day, `YYYY-MM-DD`, validated as a real date and returned as UTC midnight. */
export const ymdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .transform((s, ctx) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      ctx.addIssue({ code: 'custom', message: 'Not a real date' });
      return z.NEVER;
    }
    return d;
  });

const cents = z.number().int().min(0).max(MAX_AMOUNT_CENTS);

export const createTimeEntrySchema = z.object({
  matterId: objectIdSchema,
  workDate: ymdSchema,
  minutes: z.number().int().min(1).max(1440),
  description: z.string().trim().min(3).max(1000),
  billable: z.boolean().default(true),
  /** Overrides the default rate. Needs billing:write. */
  rateCents: cents.optional(),
});
export const updateTimeEntrySchema = z
  .object({
    matterId: objectIdSchema,
    workDate: ymdSchema,
    minutes: z.number().int().min(1).max(1440),
    description: z.string().trim().min(3).max(1000),
    billable: z.boolean(),
    rateCents: cents,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const timeListQuerySchema = paginationSchema.extend({
  matterId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
  userId: objectIdSchema.optional(),
  status: z.enum(['unbilled', 'invoiced']).optional(),
  billable: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  from: ymdSchema.optional(),
  to: ymdSchema.optional(),
});

export const billingSettingsSchema = z.object({
  currency: z.enum(CURRENCIES),
  defaultHourlyRateCents: cents.nullable(),
  /** Basis points: 825 = 8.25%. */
  defaultTaxRateBp: z.number().int().min(0).max(10000),
  invoiceDueDays: z.number().int().min(0).max(365),
  /** When to remind about an unpaid invoice, in days from its due date (negative = before). */
  reminderDays: z
    .array(z.number().int().min(-30).max(365))
    .max(MAX_REMINDER_STEPS)
    .transform((a) => [...new Set(a)].sort((x, y) => x - y))
    .optional(),
});
export const memberRateSchema = z.object({ hourlyRateCents: cents.nullable() });

export const createInvoiceSchema = z.object({
  clientId: objectIdSchema,
  /** Bill these specific time entries... */
  timeEntryIds: z.array(objectIdSchema).max(500).optional(),
  /** ...or every unbilled billable entry on these matters. */
  matterIds: z.array(objectIdSchema).max(50).optional(),
  dueDays: z.number().int().min(0).max(365).optional(),
  taxRateBp: z.number().int().min(0).max(10000).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export const updateInvoiceSchema = z
  .object({
    dueDays: z.number().int().min(0).max(365),
    taxRateBp: z.number().int().min(0).max(10000),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const addInvoiceLineSchema = z
  .object({
    type: z.enum(['expense', 'adjustment']),
    description: z.string().trim().min(3).max(1000),
    /** Expenses are positive; adjustments (discounts) may be negative. */
    amountCents: z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS),
    matterId: objectIdSchema.optional(),
  })
  .refine((v) => v.amountCents !== 0, { message: 'Amount cannot be zero', path: ['amountCents'] })
  .refine((v) => v.type === 'adjustment' || v.amountCents > 0, {
    message: 'Expenses must be positive; use an adjustment for a discount',
    path: ['amountCents'],
  });
export const recordPaymentSchema = z.object({
  amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS),
  paidAt: isoDate.optional(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(200).optional(),
});
export const voidInvoiceSchema = z.object({ reason: z.string().trim().min(3).max(500) });
/** Records that someone contacted the client about an unpaid invoice (email, WhatsApp, a call, a letter…). */
export const logInvoiceReminderSchema = z.object({
  channel: z.enum(REMINDER_CHANNELS),
  note: z.string().trim().max(500).optional(),
});
export const invoiceListQuerySchema = paginationSchema.extend({
  overdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  clientId: objectIdSchema.optional(),
  status: z.enum(['draft', 'issued', 'paid', 'void']).optional(),
});

const MAX_REPORT_MS = 366 * 24 * 3600_000;
/** Zod still runs refinements after a field failed to parse, so they must tolerate non-dates. */
const isDate = (...v: unknown[]) => v.every((x) => x instanceof Date && !Number.isNaN(x.getTime()));
export const reportRangeSchema = z
  .object({ from: ymdSchema, to: ymdSchema })
  .refine((v) => !isDate(v.from, v.to) || v.to > v.from, {
    message: '`to` must be after `from`',
    path: ['to'],
  })
  .refine((v) => !isDate(v.from, v.to) || v.to.getTime() - v.from.getTime() <= MAX_REPORT_MS, {
    message: 'Range may not exceed 366 days',
    path: ['to'],
  });
export const timeReportQuerySchema = z
  .object({
    from: ymdSchema,
    to: ymdSchema,
    groupBy: z.enum(['user', 'matter', 'client']).default('user'),
    userId: objectIdSchema.optional(),
  })
  .refine((v) => !isDate(v.from, v.to) || v.to > v.from, {
    message: '`to` must be after `from`',
    path: ['to'],
  })
  .refine((v) => !isDate(v.from, v.to) || v.to.getTime() - v.from.getTime() <= MAX_REPORT_MS, {
    message: 'Range may not exceed 366 days',
    path: ['to'],
  });

// ---- Secret hygiene ----
const PLACEHOLDER =
  /change[-_ ]?me|changeme|example|placeholder|your[-_ ]?(secret|key)|default|password|secret[-_]?key|insecure|dummy|todo|xxxx|0000|1234|abcd|test[-_]?(secret|key)/i;

/**
 * Why a secret should not be used in production, or `null` if it looks acceptable. This cannot prove a
 * secret is strong; it catches the mistakes people actually make: copied placeholders, short values,
 * repeated characters and keys reused for two purposes.
 */
export function weakSecretReason(value: string, minLength = 32): string | null {
  if (value.length < minLength) return `shorter than ${minLength} characters`;
  if (PLACEHOLDER.test(value)) return 'looks like a placeholder or example value';
  if (new Set(value).size < Math.min(12, Math.floor(minLength / 2)))
    return 'has too few distinct characters';
  if (/^(.)\1+$/.test(value) || /^(..+?)\1+$/.test(value)) return 'is a repeated pattern';
  return null;
}
