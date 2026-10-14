/** Only add genuine, written-approval testimonials. Empty array hides the section. */
export interface Testimonial {
  id: string;
  quote: string;
  author: string;
  role: string;
}
export const testimonials: Testimonial[] = [];
