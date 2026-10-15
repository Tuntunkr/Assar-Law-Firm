import { z } from 'zod';
import {
  AI_TASKS,
  CLIENT_TYPES,
  MATTER_STATUSES,
  PARTY_ROLES,
  PRACTICE_AREAS,
  SERVICE_SCOPES,
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

export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const mfaEnableSchema = z.object({ code: totpCodeSchema });
export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(256),
  code: totpCodeSchema,
});

const INVITABLE_ROLES = ['admin', 'attorney', 'paralegal', 'billing', 'staff'] as const;
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

export const createMatterSchema = z.object({
  clientId: objectIdSchema,
  title: z.string().trim().min(2).max(200),
  practiceArea: z.enum(PRACTICE_AREAS),
  description: optionalText(5000),
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
export const documentListQuerySchema = paginationSchema;

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
    task: z.enum(AI_TASKS),
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

export const aiJobListQuerySchema = paginationSchema.extend({
  matterId: objectIdSchema.optional(),
  status: z.enum(['queued', 'processing', 'succeeded', 'failed', 'cancelled']).optional(),
  task: z.enum(AI_TASKS).optional(),
});
export const aiOutputListQuerySchema = paginationSchema.extend({
  matterId: objectIdSchema.optional(),
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
