export const site = {
  name: 'Assar Law Firm',
  tagline: 'Practice software',
  description:
    'Assar Law Firm software for clients, documents, dates and invoices. Court entries are typed by a person. A client message waits for a lawyer. WhatsApp stays off until the firm connects it.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  dashboardUrl: process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3001',
  clientPortalUrl: process.env.NEXT_PUBLIC_CLIENT_PORTAL_URL ?? 'http://localhost:3002',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '',
};

export const nav = [
  { href: '/services', label: 'Services' },
  { href: '/ai-legal-copilot', label: 'AI Copilot' },
  { href: '/solutions', label: 'Solutions' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/faq', label: 'FAQ' },
];

export const footerLinks = [
  {
    title: 'Product',
    links: [
      { href: '/law-firm-management', label: 'Law Firm Management' },
      { href: '/ai-legal-copilot', label: 'AI Legal Copilot' },
      { href: '/document-intelligence', label: 'Document Intelligence' },
      { href: '/workflow-automation', label: 'Workflow Automation' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Demo' },
      { href: '/faq', label: 'FAQ' },
      { href: '/login', label: 'Login' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
];
