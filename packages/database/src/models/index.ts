import mongoose, { type Model, type Types } from 'mongoose';
import type { Role } from '@assar/types';

// Default import: named runtime imports from this CJS package fail under Node's native ESM loader.
const { Schema, model, models } = mongoose;
type Schema<T> = mongoose.Schema<T>;

type Id = Types.ObjectId;
const define = <T>(name: string, schema: Schema<T>): Model<T> =>
  (models[name] as Model<T> | undefined) ?? model<T>(name, schema);

export interface OrganizationDoc {
  _id: Id;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  createdAt: Date;
  updatedAt: Date;
}
export const OrganizationModel = define<OrganizationDoc>(
  'Organization',
  new Schema<OrganizationDoc>(
    {
      name: { type: String, required: true, trim: true, maxlength: 150 },
      slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        match: /^[a-z0-9-]{3,50}$/,
      },
      status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    },
    { timestamps: true },
  ),
);

export interface UserDoc {
  _id: Id;
  email: string;
  name: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  failedLoginCount: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;
  mfa: {
    enabled: boolean;
    /** AES-256-GCM encrypted TOTP secret (never plaintext). */
    secretEnc?: string | null;
    /** SHA-256 hashes of single-use recovery codes. */
    recoveryHashes: string[];
    /** Secret awaiting first verification. */
    pendingSecretEnc?: string | null;
    /** Last accepted TOTP time-step, to reject code replay. */
    lastUsedStep?: number | null;
  };
  createdAt: Date;
  updatedAt: Date;
}
export const UserModel = define<UserDoc>(
  'User',
  new Schema<UserDoc>(
    {
      email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        maxlength: 254,
      },
      name: { type: String, required: true, trim: true, maxlength: 100 },
      passwordHash: { type: String, required: true },
      status: { type: String, enum: ['active', 'disabled'], default: 'active' },
      failedLoginCount: { type: Number, default: 0 },
      lockedUntil: { type: Date, default: null },
      lastLoginAt: { type: Date, default: null },
      mfa: {
        enabled: { type: Boolean, default: false },
        secretEnc: { type: String, default: null },
        recoveryHashes: { type: [String], default: [] },
        pendingSecretEnc: { type: String, default: null },
        lastUsedStep: { type: Number, default: null },
      },
    },
    { timestamps: true },
  ),
);

export interface MembershipDoc {
  _id: Id;
  organizationId: Id;
  userId: Id;
  role: Role;
  status: 'active' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
}
const membershipSchema = new Schema<MembershipDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, ref: 'Organization' },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    role: {
      type: String,
      required: true,
      enum: ['owner', 'admin', 'attorney', 'paralegal', 'billing', 'staff'],
    },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  },
  { timestamps: true },
);
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1 });
export const MembershipModel = define<MembershipDoc>('Membership', membershipSchema);

export interface SessionDoc {
  _id: Id;
  tokenHash: string;
  userId: Id;
  organizationId: Id;
  /** Password (+ MFA when enabled) verified. */
  mfaVerified: boolean;
  ip?: string;
  userAgent?: string;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  createdAt: Date;
}
const sessionSchema = new Schema<SessionDoc>(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    organizationId: { type: Schema.Types.ObjectId, required: true },
    mfaVerified: { type: Boolean, default: false },
    ip: String,
    userAgent: { type: String, maxlength: 300 },
    lastSeenAt: { type: Date, required: true },
    idleExpiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
sessionSchema.index({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1 });
export const SessionModel = define<SessionDoc>('Session', sessionSchema);

export interface InvitationDoc {
  _id: Id;
  organizationId: Id;
  email: string;
  role: Role;
  tokenHash: string;
  invitedBy: Id;
  expiresAt: Date;
  acceptedAt?: Date | null;
  createdAt: Date;
}
const invitationSchema = new Schema<InvitationDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: {
      type: String,
      required: true,
      enum: ['admin', 'attorney', 'paralegal', 'billing', 'staff'],
    },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
invitationSchema.index({ organizationId: 1, email: 1 });
export const InvitationModel = define<InvitationDoc>('Invitation', invitationSchema);

export interface AuditLogDoc {
  _id: Id;
  organizationId: Id;
  actorId?: Id | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  requestId?: string;
  /** Never put document contents or secrets here. */
  meta?: Record<string, unknown>;
  createdAt: Date;
}
const auditSchema = new Schema<AuditLogDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    actorId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true, maxlength: 100 },
    targetType: String,
    targetId: String,
    ip: String,
    requestId: String,
    meta: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ organizationId: 1, _id: -1 });
auditSchema.index({ organizationId: 1, action: 1, _id: -1 });
// Append-only: block mutation through the model API.
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  auditSchema.pre(op, () => {
    throw new Error('audit_logs is append-only');
  });
}
export const AuditLogModel = define<AuditLogDoc>('AuditLog', auditSchema);

export interface IdempotencyKeyDoc {
  _id: Id;
  organizationId: Id;
  key: string;
  requestHash: string;
  status: 'processing' | 'completed';
  responseStatus?: number;
  responseBody?: unknown;
  expiresAt: Date;
}
const idemSchema = new Schema<IdempotencyKeyDoc>({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  key: { type: String, required: true, maxlength: 200 },
  requestHash: { type: String, required: true },
  status: { type: String, enum: ['processing', 'completed'], required: true },
  responseStatus: Number,
  responseBody: Schema.Types.Mixed,
  expiresAt: { type: Date, required: true },
});
idemSchema.index({ organizationId: 1, key: 1 }, { unique: true });
idemSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const IdempotencyKeyModel = define<IdempotencyKeyDoc>('IdempotencyKey', idemSchema);
