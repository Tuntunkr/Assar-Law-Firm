export interface Feature {
  title: string;
  body: string;
}

export interface ProductPage {
  slug: string;
  title: string;
  summary: string;
  features: Feature[];
  guardrail?: string;
}

export const services: Feature[] = [
  {
    title: 'Matters and people',
    body: 'Clients, teams, roles, matters, a calendar and tasks in one workspace. An intern sees only the matters they are assigned.',
  },
  {
    title: 'AI drafts',
    body: 'Summaries and drafts stay off until the firm turns them on. What a model writes is a draft until a lawyer reviews it.',
  },
  {
    title: 'Documents',
    body: 'Versioned files in private storage, with the text the firm extracted from them. A date pulled from a file is still typed and checked.',
  },
  {
    title: 'Reminders',
    body: 'In-firm reminders for a date a lawyer approved, and for an intern’s own task. Nothing is sent to a court.',
  },
  {
    title: 'Client portal',
    body: 'A client sees their own shared documents, issued invoices and messages the firm has released.',
  },
  {
    title: 'Invoices',
    body: 'Time and expenses in the currency the firm chooses. The firm records a payment. No tax is added unless someone types a rate.',
  },
];

export const productPages: Record<string, ProductPage> = {
  'law-firm-management': {
    slug: 'law-firm-management',
    title: 'Law Firm Management',
    summary: 'One organized system for the daily work of running a practice.',
    features: [
      {
        title: 'Client CRM & conflict checks',
        body: 'Track clients and related parties, and screen new engagements against existing records.',
      },
      {
        title: 'Matters & parties',
        body: 'Organize matters with associated parties, status and team assignments. Client updates are previews until a person approves them and a provider is connected.',
      },
      {
        title: 'Hearings, deadlines & tasks',
        body: 'A shared calendar and task list linked to the matter they belong to.',
      },
      {
        title: 'Roles & matter-level access',
        body: 'Role-based permissions plus restricted matters visible only to named users.',
      },
      { title: 'Audit trail', body: 'Record who accessed or changed sensitive records.' },
      {
        title: 'Billing & reports',
        body: 'Time, invoices and reporting for partners and administrators.',
      },
    ],
  },
  'ai-legal-copilot': {
    slug: 'ai-legal-copilot',
    title: 'AI Legal Copilot',
    summary: 'AI assistance that stays inside your source material and under lawyer control.',
    features: [
      {
        title: 'Matter & document summaries',
        body: 'Condensed overviews generated from the documents you authorize.',
      },
      {
        title: 'Document Q&A with sources',
        body: 'Answers reference the document and version they came from so they can be checked.',
      },
      {
        title: 'Facts, dates & parties',
        body: 'Extract candidate dates, parties and key facts for review.',
      },
      { title: 'Chronology', body: 'Draft timelines assembled from your documents.' },
      { title: 'Drafting', body: 'First drafts of letters and documents for an attorney to edit.' },
      { title: 'Missing-information checklists', body: 'Identify what a file still needs.' },
    ],
    guardrail:
      'Every AI result is labeled as an unverified draft until a person reviews it. The Copilot is not a lawyer and does not provide legal advice. It must not be relied on for legal citations, case facts or deadlines without verification.',
  },
  'document-intelligence': {
    slug: 'document-intelligence',
    title: 'Document & Contract Intelligence',
    summary: 'Turn document piles into reviewable, searchable, traceable work product.',
    features: [
      {
        title: 'Versioned storage',
        body: 'Files are kept in private object storage with version history and access controls.',
      },
      {
        title: 'Clause review',
        body: 'Flag clauses for attorney attention, with the source passage shown.',
      },
      {
        title: 'Key-date extraction',
        body: 'Surface dates and obligations as suggestions to confirm.',
      },
      {
        title: 'Controlled sharing',
        body: 'Short-lived download links issued only after permission checks.',
      },
    ],
    guardrail:
      'Extraction results are suggestions. Confirm them against the original document before relying on them.',
  },
  'workflow-automation': {
    slug: 'workflow-automation',
    title: 'Workflow Automation',
    summary:
      'In-app reminders run on a schedule. External workflow hosts stay off until a real webhook address is configured.',
    features: [
      {
        title: 'Reminders',
        body: 'Approved dates and intern task due dates can notify staff inside the app. They are not sent to clients.',
      },
      { title: 'Client onboarding', body: 'Repeatable intake steps for new clients and matters.' },
      { title: 'Task assignment', body: 'Route work to teams based on matter type.' },
      { title: 'Daily reports', body: 'Scheduled summaries for partners and managers.' },
      {
        title: 'Document-processing triggers',
        body: 'Start processing when a document is uploaded.',
      },
    ],
    guardrail:
      'Automations call the platform through authenticated, permission-checked APIs. They cannot see more than the platform allows.',
  },
};

export const howItWorks: Feature[] = [
  {
    title: 'Set up your firm',
    body: 'Create your organization, invite your team and assign roles.',
  },
  {
    title: 'Bring in matters & documents',
    body: 'Add clients, matters and upload documents to private storage.',
  },
  {
    title: 'Ask the Copilot',
    body: 'Request a summary, chronology or draft from authorized sources.',
  },
  {
    title: 'Review and approve',
    body: 'A lawyer reviews each AI result before it is used or shared.',
  },
];

export const securityPrinciples: Feature[] = [
  { title: 'Organization isolation', body: 'Data is scoped to your organization in every query.' },
  { title: 'Least-privilege access', body: 'Role-based permissions and restricted matters.' },
  {
    title: 'Private file storage',
    body: 'Documents stay out of the database and are served via short-lived links.',
  },
  { title: 'Backend-only AI access', body: 'AI provider credentials never reach the browser.' },
  { title: 'Audit logging', body: 'Sensitive actions are recorded.' },
  { title: 'Human review', body: 'AI output is a draft until approved.' },
];
