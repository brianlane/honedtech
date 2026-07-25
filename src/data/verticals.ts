// Vertical landing pages. Slugs MUST match verticalPath() in
// src/lib/prospect/compose.ts so outreach email links resolve. A consistency
// test in tests/verticals.test.ts enforces this.

export interface VerticalWaste {
  strong: string;
  rest: string;
}

export interface VerticalFaq {
  q: string;
  a: string;
}

export interface Vertical {
  slug: string;
  name: string;
  metaTitle: string;
  metaDescription: string;
  headline: string;
  subhead: string;
  waste: VerticalWaste[];
  faq: VerticalFaq[];
  // Google Places text-search phrases used by the outreach discovery script.
  // Kept beside the page content so a new vertical brings its own prospecting
  // queries instead of a separate list drifting out of sync.
  searchTerms: string[];
}

export const verticals: Vertical[] = [
  {
    slug: 'hvac-plumbing',
    name: 'HVAC & Plumbing',
    metaTitle: 'Tech Stack Audits for HVAC & Plumbing Companies | Honed Tech',
    metaDescription:
      'HVAC and plumbing companies overpay for scheduling, dispatch, and website tools they barely use. Honed Tech finds the waste and cuts it. Flat-rate audits from $299.',
    headline: 'HVAC and plumbing shops are overpaying for software they barely use.',
    subhead:
      'Between the field-service platform, the booking widget, the review tool, and the site nobody updates, the monthly bill creeps up fast. We find what you can cut without losing a single booking.',
    waste: [
      { strong: 'Field-service platforms on their top tier', rest: 'when you use a third of the features.' },
      { strong: 'Separate booking, review, and SMS tools', rest: 'that overlap with what your CRM already does.' },
      { strong: 'A slow page-builder website', rest: 'that costs a monthly subscription and still loads slowly on a phone in a driveway.' },
    ],
    faq: [
      { q: 'Will an audit interrupt our dispatching?', a: 'No. The audit is a review of what you pay for. Nothing changes on your systems until you approve a specific fix.' },
      { q: 'We are not very technical. Is that a problem?', a: 'That is exactly who we build for. You get a plain-English report with the dollar savings and what to do, no jargon.' },
      { q: 'Do you work with companies outside Arizona?', a: 'Yes. The audit and build work is remote-friendly and we serve clients nationwide.' },
    ],
    searchTerms: ['hvac contractor', 'plumber', 'air conditioning repair'],
  },
  {
    slug: 'roofing-landscaping',
    name: 'Roofing & Landscaping',
    metaTitle: 'Tech Stack Audits for Roofing & Landscaping | Honed Tech',
    metaDescription:
      'Roofing and landscaping crews pay for quoting, CRM, and website tools that overlap. Honed Tech audits your stack and cuts the waste. Flat-rate audits from $299.',
    headline: 'Your estimating and CRM tools probably overlap more than you think.',
    subhead:
      'Seasonal businesses stack up subscriptions fast and rarely revisit them. We map every tool you pay for and show you what is redundant.',
    waste: [
      { strong: 'Overlapping quoting and CRM subscriptions', rest: 'that each charge per seat for the same job.' },
      { strong: 'A website on a premium builder plan', rest: 'for what is really a five-page portfolio and a contact form.' },
      { strong: 'Paid email for the whole crew', rest: 'when free routing on your domain covers most of them.' },
    ],
    faq: [
      { q: 'We slow down in winter. Does the audit still pay off?', a: 'Often more so. Cutting off-season subscriptions is where a lot of the savings hide.' },
      { q: 'What do we get exactly?', a: 'A written report listing every tool, its cost, what it duplicates, and the exact monthly savings with a prioritized fix plan.' },
      { q: 'How long does it take?', a: 'Most audits are delivered in days, not weeks.' },
    ],
    searchTerms: ['roofing contractor', 'landscaping company', 'tree service'],
  },
  {
    slug: 'pest-control',
    name: 'Pest Control',
    metaTitle: 'Tech Stack Audits for Pest Control Companies | Honed Tech',
    metaDescription:
      'Pest control companies overpay for routing, billing, and website software. Honed Tech finds the overlap and cuts it. Flat-rate audits from $299.',
    headline: 'Routing, billing, and booking tools that quietly overcharge you.',
    subhead:
      'Recurring-service businesses run on software, and that software loves to upsell tiers you do not need. We find the ceiling you can drop back down from.',
    waste: [
      { strong: 'Route and billing platforms on premium tiers', rest: 'with add-ons nobody on the team uses.' },
      { strong: 'A separate online-booking tool', rest: 'that duplicates your service software.' },
      { strong: 'Managed hosting for a simple site', rest: 'that a lean static build serves faster and cheaper.' },
    ],
    faq: [
      { q: 'Our software runs the whole business. Is switching risky?', a: 'We rarely start by switching core software. Most savings come from tier changes, cut add-ons, and consolidating side tools.' },
      { q: 'Is there any obligation after the audit?', a: 'None. The audit stands on its own. You decide what, if anything, to fix.' },
      { q: 'Do you serve multi-branch operations?', a: 'Yes, and multi-location licensing is one of the most common places we find waste.' },
    ],
    searchTerms: ['pest control service', 'termite inspection', 'exterminator'],
  },
  {
    slug: 'law-firms-cpas',
    name: 'Law Firms & CPAs',
    metaTitle: 'Tech Stack Audits for Law Firms & CPAs | Honed Tech',
    metaDescription:
      'Law firms and accounting practices overpay for practice management, storage, and email licenses. Honed Tech audits the stack and cuts waste. Flat-rate audits from $299.',
    headline: 'Per-seat licenses add up fast in a professional practice.',
    subhead:
      'Practice management, document storage, e-signature, email, and the website all bill monthly, usually per user. We find the seats and tiers you are paying for but not using.',
    waste: [
      { strong: 'Unused per-seat licenses', rest: 'for staff who left or never logged in.' },
      { strong: 'Premium Microsoft 365 or Google Workspace tiers', rest: 'when a lower tier covers your actual use.' },
      { strong: 'Overlapping storage and e-signature tools', rest: 'that each carry their own subscription.' },
    ],
    faq: [
      { q: 'We handle sensitive client data. Do you touch it?', a: 'No. The audit reviews billing, licensing, and public-facing setup. We do not need access to client files.' },
      { q: 'Can you help us stay compliant while cutting costs?', a: 'Yes. We flag which tools are load-bearing for compliance and focus savings on the ones that are not.' },
      { q: 'Is the report something we can hand to a partner?', a: 'Yes. It is a clean written report with the numbers and recommendations, made to share.' },
    ],
    searchTerms: ['law firm', 'accounting firm', 'cpa office'],
  },
  {
    slug: 'financial-advisors',
    name: 'Financial Advisors',
    metaTitle: 'Tech Stack Audits for Financial Advisors | Honed Tech',
    metaDescription:
      'Financial advisory practices overpay for CRM, planning, and marketing software. Honed Tech audits your stack and cuts waste. Flat-rate audits from $299.',
    headline: 'CRM, planning, and marketing tools that stack up quietly.',
    subhead:
      'Advisory practices accumulate software through every vendor pitch and compliance requirement. We separate what earns its keep from what just bills.',
    waste: [
      { strong: 'CRM and planning suites on top tiers', rest: 'with modules you never turned on.' },
      { strong: 'Duplicate email and scheduling tools', rest: 'that came bundled and now bill separately.' },
      { strong: 'A costly website subscription', rest: 'for a compliance-approved brochure site.' },
    ],
    faq: [
      { q: 'Do you understand compliance constraints?', a: 'We flag anything that looks compliance-driven and leave those decisions to you. Savings come from the rest.' },
      { q: 'How much do practices usually save?', a: 'A typical audit surfaces $200 to $500 a month, often more for multi-advisor offices.' },
      { q: 'What does the audit cost?', a: 'A flat $299 for the Snapshot audit. It usually pays for itself in the first month of savings.' },
    ],
    searchTerms: ['financial advisor', 'wealth management firm', 'insurance agency'],
  },
  {
    slug: 'real-estate-property-management',
    name: 'Real Estate & Property Management',
    metaTitle: 'Tech Stack Audits for Real Estate & Property Management | Honed Tech',
    metaDescription:
      'Real estate and property management offices overpay for listing, CRM, and website tools. Honed Tech audits the stack and cuts waste. Flat-rate audits from $299.',
    headline: 'Listing, CRM, and website tools that overlap and overcharge.',
    subhead:
      'Between the CRM, the IDX site, the lead tools, and the door-to-door software, agents and managers pay for a lot of redundancy. We map it and trim it.',
    waste: [
      { strong: 'Multiple lead-gen subscriptions', rest: 'that feed the same pipeline.' },
      { strong: 'A premium website and IDX plan', rest: 'far above what your traffic needs.' },
      { strong: 'Per-agent tool licenses', rest: 'still billing for agents who have moved on.' },
    ],
    faq: [
      { q: 'Our brokerage mandates some tools. Can you work around that?', a: 'Yes. We note the required tools and find savings everywhere else.' },
      { q: 'Do you help property managers too?', a: 'Yes. Property management software tiers and add-ons are a common source of waste.' },
      { q: 'Is there a long-term contract?', a: 'No. The audit is a one-time flat fee with no obligation beyond it.' },
    ],
    searchTerms: ['real estate agency', 'property management company'],
  },
  {
    slug: 'chiropractors-dentists',
    name: 'Chiropractors & Dentists',
    metaTitle: 'Tech Stack Audits for Chiropractors & Dentists | Honed Tech',
    metaDescription:
      'Dental and chiropractic practices overpay for scheduling, reminders, and website software. Honed Tech audits your stack and cuts waste. Flat-rate audits from $299.',
    headline: 'Scheduling, reminders, and marketing tools that double up.',
    subhead:
      'Practice management often includes features you also pay a separate vendor for. We find the overlap between your PMS, your reminder tool, and your marketing stack.',
    waste: [
      { strong: 'Standalone reminder and review tools', rest: 'that your practice software already includes.' },
      { strong: 'Premium website and SEO retainers', rest: 'that outpace the results they deliver.' },
      { strong: 'Paid email and forms tools', rest: 'that a leaner setup replaces for free.' },
    ],
    faq: [
      { q: 'We use a PMS we cannot change. Does the audit help?', a: 'Yes. We keep your PMS and cut the side tools and tiers that duplicate it.' },
      { q: 'Do you handle patient data?', a: 'No. We review billing and public-facing setup only, never patient records.' },
      { q: 'How fast is the turnaround?', a: 'Most audits land in days, with a short debrief call to walk you through it.' },
    ],
    searchTerms: ['chiropractor', 'dentist office', 'orthodontist'],
  },
  {
    slug: 'med-spas-gyms',
    name: 'Med Spas & Gyms',
    metaTitle: 'Tech Stack Audits for Med Spas & Gyms | Honed Tech',
    metaDescription:
      'Med spas and gyms overpay for booking, membership, and marketing software. Honed Tech audits your stack and cuts waste. Flat-rate audits from $299.',
    headline: 'Booking, membership, and marketing tools that quietly stack up.',
    subhead:
      'Membership businesses run on software that loves add-ons and per-location fees. We find the tiers and tools you can drop without touching the member experience.',
    waste: [
      { strong: 'Booking and membership platforms on top tiers', rest: 'with add-ons nobody uses.' },
      { strong: 'Separate email and SMS marketing tools', rest: 'that overlap with your booking software.' },
      { strong: 'A heavy website subscription', rest: 'for a site a lean build serves faster.' },
    ],
    faq: [
      { q: 'We have multiple locations. Does that change things?', a: 'It usually increases the savings. Per-location licensing is a common overspend.' },
      { q: 'Will members notice any change?', a: 'No. Savings come from your back-office stack, not the member-facing experience.' },
      { q: 'What is the first step?', a: 'A flat $299 Snapshot audit. You see the savings before committing to anything else.' },
    ],
    searchTerms: ['med spa', 'gym', 'yoga studio'],
  },
  {
    slug: 'restaurants-hospitality',
    name: 'Restaurants & Hospitality',
    metaTitle: 'Tech Stack Audits for Restaurants & Hospitality | Honed Tech',
    metaDescription:
      'Restaurants and hospitality businesses overpay for POS, reservations, and online-ordering software. Honed Tech audits the stack and cuts waste. Flat-rate audits from $299.',
    headline: 'POS, reservations, and ordering tools that each take a cut.',
    subhead:
      'Between the POS tiers, the reservation platform, the online-ordering fees, and the website, the monthly total adds up. We find what overlaps and what overcharges.',
    waste: [
      { strong: 'POS platforms on premium tiers', rest: 'with modules you do not run.' },
      { strong: 'Multiple online-ordering and reservation tools', rest: 'that each charge a fee or subscription.' },
      { strong: 'A page-builder website', rest: 'when a fast static site with your menu costs far less.' },
    ],
    faq: [
      { q: 'Online ordering is core to us. Would you remove it?', a: 'No. We keep what drives revenue and cut the overlapping or over-tiered tools around it.' },
      { q: 'Do delivery-app fees count?', a: 'We review them and flag cheaper or direct alternatives, but the call stays yours.' },
      { q: 'How much can a single location save?', a: 'A typical audit finds $200 to $500 a month, sometimes more once ordering and POS tiers are reviewed.' },
    ],
    searchTerms: ['restaurant', 'catering company', 'event venue'],
  },
];
