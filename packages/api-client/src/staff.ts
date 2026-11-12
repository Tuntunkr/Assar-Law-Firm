import type { Page, Permission, ReminderChannel, Role } from '@assar/types';
import { Http, type ClientOptions, type DownloadLink } from './index.js';

// ---- DTOs: mirror the shapes the API returns (see the *Dto functions in apps/api) ----
export interface StaffMe {
  user: { id: string; email: string; name: string; lastLoginAt?: string | null };
  organization: { id: string; name: string; slug: string };
  role: Role;
  permissions: Permission[];
  mfa: { enabled: boolean; enrollmentRequired: boolean };
  csrfToken: string;
}
export interface SessionDto {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}
export interface ClientDto {
  id: string;
  type: 'individual' | 'organization';
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}
export interface CourtDto {
  name: string | null;
  caseNumber: string | null;
  judge: string | null;
  courtroom: string | null;
  jurisdiction: string | null;
  filedOn: string | null;
}
export interface MatterDto {
  id: string;
  matterNumber: string;
  clientId: string;
  title: string;
  practiceArea: string;
  description: string | null;
  court: CourtDto | null;
  status: 'open' | 'pending' | 'closed' | 'archived';
  restricted: boolean;
  portalVisible: boolean;
  portalNote: string | null;
  leadAttorneyId: string | null;
  teamIds: string[];
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PartyDto {
  id: string;
  matterId: string;
  name: string;
  type: 'individual' | 'organization';
  role: string;
  email: string | null;
  phone: string | null;
}
export interface TeamDto {
  id: string;
  name: string;
  description: string | null;
  userIds: string[];
}
export interface MemberDto {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'disabled';
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}
export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  token?: string;
}
export interface TaskDto {
  id: string;
  matterId: string | null;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high';
  assigneeId: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
export interface EventDto {
  id: string;
  matterId: string | null;
  kind: 'hearing' | 'deadline' | 'meeting' | 'reminder' | 'other';
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  attendeeIds: string[];
  status: 'scheduled' | 'completed' | 'cancelled';
}
export interface TextStatusDto {
  status: 'pending' | 'processing' | 'done' | 'failed';
  method: 'text' | 'ocr' | 'mixed' | null;
  pages: number | null;
  ocrPages: number | null;
  /** Mean OCR confidence, 0–100. */
  confidence: number | null;
  chars: number | null;
  truncated: boolean;
  error: { code: string; message: string } | null;
}
export interface DocumentVersionDto {
  version: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  scanResult: string | null;
  createdAt: string;
  /** Present on a document's detail; null until the text has been requested. */
  text?: TextStatusDto | null;
}
export interface VersionTextDto extends Partial<Omit<TextStatusDto, 'status'>> {
  status: 'none' | TextStatusDto['status'];
  text?: string;
  textTruncated?: boolean;
}
export interface TextSearchHit {
  documentId: string;
  title: string;
  matter: { id: string; matterNumber: string; title: string; clientId: string } | null;
  version: number;
  method: 'text' | 'ocr' | 'mixed' | null;
  snippet: string;
}
export interface SimilarDocument {
  documentId: string;
  title: string;
  matter: { id: string; matterNumber: string; title: string; clientId: string } | null;
  version: number;
  /** 0 to 1. */
  similarity: number;
  sharedTerms: string[];
}
export interface DocumentDto {
  id: string;
  matterId: string;
  title: string;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}
export interface TimelineEntryDto {
  at: string;
  type: string;
  title: string;
  detail: string | null;
  actorId: string | null;
  matterId: string | null;
  ref: { type: string; id: string } | null;
}
export interface TimelinePage {
  data: TimelineEntryDto[];
  page: { nextBefore: string | null; limit: number };
}
export interface TemplateSummaryDto {
  id: string;
  name: string;
  category: string;
  description: string | null;
  placeholders: string[];
  status: 'active' | 'archived';
  /** Shipped with the product (still editable). */
  starter: boolean;
  revision: number;
  updatedAt: string;
}
export interface TemplateDto extends TemplateSummaryDto {
  body: string;
}
export interface RenderedTemplateDto {
  text: string;
  missing: string[];
  placeholders: {
    key: string;
    label: string | null;
    builtin: boolean;
    value: string | null;
    missing: boolean;
  }[];
}
export interface UploadRequest {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}
export interface DocumentListItem extends DocumentDto {
  latest: DocumentVersionDto | null;
  matter: { id: string; matterNumber: string; title: string; clientId: string } | null;
}
export interface AiJobDto {
  id: string;
  matterId: string | null;
  clientId: string | null;
  task: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  stage: string | null;
  attempts: number;
  maxAttempts: number;
  error: { code: string; message: string; retryable: boolean } | null;
  outputId: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface AiOutputDto {
  id: string;
  jobId: string;
  matterId: string | null;
  clientId: string | null;
  task: string;
  reviewStatus: 'draft' | 'approved' | 'rejected';
  label: string;
  result: unknown;
  sources: unknown;
  editedText: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  model: string | null;
  createdAt: string;
}
export interface AssistantThreadDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
export interface AssistantProposalDto {
  tool: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'confirming' | 'done';
}
export interface AssistantMessageDto {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  body: string;
  route: 'help' | 'lookup' | 'action' | 'refuse' | null;
  toolName: string | null;
  proposal: AssistantProposalDto | null;
  createdAt: string;
}
export interface AssistantThreadDetailDto extends AssistantThreadDto {
  messages: AssistantMessageDto[];
}
export interface TimeEntryDto {
  id: string;
  matterId: string;
  clientId: string;
  userId: string;
  workDate: string;
  minutes: number;
  description: string;
  billable: boolean;
  rateCents: number;
  currency: string;
  amountCents: number;
  status: 'unbilled' | 'invoiced';
  invoiceId: string | null;
}
export interface InvoiceSummaryDto {
  id: string;
  number: string | null;
  clientId: string;
  status: 'draft' | 'issued' | 'paid' | 'void';
  currency: string;
  subtotalCents: number;
  taxRateBp: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
}
export interface InvoiceDto extends InvoiceSummaryDto {
  dueDays: number;
  notes: string | null;
  voidReason: string | null;
  lines: {
    id: string;
    type: 'time' | 'expense' | 'adjustment';
    description: string;
    matterId: string | null;
    minutes: number | null;
    rateCents: number | null;
    amountCents: number;
  }[];
  payments: {
    id: string;
    amountCents: number;
    paidAt: string;
    method: string;
    reference: string | null;
  }[];
  reminders: {
    id: string;
    at: string;
    channel: ReminderChannel;
    note: string | null;
    by: string;
  }[];
}
export interface InvoiceReminderDraftDto {
  daysPastDue: number;
  step: number | null;
  text: string;
}
export interface BillingSettingsDto {
  currency: string;
  defaultHourlyRateCents: number | null;
  defaultTaxRateBp: number;
  invoiceDueDays: number;
}
export interface TimeReportDto {
  from: string;
  to: string;
  groupBy: string;
  restrictedMattersExcluded: boolean;
  rows: {
    key: string;
    label: string | null;
    entries: number;
    hours: number;
    billableHours: number;
    billableAmountCents: number;
    unbilledAmountCents: number;
  }[];
}
export interface AgingDto {
  asOf: string;
  restrictedMattersExcluded: boolean;
  buckets: Record<
    'notYetDue' | 'days1to30' | 'days31to60' | 'days61to90' | 'over90',
    { count: number; cents: number }
  >;
  totalCents: number;
}
export type BillingSummaryDto = Record<string, unknown> & {
  from: string;
  to: string;
  restrictedMattersExcluded: boolean;
  unbilledHours: number;
};
export interface AuditLogDto {
  id: string;
  action: string;
  actorId: string | null;
  actorType: string;
  targetType: string | null;
  targetId: string | null;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
}
export interface NotificationPage extends Page<NotificationDto> {
  unread: number;
}
export interface NotificationDto {
  id: string;
  title: string;
  body: string | null;
  link: { type: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
}
export interface ServiceTokenDto {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  token?: string;
}
export interface ConflictMatchDto {
  matchType: 'exact' | 'similar';
  source: string;
  restricted: boolean;
  name?: string;
  matterId?: string;
  matterNumber?: string;
  matterTitle?: string;
}
export interface ConflictResultDto {
  checkedAt: string;
  notice: string;
  results: { query: string; matches: ConflictMatchDto[] }[];
}
export interface PortalAccessDto {
  users: { id: string; name: string; email: string; status: string; lastLoginAt: string | null }[];
  invitations: { id: string; email: string; expiresAt: string }[];
}

type Q = Record<string, string | number | boolean | undefined | null>;
const qs = (q?: Q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q ?? {}))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
/** A fresh key per user action so a double click or a retry never creates a second record. */
const idem = () => ({ 'idempotency-key': crypto.randomUUID() });

/** Typed client for the staff API (`/v1/*`). Cookie session + CSRF are handled by the shared Http core. */
export function createStaffClient(options: ClientOptions) {
  const http = new Http(options);
  const keep = (me: StaffMe) => (http.setCsrf(me.csrfToken), me);
  const get = <T>(path: string, q?: Q) => http.request<T>('GET', `/v1${path}${qs(q)}`);
  const post = <T>(path: string, body: unknown = {}, headers?: Record<string, string>) =>
    http.request<T>('POST', `/v1${path}`, body, { headers });
  const put = <T>(path: string, body: unknown) => http.request<T>('PUT', `/v1${path}`, body);
  const patch = <T>(path: string, body: unknown) => http.request<T>('PATCH', `/v1${path}`, body);
  const del = <T = void>(path: string) => http.request<T>('DELETE', `/v1${path}`);
  type L<T> = Promise<Page<T>>;

  return {
    // auth
    login: (input: { email: string; password: string; mfaCode?: string }) =>
      http.request<StaffMe>('POST', '/v1/auth/login', input, { auth: false }).then(keep),
    register: (b: { organizationName: string; name: string; email: string; password: string }) =>
      http.request<StaffMe>('POST', '/v1/auth/register', b, { auth: false }).then(keep),
    acceptInvitation: (b: { token: string; name: string; password: string }) =>
      http.request<{ ok: true }>('POST', '/v1/auth/accept-invitation', b, { auth: false }),
    me: () => get<StaffMe>('/auth/me').then(keep),
    updateProfile: (name: string) => patch<StaffMe>('/auth/profile', { name }),
    sessions: () => get<{ data: SessionDto[] }>('/auth/sessions'),
    revokeSession: (id: string) => del(`/auth/sessions/${id}`),
    revokeOtherSessions: () => post<void>('/auth/sessions/revoke-others'),
    logout: () => post<void>('/auth/logout').finally(() => http.setCsrf(null)),
    changePassword: (b: { currentPassword: string; newPassword: string }) =>
      post<void>('/auth/change-password', b),
    mfaSetup: () => post<{ otpauthUri: string; secret: string }>('/auth/mfa/setup'),
    mfaEnable: (code: string) => post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code }),
    mfaDisable: (b: { password: string; code: string }) => post<void>('/auth/mfa/disable', b),

