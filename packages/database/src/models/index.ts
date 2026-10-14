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

// ---- Clients, matters, parties, teams ----
const searchable = {
  normalizedName: { type: String, required: true },
  tokens: { type: [String], default: [] },
};

export interface ClientDoc {
  _id: Id;
  organizationId: Id;
  type: 'individual' | 'organization';
  name: string;
  normalizedName: string;
  tokens: string[];
  email?: string;
  phone?: string;
  address?: string;
  status: 'active' | 'archived';
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const clientSchema = new Schema<ClientDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ['individual', 'organization'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    ...searchable,
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, maxlength: 40 },
    address: { type: String, maxlength: 500 },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
clientSchema.index({ organizationId: 1, _id: -1 });
clientSchema.index({ organizationId: 1, status: 1, _id: -1 });
clientSchema.index({ organizationId: 1, normalizedName: 1 });
clientSchema.index({ organizationId: 1, tokens: 1 });
export const ClientModel = define<ClientDoc>('Client', clientSchema);

export interface TeamDoc {
  _id: Id;
  organizationId: Id;
  name: string;
  normalizedName: string;
  description?: string;
  userIds: Id[];
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const teamSchema = new Schema<TeamDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    normalizedName: { type: String, required: true },
    description: { type: String, maxlength: 500 },
    userIds: { type: [Schema.Types.ObjectId], default: [] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
teamSchema.index({ organizationId: 1, normalizedName: 1 }, { unique: true });
export const TeamModel = define<TeamDoc>('Team', teamSchema);

export interface MatterDoc {
  _id: Id;
  organizationId: Id;
  clientId: Id;
  matterNumber: string;
  title: string;
  titleLower: string;
  practiceArea: string;
  description?: string;
  status: 'open' | 'pending' | 'closed' | 'archived';
  /** Restricted matters are visible only to users in matter_access (plus the owner, audited). */
  restricted: boolean;
  leadAttorneyId?: Id | null;
  teamIds: Id[];
  openedAt: Date;
  closedAt?: Date | null;
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const matterSchema = new Schema<MatterDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    matterNumber: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    titleLower: { type: String, required: true },
    practiceArea: { type: String, required: true },
    description: { type: String, maxlength: 5000 },
    status: { type: String, enum: ['open', 'pending', 'closed', 'archived'], default: 'open' },
    restricted: { type: Boolean, default: false },
    leadAttorneyId: { type: Schema.Types.ObjectId, default: null },
    teamIds: { type: [Schema.Types.ObjectId], default: [] },
    openedAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
matterSchema.index({ organizationId: 1, matterNumber: 1 }, { unique: true });
matterSchema.index({ organizationId: 1, _id: -1 });
matterSchema.index({ organizationId: 1, status: 1, _id: -1 });
matterSchema.index({ organizationId: 1, clientId: 1, _id: -1 });
matterSchema.index({ organizationId: 1, titleLower: 1 });
export const MatterModel = define<MatterDoc>('Matter', matterSchema);

export interface MatterAccessDoc {
  _id: Id;
  organizationId: Id;
  matterId: Id;
  userId: Id;
  grantedBy: Id;
  createdAt: Date;
}
const matterAccessSchema = new Schema<MatterAccessDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    grantedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
matterAccessSchema.index({ organizationId: 1, matterId: 1, userId: 1 }, { unique: true });
matterAccessSchema.index({ organizationId: 1, userId: 1 });
export const MatterAccessModel = define<MatterAccessDoc>('MatterAccess', matterAccessSchema);

export interface PartyDoc {
  _id: Id;
  organizationId: Id;
  matterId: Id;
  name: string;
  normalizedName: string;
  tokens: string[];
  type: 'individual' | 'organization';
  role: string;
  email?: string;
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
}
const partySchema = new Schema<PartyDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    ...searchable,
    type: { type: String, enum: ['individual', 'organization'], required: true },
    role: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, maxlength: 40 },
  },
  { timestamps: true },
);
partySchema.index({ organizationId: 1, matterId: 1, _id: -1 });
partySchema.index({ organizationId: 1, tokens: 1 });
export const PartyModel = define<PartyDoc>('Party', partySchema);

export interface CounterDoc {
  _id: string;
  seq: number;
}
export const CounterModel = define<CounterDoc>(
  'Counter',
  new Schema<CounterDoc>({ _id: { type: String }, seq: { type: Number, default: 0 } }),
);

export interface ConflictCheckDoc {
  _id: Id;
  organizationId: Id;
  requestedBy: Id;
  names: string[];
  matchCount: number;
  includesRestricted: boolean;
  createdAt: Date;
}
const conflictSchema = new Schema<ConflictCheckDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    names: { type: [String], required: true },
    matchCount: { type: Number, required: true },
    includesRestricted: { type: Boolean, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
conflictSchema.index({ organizationId: 1, _id: -1 });
export const ConflictCheckModel = define<ConflictCheckDoc>('ConflictCheck', conflictSchema);

// ---- Documents, calendar, tasks ----
export const DOCUMENT_VERSION_STATUSES = [
  'pending_upload',
  'scanning',
  'clean',
  'infected',
  'scan_failed',
  'skipped',
] as const;
export type DocumentVersionStatus = (typeof DOCUMENT_VERSION_STATUSES)[number];

export interface DocumentDoc {
  _id: Id;
  organizationId: Id;
  matterId: Id;
  title: string;
  /** Highest version number allocated so far (allocated atomically). */
  latestVersion: number;
  status: 'active' | 'deleted';
  createdBy: Id;
  deletedAt?: Date | null;
  deletedBy?: Id | null;
  createdAt: Date;
  updatedAt: Date;
}
const documentSchema = new Schema<DocumentDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true, maxlength: 250 },
    latestVersion: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'deleted'], default: 'active' },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
