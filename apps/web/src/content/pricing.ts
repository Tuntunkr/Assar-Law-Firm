/**
 * Editable pricing configuration. Prices are intentionally null until approved by the business;
 * the UI renders "Pricing on request" for null. Do not publish invented numbers.
 */
export interface Plan {
  id: string;
  name: string;
  audience: string;
  priceMonthly: number | null;
  currency: string;
  highlighted?: boolean;
  features: string[];
}

export const plans: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    audience: 'Small practices',
    priceMonthly: null,
    currency: 'USD',
    features: [
      'Clients and matters',
      'Calendar and tasks',
      'Document storage',
      'Role-based access',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    audience: 'Growing firms',
    priceMonthly: null,
    currency: 'USD',
    highlighted: true,
    features: [
      'Everything in Starter',
      'AI Legal Copilot (reviewed drafts)',
      'Document intelligence',
      'Client portal',
      'Billing and reports',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    audience: 'Larger firms',
    priceMonthly: null,
    currency: 'USD',
    features: [
      'Everything in Professional',
      'Workflow automation',
      'Custom roles and retention',
      'Onboarding support',
    ],
  },
];
