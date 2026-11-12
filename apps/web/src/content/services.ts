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
    title: 'Law firm management',
    body: 'Organizations, teams, roles, clients, matters, calendar and tasks in one workspace.',
  },
  {
    title: 'Ask Assar',
    body: 'One assistant for the dashboard and for document drafts. Drafts stay drafts until a lawyer reviews them.',
  },
  {
    title: 'Document & contract intelligence',
    body: 'Versioned documents with clause review, key-date extraction and source references.',
  },
  {
    title: 'Workflow automation',
    body: 'Reminders, onboarding and reporting automations that respect your permissions.',
  },
  {
    title: 'Client portal',
    body: 'Clients see only their own matters and documents your team has approved.',
  },
  {
    title: 'Billing & reporting',
    body: 'Time entries, invoices and practice reports tied to matters.',
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
        body: 'Organize matters with associated parties, status, team assignments and communication history.',
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
    title: 'Ask Assar',
    summary: 'One assistant for dashboard help and document drafts, kept under lawyer control.',
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
      'Every AI result is labeled as an unverified draft until a person reviews it. Ask Assar is not a lawyer and does not provide legal advice. It must not be relied on for legal citations, case facts or deadlines without verification.',
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
    summary: 'Automate routine coordination without bypassing permissions.',
    features: [
      { title: 'Reminders', body: 'Deadline and task reminders delivered to the right people.' },
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

export const practiceAreas: Feature[] = [
  {
    title: 'Litigation',
    body: 'Hearing dates, filings, chronologies and document-heavy case files.',
  },
  {
    title: 'Corporate & commercial',
    body: 'Contract review, diligence document sets and deal checklists.',
  },
  { title: 'Family law', body: 'Sensitive client communication and restricted-matter access.' },
  { title: 'Real estate', body: 'Transaction checklists, parties and key dates.' },
  { title: 'Employment', body: 'Policies, agreements and case timelines.' },
  { title: 'Intellectual property', body: 'Deadlines, agreements and portfolio matters.' },
];

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
    title: 'Ask Assar',
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