documentSchema.index({ organizationId: 1, matterId: 1, status: 1, _id: -1 });
export const DocumentModel = define<DocumentDoc>('Document', documentSchema);

export interface DocumentVersionDoc {
  _id: Id;
  organizationId: Id;
  documentId: Id;
  /** Denormalized so access checks never need a join. */
  matterId: Id;
  version: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Object key in private storage. Never returned by the API; file bytes are never stored in MongoDB. */
  storageKey: string;
  status: DocumentVersionStatus;
  scan?: { engine: string; result?: string; scannedAt: Date } | null;
  uploadedBy: Id;
  completedAt?: Date | null;
  createdAt: Date;
}
const versionSchema = new Schema<DocumentVersionDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    documentId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    filename: { type: String, required: true, maxlength: 255 },
    contentType: { type: String, required: true, maxlength: 150 },
    sizeBytes: { type: Number, required: true, min: 1 },
    storageKey: { type: String, required: true },
    status: { type: String, enum: DOCUMENT_VERSION_STATUSES, required: true },
    scan: {
      type: new Schema({ engine: String, result: String, scannedAt: Date }, { _id: false }),
      default: null,
    },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
versionSchema.index({ organizationId: 1, documentId: 1, version: 1 }, { unique: true });
versionSchema.index({ organizationId: 1, status: 1, createdAt: 1 });
export const DocumentVersionModel = define<DocumentVersionDoc>('DocumentVersion', versionSchema);

export const EVENT_KINDS = ['hearing', 'deadline', 'meeting', 'reminder', 'other'] as const;
export interface CalendarEventDoc {
  _id: Id;
  organizationId: Id;
  matterId?: Id | null;
  kind: (typeof EVENT_KINDS)[number];
  title: string;
  description?: string;
  startsAt: Date;
  endsAt?: Date | null;
  allDay: boolean;
  location?: string;
  attendeeIds: Id[];
  status: 'scheduled' | 'completed' | 'cancelled';
  /** Deadlines are only ever entered by people (or confirmed from AI suggestions in a later phase). */
  source: 'manual';
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const eventSchema = new Schema<CalendarEventDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, default: null },
    kind: { type: String, enum: EVENT_KINDS, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 5000 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    allDay: { type: Boolean, default: false },
    location: { type: String, maxlength: 300 },
    attendeeIds: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
    source: { type: String, enum: ['manual'], default: 'manual' },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
eventSchema.index({ organizationId: 1, startsAt: 1, _id: 1 });
eventSchema.index({ organizationId: 1, matterId: 1, startsAt: 1 });
eventSchema.index({ organizationId: 1, kind: 1, startsAt: 1 });
export const CalendarEventModel = define<CalendarEventDoc>('CalendarEvent', eventSchema);

export interface TaskDoc {
  _id: Id;
  organizationId: Id;
  matterId?: Id | null;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high';
  assigneeId?: Id | null;
  dueAt?: Date | null;
  completedAt?: Date | null;
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const taskSchema = new Schema<TaskDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 5000 },
    status: { type: String, enum: ['todo', 'in_progress', 'done', 'cancelled'], default: 'todo' },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    assigneeId: { type: Schema.Types.ObjectId, default: null },
    dueAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
taskSchema.index({ organizationId: 1, _id: -1 });
taskSchema.index({ organizationId: 1, assigneeId: 1, status: 1, _id: -1 });
taskSchema.index({ organizationId: 1, matterId: 1, _id: -1 });
export const TaskModel = define<TaskDoc>('Task', taskSchema);
