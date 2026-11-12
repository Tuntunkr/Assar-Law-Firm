export interface CourtImage {
  src: string;
  alt: string;
  kicker: string;
  caption: string;
  /** Tailwind object-position class. */
  focus?: string;
}

export const imagery = {
  highCourt: {
    src: '/imagery/high-court.jpg',
    alt: 'Advocates in black coats walking up the steps of a columned high court',
    kicker: 'High Court',
    caption: 'The court steps, before the day’s list begins',
  },
  districtCourt: {
    src: '/imagery/district-court.jpg',
    alt: 'An advocate holding a brief inside a wood-panelled district courtroom',
    kicker: 'Lower court',
    caption: 'A district courtroom, brief in hand',
  },
  advocate: {
    src: '/imagery/advocate.jpg',
    alt: 'An advocate in a black coat and white bands standing in a courthouse corridor',
    kicker: 'Advocate',
    caption: 'Counsel, between matters',
    focus: 'object-[center_18%]',
  },
  chambers: {
    src: '/imagery/chambers.jpg',
    alt: 'An advocate’s chambers, with a gown on a chair and a brief on the desk',
    kicker: 'Chambers',
    caption: 'Where the brief is prepared',
  },
  corridor: {
    src: '/imagery/corridor.jpg',
    alt: 'Advocates walking through a long arched corridor of a high court',
    kicker: 'High Court',
    caption: 'The corridor between courts',
  },
  consultation: {
    src: '/imagery/consultation.jpg',
    alt: 'Two advocates reviewing papers together beside a courthouse window',
    kicker: 'Advocates',
    caption: 'A matter, reviewed before it is filed',
  },
} satisfies Record<string, CourtImage>;

export const courtGallery: CourtImage[] = [
  imagery.districtCourt,
  imagery.corridor,
  imagery.advocate,
];

/** Hero photograph for each marketing route. */
export const pageImagery: Record<string, CourtImage> = {
  services: imagery.districtCourt,
  solutions: imagery.corridor,
  pricing: imagery.highCourt,
  about: imagery.advocate,
  contact: imagery.consultation,
  faq: imagery.chambers,
  login: imagery.corridor,
  privacy: imagery.chambers,
  terms: imagery.highCourt,
  'law-firm-management': imagery.chambers,
  'ai-legal-copilot': imagery.advocate,
  'document-intelligence': imagery.consultation,
  'workflow-automation': imagery.corridor,
};
