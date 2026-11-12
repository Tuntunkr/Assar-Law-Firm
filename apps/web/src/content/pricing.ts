/** Public list prices, in USD per firm per month. Edit the numbers here to change the site. */
export interface Plan {
  id: string;
  name: string;
  audience: string;
  priceMonthly: number | null;
  currency: string;
  highlighted?: boolean;
  features: string[];
}

export function formatPlanPrice(plan: Plan): string {
  if (plan.priceMonthly === null) return 'Pricing on request';
  if (plan.currency === 'USD') return `$${plan.priceMonthly}/mo`;
  return `${plan.currency} ${plan.priceMonthly}/mo`;
}

export const plans: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    audience: 'Small practices',
    priceMonthly: 79,
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
    priceMonthly: 199,
    currency: 'USD',
    highlighted: true,
    features: [
      'Everything in Starter',
      'Ask Assar (reviewed drafts)',
      'Document intelligence',
      'Client portal',
      'Billing and reports',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    audience: 'Larger firms',
    priceMonthly: 499,
    currency: 'USD',
    features: [
      'Everything in Professional',
      'Workflow automation',
      'Custom roles and retention',
      'Onboarding support',
    ],
  },
];