    // organization & people
    organization: () => get<{ id: string; name: string; slug: string }>('/organization'),
    renameOrganization: (name: string) => patch('/organization', { name }),
    members: (q?: Q) => get<Page<MemberDto>>('/organization/members', q),
    updateMember: (id: string, b: { role?: string; status?: string }) =>
      patch(`/organization/members/${id}`, b),
    invitations: () => get<{ data: InvitationDto[] }>('/organization/invitations'),
    invite: (b: { email: string; role: string }) =>
      post<InvitationDto>('/organization/invitations', b, idem()),
    revokeInvitation: (id: string) => del(`/organization/invitations/${id}`),
    teams: (q?: Q): L<TeamDto> => get('/teams', q),
    createTeam: (b: { name: string; description?: string; userIds?: string[] }) =>
      post<TeamDto>('/teams', b),
    setTeamMembers: (id: string, userIds: string[]) => put(`/teams/${id}/members`, { userIds }),
    deleteTeam: (id: string) => del(`/teams/${id}`),
    auditLogs: (q?: Q): L<AuditLogDto> => get('/audit-logs', q),

    // clients
    clients: (q?: Q): L<ClientDto> => get('/clients', q),
    client: (id: string) => get<ClientDto>(`/clients/${id}`),
    createClient: (b: Partial<ClientDto> & { type: string; name: string }) =>
      post<ClientDto>('/clients', b, idem()),
    updateClient: (id: string, b: Record<string, unknown>) => patch<ClientDto>(`/clients/${id}`, b),
    portalAccess: (clientId: string) => get<PortalAccessDto>(`/clients/${clientId}/portal-access`),
    invitePortalUser: (clientId: string, b: { email: string; name?: string }) =>
      post<{ token?: string }>(`/clients/${clientId}/portal-invitations`, b, idem()),
    setPortalUserStatus: (clientId: string, userId: string, status: 'active' | 'disabled') =>
      patch(`/clients/${clientId}/portal-users/${userId}`, { status }),
    conflictCheck: (names: string[]) => post<ConflictResultDto>('/conflict-checks', { names }),

