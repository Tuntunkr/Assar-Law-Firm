import { z } from 'zod';
import { AI_TASKS } from '@assar/types';

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
