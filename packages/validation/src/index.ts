import { z } from 'zod';
import { AI_TASKS, CLIENT_TYPES, MATTER_STATUSES, PARTY_ROLES, PRACTICE_AREAS } from '@assar/types';

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

export const createAiJobSchema = z.object({
  task: z.enum(AI_TASKS),
  matterId: z.string().min(1),
  documentIds: z.array(z.string().min(1)).max(20).default([]),
  instructions: z.string().trim().max(4000).optional(),
});

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