    // matters
    matters: (q?: Q): L<MatterDto> => get('/matters', q),
    matter: (id: string) => get<MatterDto>(`/matters/${id}`),
    createMatter: (b: Record<string, unknown>) => post<MatterDto>('/matters', b, idem()),
    updateMatter: (id: string, b: Record<string, unknown>) => patch<MatterDto>(`/matters/${id}`, b),
    parties: (id: string) => get<{ data: PartyDto[] }>(`/matters/${id}/parties`),
    addParty: (id: string, b: Record<string, unknown>) =>
      post<PartyDto>(`/matters/${id}/parties`, b),
    removeParty: (id: string, partyId: string) => del(`/matters/${id}/parties/${partyId}`),
    matterAccess: (id: string) =>
      get<{ restricted: boolean; userIds: string[] }>(`/matters/${id}/access`),
    setMatterAccess: (id: string, b: { restricted: boolean; userIds: string[] }) =>
      put(`/matters/${id}/access`, b),
    setMatterPortal: (id: string, b: { visible: boolean; note?: string | null }) =>
      put(`/matters/${id}/portal`, b),

    // templates
    templates: (q?: Q) => get<{ data: TemplateSummaryDto[] }>('/templates', q),
    template: (id: string) => get<TemplateDto>(`/templates/${id}`),
    createTemplate: (b: { name: string; category: string; description?: string; body: string }) =>
      post<TemplateDto>('/templates', b),
    updateTemplate: (id: string, b: Record<string, unknown>) =>
      patch<TemplateDto>(`/templates/${id}`, b),
    renderTemplate: (id: string, b: { matterId?: string; values?: Record<string, string> }) =>
      post<RenderedTemplateDto>(`/templates/${id}/render`, b),

