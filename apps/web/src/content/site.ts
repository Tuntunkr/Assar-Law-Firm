export const site = {
  name: 'Assar Law Firm',
  tagline: 'AI-assisted practice management for modern law firms',
  description:
    'Assar Law Firm brings matter management, document intelligence and workflow automation together, with lawyer review built into every AI-assisted step.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  dashboardUrl: process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3001',
  clientPortalUrl: process.env.NEXT_PUBLIC_CLIENT_PORTAL_URL ?? 'http://localhost:3002',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@assarlaw.com',
};

export const nav = [
  { href: '/services', label: 'Services' },
  { href: '/ai-legal-copilot', label: 'Ask Assar' },
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
      { href: '/ai-legal-copilot', label: 'Ask Assar' },
      { href: '/document-intelligence', label: 'Document Intelligence' },
      { href: '/workflow-automation', label: 'Workflow Automation' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Book a demo' },
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
