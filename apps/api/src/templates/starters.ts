import type { TemplateCategory } from '@assar/types';

export interface StarterTemplate {
  key: string;
  name: string;
  category: TemplateCategory;
  description: string;
  body: string;
}

const NOTE =
  'DRAFT FOR ATTORNEY REVIEW — generic starting point, not legal advice. Adapt to the facts and the law that applies.\n\n';

/**
 * Generic, jurisdiction-neutral starting points that ship with every firm. They are ordinary templates
 * once created: firms edit, archive or replace them. Anything the system cannot fill is left as
 * `[MISSING: …]` for the drafter, never invented.
 */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'legal-notice',
    name: 'Legal notice',
    category: 'notice',
    description: 'A formal notice demanding action within a stated period.',
    body: `${NOTE}{{firm.name}}
{{today}}

To: {{notice.recipient}}
{{notice.recipient_address}}

Re: {{notice.subject}} — our client {{client.name}}
Matter reference: {{matter.number}}

Sir/Madam,

We act for {{client.name}} ("our client"), and write on their instructions.

1. Background
{{notice.background}}

2. Demand
Our client requires you to {{notice.demand}} within {{notice.period_days}} days of receiving this notice.

3. Consequences
If you do not comply, our client has instructed us to take such steps as may be available to them, including proceedings{{court.name}} at your risk as to costs and consequences.

This notice is without prejudice to all of our client's rights and remedies, all of which are expressly reserved.

Yours faithfully,

{{attorney.name}}
{{firm.name}}`,
  },
  {
    key: 'mutual-nda',
    name: 'Mutual non-disclosure agreement',
    category: 'agreement',
    description: 'Two parties agree to protect each other’s confidential information.',
    body: `${NOTE}MUTUAL NON-DISCLOSURE AGREEMENT

This agreement is made on {{today}} between:

(1) {{client.name}} ("Party A"), of {{client.address}}; and
(2) {{nda.counterparty}} ("Party B"), of {{nda.counterparty_address}}.

1. Purpose
The parties wish to exchange confidential information for the purpose of {{nda.purpose}} (the "Purpose").

2. Confidential information
"Confidential Information" means non-public information disclosed by one party to the other, in any form, that is marked confidential or would reasonably be understood to be confidential.

3. Obligations
Each party shall (a) use the other's Confidential Information only for the Purpose, (b) keep it secret using at least reasonable care, and (c) disclose it only to those who need it for the Purpose and are bound to equivalent duties.

4. Exceptions
These obligations do not apply to information that is public through no fault of the recipient, was already lawfully known to it, is independently developed, or must be disclosed by law (after prompt notice to the other party where lawful).

5. Term
This agreement lasts {{nda.term_years}} years from the date above. The duty of confidence continues for {{nda.survival_years}} years after it ends.

6. Return
On request, each party shall return or destroy the other's Confidential Information.

7. General
This agreement is governed by the laws of {{court.jurisdiction}}. Courts at {{court.name}} have jurisdiction. It is the entire agreement on this subject and may be changed only in writing signed by both parties.

Signed for Party A: ______________________   Date: __________
Signed for Party B: ______________________   Date: __________`,
  },
  {
    key: 'service-agreement',
    name: 'Services agreement',
    category: 'contract',
    description: 'A fixed-scope services contract with fees, term and termination.',
    body: `${NOTE}SERVICES AGREEMENT

This agreement is made on {{today}} between {{client.name}} ("the Client") and {{service.provider}} ("the Provider").

1. Services
The Provider shall perform the following services: {{service.scope}}.

2. Fees and payment
The Client shall pay {{service.fee}}. Invoices are payable within {{service.payment_days}} days of receipt. Late amounts bear interest at {{service.late_interest}}.

3. Term and termination
This agreement starts on {{service.start_date}} and continues until {{service.end_date}}, unless ended earlier. Either party may terminate on {{service.notice_days}} days' written notice, or immediately for the other's material breach that is not remedied within 14 days of written notice.

4. Intellectual property
Unless otherwise agreed in writing, each party keeps its existing intellectual property. {{service.ip_terms}}

5. Confidentiality
Each party shall keep the other's confidential information secret and use it only for this agreement.

6. Liability
Nothing limits liability that cannot lawfully be limited. Subject to that, each party's total liability under this agreement is limited to {{service.liability_cap}}.

7. Governing law and disputes
This agreement is governed by the laws of {{court.jurisdiction}}. Disputes are subject to the courts at {{court.name}}.

Signed for the Client: ______________________   Date: __________
Signed for the Provider: ______________________   Date: __________`,
  },
  {
    key: 'engagement-letter',
    name: 'Engagement letter',
    category: 'engagement',
    description: 'Confirms the scope, fees and terms on which the firm acts for a client.',
    body: `${NOTE}{{firm.name}}
{{today}}

{{client.name}}
{{client.address}}

Re: Engagement — {{matter.title}} (ref. {{matter.number}})

Dear {{client.name}},

Thank you for instructing us. This letter sets out the terms on which we will act.

1. Scope
We will act for you in connection with {{matter.title}}. {{engagement.scope_details}} Anything outside this scope needs a separate written agreement.

2. Who will work on your matter
{{attorney.name}} is responsible for your matter and will be assisted by other members of the team as needed.

3. Fees
Our fees are {{engagement.fee_basis}}. We will invoice {{engagement.billing_frequency}}, and invoices are payable within {{engagement.payment_days}} days.
{{engagement.retainer_note}}

4. Your responsibilities
Please give us complete and accurate information, respond promptly to requests, and tell us at once of any change in your circumstances.

5. Confidentiality and your documents
We keep your information confidential and will use it only to act for you. We may retain your file as required by law and our professional rules.

6. Conflicts of interest
We have checked for conflicts of interest and found none that prevent us acting. We will tell you immediately if that changes.

7. Ending the engagement
You may end our engagement at any time by writing to us. We may do so for good reason, giving you reasonable notice. You remain liable for fees and expenses up to that date.

Please sign and return a copy of this letter to confirm that you accept these terms.

Yours sincerely,

{{attorney.name}}
{{firm.name}}

Accepted for {{client.name}}: ______________________   Date: __________`,
  },
  {
    key: 'petition-skeleton',
    name: 'Petition (skeleton)',
    category: 'petition',
    description:
      'A court filing outline: parties, facts, grounds and prayer. Needs the local format and rules added.',
    body: `${NOTE}IN THE {{court.name}}
{{court.jurisdiction}}
Case No. {{court.case_number}}

{{client.name}}  ......  Petitioner
versus
{{party.opposing.name}}  ......  Respondent

PETITION UNDER {{petition.provision}}

The Petitioner respectfully states:

1. PARTIES
The Petitioner is {{client.name}}, of {{client.address}}. The Respondent is {{party.opposing.name}}.

2. FACTS
{{petition.facts}}

3. GROUNDS
{{petition.grounds}}

4. JURISDICTION
This Court has jurisdiction because {{petition.jurisdiction_basis}}.

5. PRAYER
The Petitioner therefore prays that this Court may be pleased to:
(a) {{petition.relief}};
(b) award costs; and
(c) grant such further relief as the Court deems fit.

Filed on {{court.filed_on}}

{{attorney.name}}
Counsel for the Petitioner
{{firm.name}}`,
  },
];