    // timeline
    matterTimeline: (id: string, q?: Q) => get<TimelinePage>(`/matters/${id}/timeline`, q),
    clientTimeline: (id: string, q?: Q) => get<TimelinePage>(`/clients/${id}/timeline`, q),

    // documents
    documents: (matterId: string, q?: Q): L<DocumentListItem> =>
      get(`/matters/${matterId}/documents`, q),
    documentSearch: (q?: Q): L<DocumentListItem> => get('/documents', q),
    createDocument: (
      matterId: string,
      b: { title: string; filename: string; contentType: string; sizeBytes: number },
    ) =>
      post<{ document: DocumentDto; version: DocumentVersionDto; upload: UploadRequest }>(
        `/matters/${matterId}/documents`,
        b,
        idem(),
      ),
    addDocumentVersion: (
      id: string,
      b: { filename: string; contentType: string; sizeBytes: number },
    ) =>
      post<{ document: DocumentDto; version: DocumentVersionDto; upload: UploadRequest }>(
        `/documents/${id}/versions`,
        b,
      ),
    completeDocumentVersion: (id: string, version: number) =>
      post<DocumentVersionDto>(`/documents/${id}/versions/${version}/complete`),
    renameDocument: (id: string, title: string) =>
      patch<DocumentDto>(`/documents/${id}`, { title }),
    deleteDocument: (id: string) => del(`/documents/${id}`),
    versionText: (id: string, version: number, full = false) =>
      get<VersionTextDto>(`/documents/${id}/versions/${version}/text`, { full }),
    extractVersionText: (id: string, version: number) =>
      post<{ status: 'pending' }>(`/documents/${id}/versions/${version}/extract`),
    searchDocumentText: (q: string, o?: Q) =>
      get<{ data: TextSearchHit[] }>('/search/documents', { q, ...o }),
    similarDocuments: (id: string) => get<{ data: SimilarDocument[] }>(`/documents/${id}/similar`),
    document: (id: string) =>
      get<DocumentDto & { versions: DocumentVersionDto[] }>(`/documents/${id}`),
    downloadLink: (id: string, version: number) =>
      post<DownloadLink>(`/documents/${id}/versions/${version}/download-link`),
    shareVersion: (id: string, version: number, shared: boolean) =>
      put(`/documents/${id}/versions/${version}/share`, { shared }),

