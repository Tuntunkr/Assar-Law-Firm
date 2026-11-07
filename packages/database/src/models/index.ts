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
  billing?: {
    currency: string;
    defaultHourlyRateCents: number | null;
    /** Basis points: 825 = 8.25%. */
    defaultTaxRateBp: number;
    invoiceDueDays: number;
    /** Days relative to the due date for payment reminders (negative = before). Default: -3, 1, 7, 14, 30. */
    reminderDays?: number[];
  };
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
      billing: {
        currency: { type: String, default: 'USD' },
        defaultHourlyRateCents: { type: Number, default: null, min: 0 },
        defaultTaxRateBp: { type: Number, default: 0, min: 0, max: 10000 },
        invoiceDueDays: { type: Number, default: 30, min: 0, max: 365 },
        reminderDays: { type: [Number], default: undefined },
      },
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
  /** Default billing rate for this person; overrides the organization default. */
  hourlyRateCents?: number | null;
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
      enum: ['owner', 'admin', 'attorney', 'paralegal', 'billing', 'staff', 'intern'],
    },
    hourlyRateCents: { type: Number, default: null, min: 0 },
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
  /** `client` sessions belong to portal users (userId is then the client user's id). */
  principal?: 'staff' | 'client';
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
    principal: { type: String, enum: ['staff', 'client'], default: 'staff' },
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
      enum: ['admin', 'attorney', 'paralegal', 'billing', 'staff', 'intern'],
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
  /** Who acted: a staff user, a portal client, an automation service token, or the system/worker. */
  actorType?: 'staff' | 'client' | 'service' | 'system';
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
    actorType: { type: String, enum: ['staff', 'client', 'service', 'system'], default: 'staff' },
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
  /** Set when the client has opted out of WhatsApp. A set date blocks a WhatsApp send. */
  whatsappOptOutAt?: Date | null;
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
    whatsappOptOutAt: { type: Date, default: null },
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
  /** Court details for litigation matters. */
  court?: {
    name?: string;
    caseNumber?: string;
    judge?: string;
    courtroom?: string;
    jurisdiction?: string;
    /** `YYYY-MM-DD` */
    filedOn?: string;
    /** 16-character shape. Not a court lookup. */
    cnr?: string;
    officialUrl?: string;
    trackingSource?: 'manual';
    freshness?: 'unverified' | 'verified_manual';
    verifiedAt?: Date | null;
    verifiedBy?: Id | null;
  } | null;
  status: 'open' | 'pending' | 'closed' | 'archived';
  /** Restricted matters are visible only to users in matter_access (plus the owner, audited). */
  restricted: boolean;
  /** Published to the client portal. Nothing is visible to the client until a staff member sets this. */
  portalVisible?: boolean;
  /** Client-facing status message. */
  portalNote?: string | null;
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
    court: {
      type: new Schema(
        {
          name: { type: String, maxlength: 200 },
          caseNumber: { type: String, maxlength: 100 },
          judge: { type: String, maxlength: 150 },
          courtroom: { type: String, maxlength: 100 },
          jurisdiction: { type: String, maxlength: 150 },
          filedOn: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
          cnr: { type: String, uppercase: true, match: /^[A-Z0-9]{16}$/ },
          officialUrl: { type: String, maxlength: 500 },
          trackingSource: { type: String, enum: ['manual'], default: 'manual' },
          freshness: {
            type: String,
            enum: ['unverified', 'verified_manual'],
            default: 'unverified',
          },
          verifiedAt: { type: Date, default: null },
          verifiedBy: { type: Schema.Types.ObjectId, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    status: { type: String, enum: ['open', 'pending', 'closed', 'archived'], default: 'open' },
    restricted: { type: Boolean, default: false },
    portalVisible: { type: Boolean, default: false },
    portalNote: { type: String, maxlength: 1000, default: null },
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
matterSchema.index({ organizationId: 1, 'court.cnr': 1 });
matterSchema.index({ organizationId: 1, 'court.name': 1 });
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
  /** Shared with the client portal (per version, explicit). */
  clientVisible?: boolean;
  clientSharedAt?: Date | null;
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
    clientVisible: { type: Boolean, default: false },
    clientSharedAt: { type: Date, default: null },
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

/** Largest amount of extracted text kept per version (characters). Longer documents are cut and flagged. */
export const MAX_STORED_TEXT_CHARS = 2_000_000;
export const TEXT_STATUSES = ['pending', 'processing', 'done', 'failed'] as const;
export type TextStatus = (typeof TEXT_STATUSES)[number];

/**
 * The text read from one document version (by parsing, or by OCR for scans). Kept apart from the version
 * row so listing documents never loads it. It is as sensitive as the file itself: every read goes through
 * the same matter-access checks, and it never appears in logs or audit entries.
 */
export interface DocumentTextDoc {
  _id: Id;
  organizationId: Id;
  /** Denormalized so access filters need no join. */
  matterId: Id;
  documentId: Id;
  versionId: Id;
  version: number;
  status: TextStatus;
  method?: 'text' | 'ocr' | 'mixed' | null;
  pages?: number | null;
  ocrPages?: number | null;
  /** Mean OCR confidence, 0–100. */
  confidence?: number | null;
  /** The text was cut at the page or size limit. */
  truncated?: boolean;
  chars?: number | null;
  text?: string;
  /** Stable code and a message that never contains document content. */
  error?: { code: string; message: string } | null;
  extractedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const documentTextSchema = new Schema<DocumentTextDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, required: true },
    documentId: { type: Schema.Types.ObjectId, required: true },
    versionId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    status: { type: String, enum: TEXT_STATUSES, default: 'pending' },
    method: { type: String, enum: ['text', 'ocr', 'mixed', null], default: null },
    pages: { type: Number, default: null },
    ocrPages: { type: Number, default: null },
    confidence: { type: Number, default: null },
    truncated: { type: Boolean, default: false },
    chars: { type: Number, default: null },
    text: { type: String, maxlength: MAX_STORED_TEXT_CHARS + 1000 },
    error: {
      type: new Schema({ code: String, message: String }, { _id: false }),
      default: null,
    },
    extractedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
documentTextSchema.index({ organizationId: 1, versionId: 1 }, { unique: true });
documentTextSchema.index({ organizationId: 1, documentId: 1, version: -1 });
documentTextSchema.index({ organizationId: 1, status: 1, updatedAt: 1 });
// Full-text search is always scoped by organizationId (an equality prefix on the compound index).
// `none` turns off stemming and stop words, so Hindi and other languages are tokenised the same way.
documentTextSchema.index({ organizationId: 1, text: 'text' }, { default_language: 'none' });
export const DocumentTextModel = define<DocumentTextDoc>('DocumentText', documentTextSchema);

/** A reusable document with `{{placeholders}}`: notices, contracts, engagement letters and so on. */
export interface DraftTemplateDoc {
  _id: Id;
  organizationId: Id;
  name: string;
  nameLower: string;
  category: string;
  description?: string | null;
  body: string;
  /** Derived from `body` on every save; never trusted from a client. */
  placeholders: string[];
  status: 'active' | 'archived';
  /** Set for templates that shipped with the product, so seeding is idempotent. */
  starterKey?: string | null;
  revision: number;
  createdBy: Id;
  updatedBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const draftTemplateSchema = new Schema<DraftTemplateDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    nameLower: { type: String, required: true },
    category: { type: String, required: true },
    description: { type: String, maxlength: 500, default: null },
    body: { type: String, required: true, maxlength: 50_000 },
    placeholders: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    starterKey: { type: String, default: null },
    revision: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
draftTemplateSchema.index({ organizationId: 1, nameLower: 1 }, { unique: true });
draftTemplateSchema.index(
  { organizationId: 1, starterKey: 1 },
  { unique: true, partialFilterExpression: { starterKey: { $type: 'string' } } },
);
draftTemplateSchema.index({ organizationId: 1, status: 1, category: 1 });
export const DraftTemplateModel = define<DraftTemplateDoc>('DraftTemplate', draftTemplateSchema);

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
  /** Entered by a person. Court systems do not write this row. */
  source: 'manual';
  outcome?: {
    result: string;
    notes: string;
    nextHearingOn?: string | null;
    reviewStatus: 'draft' | 'reviewed';
    recordedBy: Id;
    recordedAt: Date;
    reviewedBy?: Id | null;
    reviewedAt?: Date | null;
  } | null;
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
    outcome: {
      type: new Schema(
        {
          result: { type: String, required: true },
          notes: { type: String, required: true, maxlength: 5000 },
          nextHearingOn: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
          reviewStatus: { type: String, enum: ['draft', 'reviewed'], required: true },
          recordedBy: { type: Schema.Types.ObjectId, required: true },
          recordedAt: { type: Date, required: true },
          reviewedBy: { type: Schema.Types.ObjectId, default: null },
          reviewedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
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
  /** `workflow` when created by an automation service token (createdBy is then the token id). */
  createdVia?: 'user' | 'workflow';
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
    createdVia: { type: String, enum: ['user', 'workflow'], default: 'user' },
  },
  { timestamps: true },
);
taskSchema.index({ organizationId: 1, _id: -1 });
taskSchema.index({ organizationId: 1, assigneeId: 1, status: 1, _id: -1 });
taskSchema.index({ organizationId: 1, matterId: 1, _id: -1 });
export const TaskModel = define<TaskDoc>('Task', taskSchema);

// ---- AI jobs & outputs ----
export const AI_JOB_STATUSES = [
  'queued',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];
export const AI_STAGES = ['extracting_text', 'generating', 'saving'] as const;

export interface AiJobDoc {
  _id: Id;
  organizationId: Id;
  /** Matter-scoped jobs. Exactly one of `matterId` / `clientId` is set. */
  matterId?: Id | null;
  /** Client-level jobs (`case_history`): private to `requestedBy`. */
  clientId?: Id | null;
  requestedBy: Id;
  task: string;
  /** Pinned source versions. */
  documents: { documentId: Id; version: number }[];
  instructions?: string;
  /** Written only by the worker/API as work really happens; never an estimate. */
  status: AiJobStatus;
  stage?: (typeof AI_STAGES)[number] | null;
  /** Attempts actually started. */
  attempts: number;
  maxAttempts: number;
  /** Incremented on each manual retry so queue job ids stay unique. */
  runNumber: number;
  cancelRequested: boolean;
  /** Last failure (kept while retrying so the UI can show why). Messages never contain document text. */
  error?: { code: string; message: string; retryable: boolean } | null;
  model?: string | null;
  usage?: { promptTokens: number; completionTokens: number } | null;
  outputId?: Id | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const aiJobSchema = new Schema<AiJobDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, default: null },
    clientId: { type: Schema.Types.ObjectId, default: null },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    task: { type: String, required: true },
    documents: {
      type: [new Schema({ documentId: Schema.Types.ObjectId, version: Number }, { _id: false })],
      default: [],
    },
    instructions: { type: String, maxlength: 4000 },
    status: { type: String, enum: AI_JOB_STATUSES, default: 'queued' },
    stage: { type: String, enum: [...AI_STAGES, null], default: null },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    runNumber: { type: Number, default: 1 },
    cancelRequested: { type: Boolean, default: false },
    error: {
      type: new Schema({ code: String, message: String, retryable: Boolean }, { _id: false }),
      default: null,
    },
    model: { type: String, default: null },
    usage: {
      type: new Schema({ promptTokens: Number, completionTokens: Number }, { _id: false }),
      default: null,
    },
    outputId: { type: Schema.Types.ObjectId, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
aiJobSchema.pre('validate', function () {
  if (!this.matterId === !this.clientId)
    this.invalidate('matterId', 'A job belongs to exactly one matter or one client');
});
aiJobSchema.index({ organizationId: 1, _id: -1 });
aiJobSchema.index({ organizationId: 1, status: 1, _id: -1 });
aiJobSchema.index({ organizationId: 1, matterId: 1, _id: -1 });
export const AiJobModel = define<AiJobDoc>('AiJob', aiJobSchema);

export interface AiSourceRef {
  sourceId: string;
  /** Absent for generated sources such as the client's case-file index. */
  documentId?: Id | null;
  version: number;
  filename: string;
  title: string;
  chars: number;
  truncated: boolean;
}
export interface AiOutputDoc {
  _id: Id;
  organizationId: Id;
  matterId?: Id | null;
  clientId?: Id | null;
  jobId: Id;
  task: string;
  requestedBy: Id;
  /** Structured, server-verified model output. Always AI-generated and unverified until reviewed. */
  result: Record<string, unknown>;
  sources: AiSourceRef[];
  reviewStatus: 'draft' | 'approved' | 'rejected';
  /** Approved outputs are only visible to the client after being shared explicitly. */
  sharedWithClient?: boolean;
  sharedAt?: Date | null;
  sharedBy?: Id | null;
  reviewedBy?: Id | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
  /** Reviewer's own edit of the text, kept separate from the model's original. */
  editedText?: string | null;
  editedBy?: Id | null;
  editedAt?: Date | null;
  model: string;
  createdAt: Date;
}
const aiOutputSchema = new Schema<AiOutputDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, default: null },
    clientId: { type: Schema.Types.ObjectId, default: null },
    jobId: { type: Schema.Types.ObjectId, required: true },
    task: { type: String, required: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    result: { type: Schema.Types.Mixed, required: true },
    sources: { type: Schema.Types.Mixed, default: [] },
    reviewStatus: { type: String, enum: ['draft', 'approved', 'rejected'], default: 'draft' },
    sharedWithClient: { type: Boolean, default: false },
    sharedAt: { type: Date, default: null },
    sharedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, maxlength: 2000, default: null },
    editedText: { type: String, maxlength: 100_000, default: null },
    editedBy: { type: Schema.Types.ObjectId, default: null },
    editedAt: { type: Date, default: null },
    model: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
aiOutputSchema.pre('validate', function () {
  if (!this.matterId === !this.clientId)
    this.invalidate('matterId', 'An output belongs to exactly one matter or one client');
});
aiOutputSchema.index({ organizationId: 1, jobId: 1 }, { unique: true });
aiOutputSchema.index({ organizationId: 1, clientId: 1, _id: -1 });
aiOutputSchema.index({ organizationId: 1, matterId: 1, _id: -1 });
aiOutputSchema.index({ organizationId: 1, reviewStatus: 1, _id: -1 });
export const AiOutputModel = define<AiOutputDoc>('AiOutput', aiOutputSchema);

// ---- Client portal, notifications, automation ----
export interface ClientUserDoc {
  _id: Id;
  organizationId: Id;
  /** The client record this portal user belongs to: the ONLY client whose data they can see. */
  clientId: Id;
  email: string;
  name: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  failedLoginCount: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const clientUserSchema = new Schema<ClientUserDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
clientUserSchema.index({ organizationId: 1, email: 1 }, { unique: true });
clientUserSchema.index({ organizationId: 1, clientId: 1 });
export const ClientUserModel = define<ClientUserDoc>('ClientUser', clientUserSchema);

export interface PortalInvitationDoc {
  _id: Id;
  organizationId: Id;
  clientId: Id;
  email: string;
  name?: string;
  tokenHash: string;
  invitedBy: Id;
  expiresAt: Date;
  acceptedAt?: Date | null;
  createdAt: Date;
}
const portalInvitationSchema = new Schema<PortalInvitationDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, maxlength: 100 },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
portalInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
portalInvitationSchema.index({ organizationId: 1, clientId: 1 });
export const PortalInvitationModel = define<PortalInvitationDoc>(
  'PortalInvitation',
  portalInvitationSchema,
);

export interface ServiceTokenDoc {
  _id: Id;
  organizationId: Id;
  name: string;
  /** First characters of the token, for recognising it in a list. The full token is shown once. */
  prefix: string;
  tokenHash: string;
  scopes: string[];
  status: 'active' | 'revoked';
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  createdBy: Id;
  revokedAt?: Date | null;
  createdAt: Date;
}
const serviceTokenSchema = new Schema<ServiceTokenDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    prefix: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    expiresAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
serviceTokenSchema.index({ organizationId: 1, status: 1 });
export const ServiceTokenModel = define<ServiceTokenDoc>('ServiceToken', serviceTokenSchema);

export interface NotificationDoc {
  _id: Id;
  organizationId: Id;
  userId: Id;
  title: string;
  body?: string;
  link?: { type: string; id: string } | null;
  /** Makes creation idempotent (e.g. one reminder per item per day). */
  dedupeKey?: string;
  source: 'workflow' | 'system';
  readAt?: Date | null;
  createdAt: Date;
}
const notificationSchema = new Schema<NotificationDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, maxlength: 1000 },
    link: {
      type: new Schema({ type: String, id: String }, { _id: false }),
      default: null,
    },
    dedupeKey: { type: String, maxlength: 200 },
    source: { type: String, enum: ['workflow', 'system'], default: 'workflow' },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ organizationId: 1, userId: 1, _id: -1 });
notificationSchema.index({ organizationId: 1, userId: 1, readAt: 1 });
notificationSchema.index(
  { organizationId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
export const NotificationModel = define<NotificationDoc>('Notification', notificationSchema);

// ---- Billing ----
export interface TimeEntryDoc {
  _id: Id;
  organizationId: Id;
  matterId: Id;
  /** Denormalized from the matter (which cannot change client) so reports don't need a join. */
  clientId: Id;
  /** Who did the work. */
  userId: Id;
  /** The day the work was done (UTC midnight). */
  workDate: Date;
  minutes: number;
  /** Free text. Treat as confidential: never logged, never put in audit metadata. */
  description: string;
  billable: boolean;
  /** Rate in effect when the entry was logged; later rate changes never rewrite history. */
  rateCents: number;
  currency: string;
  /** minutes x rate, rounded half up in integers; 0 when not billable. */
  amountCents: number;
  status: 'unbilled' | 'invoiced';
  invoiceId?: Id | null;
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const timeEntrySchema = new Schema<TimeEntryDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, required: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    workDate: { type: Date, required: true },
    minutes: { type: Number, required: true, min: 1, max: 1440 },
    description: { type: String, required: true, maxlength: 1000 },
    billable: { type: Boolean, default: true },
    rateCents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    amountCents: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['unbilled', 'invoiced'], default: 'unbilled' },
    invoiceId: { type: Schema.Types.ObjectId, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
timeEntrySchema.index({ organizationId: 1, workDate: -1, _id: -1 });
timeEntrySchema.index({ organizationId: 1, matterId: 1, status: 1 });
timeEntrySchema.index({ organizationId: 1, userId: 1, workDate: -1 });
timeEntrySchema.index({ organizationId: 1, invoiceId: 1 });
export const TimeEntryModel = define<TimeEntryDoc>('TimeEntry', timeEntrySchema);

export interface InvoiceLine {
  _id: Id;
  type: 'time' | 'expense' | 'adjustment';
  description: string;
  matterId?: Id | null;
  timeEntryId?: Id | null;
  minutes?: number | null;
  rateCents?: number | null;
  /** Negative only for adjustments (discounts). */
  amountCents: number;
}
export interface InvoicePayment {
  _id: Id;
  amountCents: number;
  paidAt: Date;
  method: string;
  reference?: string;
  recordedBy: Id;
}
export interface InvoiceDoc {
  _id: Id;
  organizationId: Id;
  /** Assigned when the invoice is issued, so drafts leave no gaps in the sequence. */
  number?: string | null;
  clientId: Id;
  status: 'draft' | 'issued' | 'paid' | 'void';
  currency: string;
  lines: InvoiceLine[];
  /** Distinct matters on the lines, used to hide invoices that touch matters a viewer cannot see. */
  matterIds: Id[];
  subtotalCents: number;
  taxRateBp: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  payments: InvoicePayment[];
  dueDays: number;
  notes?: string;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  paidAt?: Date | null;
  voidedAt?: Date | null;
  voidReason?: string | null;
  /** A log of times someone contacted the client about payment (newest last, at most 50). */
  reminders?: {
    _id: Id;
    at: Date;
    channel: string;
    note?: string | null;
    by: Id;
  }[];
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const invoiceSchema = new Schema<InvoiceDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    number: { type: String, default: null },
    clientId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['draft', 'issued', 'paid', 'void'], default: 'draft' },
    currency: { type: String, required: true },
    lines: {
      type: [
        new Schema({
          type: { type: String, enum: ['time', 'expense', 'adjustment'], required: true },
          description: { type: String, required: true, maxlength: 1000 },
          matterId: { type: Schema.Types.ObjectId, default: null },
          timeEntryId: { type: Schema.Types.ObjectId, default: null },
          minutes: { type: Number, default: null },
          rateCents: { type: Number, default: null },
          amountCents: { type: Number, required: true },
        }),
      ],
      default: [],
    },
    matterIds: { type: [Schema.Types.ObjectId], default: [] },
    subtotalCents: { type: Number, default: 0 },
    taxRateBp: { type: Number, default: 0, min: 0, max: 10000 },
    taxCents: { type: Number, default: 0 },
    totalCents: { type: Number, default: 0 },
    amountPaidCents: { type: Number, default: 0 },
    balanceCents: { type: Number, default: 0 },
    payments: {
      type: [
        new Schema({
          amountCents: { type: Number, required: true, min: 1 },
          paidAt: { type: Date, required: true },
          method: { type: String, required: true },
          reference: { type: String, maxlength: 200 },
          recordedBy: { type: Schema.Types.ObjectId, required: true },
        }),
      ],
      default: [],
    },
    dueDays: { type: Number, default: 30 },
    notes: { type: String, maxlength: 2000 },
    issuedAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, maxlength: 500, default: null },
    reminders: {
      type: [
        new Schema({
          at: { type: Date, required: true },
          channel: { type: String, required: true },
          note: { type: String, maxlength: 500, default: null },
          by: { type: Schema.Types.ObjectId, required: true },
        }),
      ],
      default: [],
    },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
invoiceSchema.index(
  { organizationId: 1, number: 1 },
  { unique: true, partialFilterExpression: { number: { $type: 'string' } } },
);
invoiceSchema.index({ organizationId: 1, _id: -1 });
invoiceSchema.index({ organizationId: 1, status: 1, dueAt: 1 });
invoiceSchema.index({ organizationId: 1, clientId: 1, _id: -1 });
export const InvoiceModel = define<InvoiceDoc>('Invoice', invoiceSchema);

export const DEADLINE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'closed',
] as const;
export interface DeadlineDoc {
  _id: Id;
  organizationId: Id;
  matterId: Id;
  kind: 'limitation' | 'other_deadline';
  title: string;
  basisNote: string;
  /** `YYYY-MM-DD` in Asia/Kolkata. Typed by a person. */
  dueOn: string;
  reminderDaysBefore: number[];
  escalateAfterDays: number;
  status: (typeof DEADLINE_STATUSES)[number];
  history: { at: Date; actorId: Id; action: string; note?: string | null }[];
  approvedBy?: Id | null;
  approvedAt?: Date | null;
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const deadlineSchema = new Schema<DeadlineDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['limitation', 'other_deadline'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    basisNote: { type: String, required: true, maxlength: 5000 },
    dueOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reminderDaysBefore: { type: [Number], default: [7, 3, 1, 0] },
    escalateAfterDays: { type: Number, default: 1 },
    status: { type: String, enum: DEADLINE_STATUSES, default: 'draft' },
    history: {
      type: [
        new Schema(
          {
            at: { type: Date, required: true },
            actorId: { type: Schema.Types.ObjectId, required: true },
            action: { type: String, required: true },
            note: { type: String, maxlength: 500, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    approvedBy: { type: Schema.Types.ObjectId, default: null },
    approvedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
deadlineSchema.index({ organizationId: 1, matterId: 1, dueOn: 1 });
deadlineSchema.index({ organizationId: 1, status: 1, dueOn: 1 });
export const DeadlineModel = define<DeadlineDoc>('Deadline', deadlineSchema);

export interface OutboxDoc {
  _id: Id;
  organizationId: Id;
  clientId: Id;
  matterId?: Id | null;
  channel: 'email' | 'whatsapp';
  templateLabel: string;
  /** Cloud API template name. Present does not mean Meta has approved it. */
  templateName?: string | null;
  templateLanguage?: string | null;
  bodyParameters?: string[];
  body: string;
  /** Always `not_claimed`. This product does not mark a provider template as approved. */
  providerTemplateApproval: 'not_claimed';
  consent: {
    optedIn: true;
    namesFirm: true;
    note?: string | null;
    recordedBy: Id;
    recordedAt: Date;
  };
  status:
    | 'draft'
    | 'pending_approval'
    | 'rejected'
    | 'mock_delivered'
    | 'external_activation_gate'
    | 'accepted'
    | 'sent'
    | 'delivered'
    | 'read'
    | 'played'
    | 'failed';
  provider: 'mock' | 'unconfigured' | 'whatsapp_cloud';
  attempts: number;
  providerMessageId?: string;
  providerError?: string | null;
  approvedBy?: Id | null;
  approvedAt?: Date | null;
  webhookEventIds: string[];
  createdBy: Id;
  createdAt: Date;
  updatedAt: Date;
}
const outboxSchema = new Schema<OutboxDoc>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    matterId: { type: Schema.Types.ObjectId, default: null },
    channel: { type: String, enum: ['email', 'whatsapp'], required: true },
    templateLabel: { type: String, required: true, maxlength: 120 },
    templateName: { type: String, maxlength: 512 },
    templateLanguage: { type: String, maxlength: 16 },
    bodyParameters: { type: [String], default: [] },
    body: { type: String, required: true, maxlength: 5000 },
    providerTemplateApproval: { type: String, enum: ['not_claimed'], default: 'not_claimed' },
    consent: {
      type: new Schema(
        {
          optedIn: { type: Boolean, required: true },
          namesFirm: { type: Boolean, required: true },
          note: { type: String, maxlength: 500, default: null },
          recordedBy: { type: Schema.Types.ObjectId, required: true },
          recordedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    status: {
      type: String,
      enum: [
        'draft',
        'pending_approval',
        'rejected',
        'mock_delivered',
        'external_activation_gate',
        'accepted',
        'sent',
        'delivered',
        'read',
        'played',
        'failed',
      ],
      default: 'draft',
    },
    provider: {
      type: String,
      enum: ['mock', 'unconfigured', 'whatsapp_cloud'],
      default: 'unconfigured',
    },
    attempts: { type: Number, default: 0 },
    providerMessageId: { type: String },
    providerError: { type: String, maxlength: 80, default: null },
    approvedBy: { type: Schema.Types.ObjectId, default: null },
    approvedAt: { type: Date, default: null },
    webhookEventIds: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
outboxSchema.index({ organizationId: 1, _id: -1 });
outboxSchema.index({ organizationId: 1, status: 1, _id: -1 });
outboxSchema.index({ organizationId: 1, clientId: 1, matterId: 1, status: 1 });
outboxSchema.index({ providerMessageId: 1 }, { unique: true, sparse: true });
export const OutboxModel = define<OutboxDoc>('Outbox', outboxSchema);
