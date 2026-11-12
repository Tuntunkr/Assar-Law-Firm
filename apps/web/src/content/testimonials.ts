/**
 * Visible proof points on the marketing site. These describe how the product works.
 * Replace them with named customer quotes only after you have written approval.
 */
export interface Testimonial {
  id: string;
  quote: string;
  author: string;
  role: string;
}

export const testimonials: Testimonial[] = [
  {
    id: 'review',
    quote:
      'Summaries, chronologies and drafts stay in a review queue. A lawyer approves the result before it is relied on or sent to a client.',
    author: 'Lawyer review',
    role: 'AI output is a draft until someone at the firm approves it',
  },
  {
    id: 'matters',
    quote:
      'Clients, matters, hearings, tasks and documents live in one workspace. A restricted matter is visible only to the people named on it.',
    author: 'Practice teams',
    role: 'Daily case work, with an audit trail on sensitive changes',
  },
  {
    id: 'portal',
    quote:
      'Clients sign in to their own portal and see only the matters and documents the firm has chosen to share.',
    author: 'Client portal',
    role: 'Nothing is shared with a client by default',
  },
];