    // tasks & calendar
    tasks: (q?: Q): L<TaskDto> => get('/tasks', q),
    createTask: (b: Record<string, unknown>) => post<TaskDto>('/tasks', b),
    updateTask: (id: string, b: Record<string, unknown>) => patch<TaskDto>(`/tasks/${id}`, b),
    deleteTask: (id: string) => del(`/tasks/${id}`),
    events: (q: Q & { from: string; to: string }): L<EventDto> => get('/calendar/events', q),
    createEvent: (b: Record<string, unknown>) => post<EventDto>('/calendar/events', b),
    updateEvent: (id: string, b: Record<string, unknown>) =>
      patch<EventDto>(`/calendar/events/${id}`, b),
    deleteEvent: (id: string) => del(`/calendar/events/${id}`),

    // AI
    aiJobs: (q?: Q): L<AiJobDto> => get('/ai/jobs', q),
    createAiJob: (b: Record<string, unknown>) => post<AiJobDto>('/ai/jobs', b, idem()),
    createClientSummary: (b: { clientId: string; instructions?: string }) =>
      post<AiJobDto>('/ai/client-summaries', b),
    aiJob: (id: string) => get<AiJobDto>(`/ai/jobs/${id}`),
    cancelAiJob: (id: string) => post<AiJobDto>(`/ai/jobs/${id}/cancel`),
    retryAiJob: (id: string) => post<AiJobDto>(`/ai/jobs/${id}/retry`),
    aiOutputs: (q?: Q): L<AiOutputDto> => get('/ai/outputs', q),
    aiOutput: (id: string) => get<AiOutputDto>(`/ai/outputs/${id}`),
    editAiOutput: (id: string, text: string) =>
      put<AiOutputDto>(`/ai/outputs/${id}/edit`, { text }),
    approveAiOutput: (id: string, b: { note?: string; acknowledgeUnverified: boolean }) =>
      post<AiOutputDto>(`/ai/outputs/${id}/approve`, b),
    rejectAiOutput: (id: string, reason: string) =>
      post<AiOutputDto>(`/ai/outputs/${id}/reject`, { reason }),
    shareAiOutput: (id: string, shared: boolean) => put(`/ai/outputs/${id}/share`, { shared }),

    // assistant
    assistantThreads: () => get<{ data: AssistantThreadDto[] }>('/assistant/threads'),
    createAssistantThread: (b?: { title?: string }) =>
      post<AssistantThreadDto>('/assistant/threads', b ?? {}),
    assistantThread: (id: string) => get<AssistantThreadDetailDto>(`/assistant/threads/${id}`),
    sendAssistantMessage: (id: string, body: string) =>
      post<AssistantMessageDto>(`/assistant/threads/${id}/messages`, { body }),
    confirmAssistant: (id: string, messageId: string) =>
      post<AssistantMessageDto>(`/assistant/threads/${id}/confirm`, { messageId }),

    // billing
    billingSettings: () => get<BillingSettingsDto>('/billing/settings'),
    saveBillingSettings: (b: BillingSettingsDto) => put<BillingSettingsDto>('/billing/settings', b),
    setMemberRate: (userId: string, hourlyRateCents: number | null) =>
      put(`/billing/members/${userId}/rate`, { hourlyRateCents }),
    timeEntries: (q?: Q): L<TimeEntryDto> => get('/time-entries', q),
    createTimeEntry: (b: Record<string, unknown>) => post<TimeEntryDto>('/time-entries', b, idem()),
    updateTimeEntry: (id: string, b: Record<string, unknown>) =>
      patch<TimeEntryDto>(`/time-entries/${id}`, b),
    deleteTimeEntry: (id: string) => del(`/time-entries/${id}`),
    invoices: (q?: Q): L<InvoiceSummaryDto> => get('/invoices', q),
    invoice: (id: string) => get<InvoiceDto>(`/invoices/${id}`),
    invoiceReminderDraft: (id: string) =>
      get<InvoiceReminderDraftDto>(`/invoices/${id}/reminder-draft`),
    logInvoiceReminder: (id: string, b: { channel: ReminderChannel; note?: string }) =>
      post<InvoiceDto>(`/invoices/${id}/reminders`, b),
    createInvoice: (b: Record<string, unknown>) => post<InvoiceDto>('/invoices', b, idem()),
    updateInvoice: (id: string, b: Record<string, unknown>) =>
      patch<InvoiceDto>(`/invoices/${id}`, b),
    deleteInvoice: (id: string) => del(`/invoices/${id}`),
    addInvoiceLine: (id: string, b: Record<string, unknown>) =>
      post<InvoiceDto>(`/invoices/${id}/lines`, b),
    removeInvoiceLine: (id: string, lineId: string) =>
      del<InvoiceDto>(`/invoices/${id}/lines/${lineId}`),
    issueInvoice: (id: string) => post<InvoiceDto>(`/invoices/${id}/issue`),
    recordPayment: (id: string, b: Record<string, unknown>) =>
      post<InvoiceDto>(`/invoices/${id}/payments`, b, idem()),
    voidInvoice: (id: string, reason: string) =>
      post<InvoiceDto>(`/invoices/${id}/void`, { reason }),
    timeReport: (q: Q & { from: string; to: string }) => get<TimeReportDto>('/reports/time', q),
    timeReportCsvUrl: (q: Q & { from: string; to: string }) =>
      http.url(`/v1/reports/time/export${qs(q)}`),
    billingSummary: (q: Q & { from: string; to: string }) =>
      get<BillingSummaryDto>('/reports/billing/summary', q),
    billingAging: () => get<AgingDto>('/reports/billing/aging'),

    // notifications & automation
    notifications: (q?: Q) => get<NotificationPage>('/notifications', q),
    markNotificationRead: (id: string) => post<void>(`/notifications/${id}/read`),
    markAllNotificationsRead: () => post<void>('/notifications/read-all'),
    serviceScopes: () => get<{ scopes: string[] }>('/service-tokens/scopes'),
    serviceTokens: () => get<{ data: ServiceTokenDto[] }>('/service-tokens'),
    createServiceToken: (b: { name: string; scopes: string[]; expiresInDays?: number }) =>
      post<ServiceTokenDto>('/service-tokens', b),
    revokeServiceToken: (id: string) => del(`/service-tokens/${id}`),
  };
}
export type StaffClient = ReturnType<typeof createStaffClient>;
