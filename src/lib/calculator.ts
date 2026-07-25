// Savings-calculator model. Pure and coverage-gated so the numbers are
// tested; the /calculator page and its client script both consume this.
//
// Figures are published list prices checked in July 2026, using the
// MONTHLY billing rate (what a small business who never opted into annual
// actually pays). Where a range exists we take the low end, because an
// estimate that undershoots survives contact with a real invoice and an
// estimate that overshoots destroys the pitch.

export interface CalcOption {
  id: string;
  label: string;
  // What they pay today, per month.
  monthlyCostUsd: number;
  // What the same need costs after we fix it, per month. The waste is the
  // difference, not the whole bill, because some of these are real needs.
  monthlyAfterUsd: number;
  // Shown on the option so the number never looks invented.
  note?: string;
}

export interface CalcSection {
  id: string;
  title: string;
  help: string;
  // 'single' renders as radios (pick one), 'multi' as checkboxes.
  mode: 'single' | 'multi';
  options: CalcOption[];
}

// The flat audit fee, used for the payback figure.
export const AUDIT_PRICE_USD = 299;

export const CALCULATOR_SECTIONS: CalcSection[] = [
  {
    id: 'website',
    title: 'Your website',
    help: 'Pick what your site runs on today.',
    mode: 'single',
    options: [
      {
        id: 'shopify_no_store',
        label: 'Shopify, but we do not sell online',
        monthlyCostUsd: 39,
        monthlyAfterUsd: 0,
        note: 'Shopify Basic is $39/mo billed monthly. With no storefront, all of it is waste.',
      },
      {
        id: 'wix',
        label: 'Wix',
        monthlyCostUsd: 29,
        monthlyAfterUsd: 2,
        note: 'Wix Core runs $29/mo. A static rebuild costs about $2/mo to host.',
      },
      {
        id: 'squarespace',
        label: 'Squarespace',
        monthlyCostUsd: 23,
        monthlyAfterUsd: 2,
        note: 'Squarespace Core is $23/mo billed annually, more monthly.',
      },
      {
        id: 'godaddy',
        label: 'GoDaddy Website Builder',
        monthlyCostUsd: 21,
        monthlyAfterUsd: 2,
        note: 'Commerce is $20.99/mo, and GoDaddy renewals commonly jump at year two.',
      },
      {
        id: 'managed_wp',
        label: 'WordPress on premium managed hosting',
        monthlyCostUsd: 25,
        monthlyAfterUsd: 2,
        note: 'Typical managed WordPress plan for a small brochure site.',
      },
      {
        id: 'website_fine',
        label: 'Custom or already lean',
        monthlyCostUsd: 0,
        monthlyAfterUsd: 0,
      },
    ],
  },
  {
    id: 'email',
    title: 'Business email',
    help: 'Only counts if you mainly send and receive mail on your own domain.',
    mode: 'single',
    options: [
      { id: 'email_none', label: 'Free routing, or not sure', monthlyCostUsd: 0, monthlyAfterUsd: 0 },
      {
        id: 'email_1_3',
        label: 'Paid Google or Microsoft, 1 to 3 mailboxes',
        monthlyCostUsd: 15,
        monthlyAfterUsd: 0,
        note: 'About 2 mailboxes at roughly $7.50 each. Free routing covers send and receive.',
      },
      {
        id: 'email_4_10',
        label: 'Paid Google or Microsoft, 4 to 10 mailboxes',
        monthlyCostUsd: 45,
        monthlyAfterUsd: 15,
        note: 'About 6 mailboxes. Usually some genuinely need a full seat, so not all of it is waste.',
      },
      {
        id: 'email_11_plus',
        label: 'Paid Google or Microsoft, 11 or more',
        monthlyCostUsd: 90,
        monthlyAfterUsd: 45,
        note: 'About 12 mailboxes. At this size the savings come from right-sizing tiers.',
      },
    ],
  },
  {
    id: 'extras',
    title: 'Other tools you pay for',
    help: 'Check every one that applies.',
    mode: 'multi',
    options: [
      {
        id: 'managed_hosting',
        label: 'Premium hosting for a simple site',
        monthlyCostUsd: 25,
        monthlyAfterUsd: 2,
        note: 'A brochure site does not need a premium plan.',
      },
      {
        id: 'overlapping_marketing',
        label: 'Overlapping marketing tools (for example Mailchimp plus a CRM that already emails)',
        monthlyCostUsd: 30,
        monthlyAfterUsd: 0,
        note: 'One of the two is usually redundant.',
      },
      {
        id: 'phone_pos',
        label: 'Phone, scheduling, or POS on a high tier',
        monthlyCostUsd: 30,
        monthlyAfterUsd: 12,
        note: 'Tier downgrades and dropped add-ons, keeping the parts you use.',
      },
      {
        id: 'unused_saas',
        label: 'Software seats or licenses nobody uses',
        monthlyCostUsd: 25,
        monthlyAfterUsd: 0,
        note: 'Staff who left, trials that converted, tools bought for one project.',
      },
      {
        id: 'registrar_upsells',
        label: 'Registrar add-ons (SSL, privacy, site backup, email upsells)',
        monthlyCostUsd: 15,
        monthlyAfterUsd: 0,
        note: 'SSL and privacy are free at a modern registrar.',
      },
      {
        id: 'duplicate_storage',
        label: 'A separate file storage subscription',
        monthlyCostUsd: 15,
        monthlyAfterUsd: 0,
        note: 'Your email suite almost certainly includes the same storage.',
      },
    ],
  },
];

const OPTIONS_BY_ID = new Map<string, CalcOption>(
  CALCULATOR_SECTIONS.flatMap((s) => s.options.map((o) => [o.id, o])),
);

export function isKnownOption(id: string): boolean {
  return OPTIONS_BY_ID.has(id);
}

export interface BreakdownLine {
  id: string;
  label: string;
  monthlyCostUsd: number;
  monthlyAfterUsd: number;
  monthlyWasteUsd: number;
  note?: string;
}

// Itemized current-state cost, which the research is clear about: buyers
// trust a line-by-line total far more than a single headline number. Only
// selections with recoverable spend appear.
export function buildBreakdown(selectedIds: string[]): BreakdownLine[] {
  const lines: BreakdownLine[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    const option = OPTIONS_BY_ID.get(id);
    if (!option || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const waste = option.monthlyCostUsd - option.monthlyAfterUsd;
    if (waste > 0) {
      lines.push({
        id: option.id,
        label: option.label,
        monthlyCostUsd: option.monthlyCostUsd,
        monthlyAfterUsd: option.monthlyAfterUsd,
        monthlyWasteUsd: waste,
        note: option.note,
      });
    }
  }
  return lines.sort((a, b) => b.monthlyWasteUsd - a.monthlyWasteUsd);
}

// What they pay today across every selection, waste or not.
export function currentMonthlySpend(selectedIds: string[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const id of selectedIds) {
    const option = OPTIONS_BY_ID.get(id);
    if (option && !seen.has(id)) {
      seen.add(id);
      total += option.monthlyCostUsd;
    }
  }
  return total;
}

export function estimateMonthlyWaste(selectedIds: string[]): number {
  return buildBreakdown(selectedIds).reduce((sum, l) => sum + l.monthlyWasteUsd, 0);
}

export function estimateAnnualWaste(selectedIds: string[]): number {
  return estimateMonthlyWaste(selectedIds) * 12;
}

// The cost of doing nothing, which is the number that actually motivates.
export function estimateThreeYearWaste(selectedIds: string[]): number {
  return estimateMonthlyWaste(selectedIds) * 36;
}

// How long the flat audit fee takes to pay for itself, in whole months.
// Returns 0 when nothing recoverable was selected.
export function auditPaybackMonths(selectedIds: string[]): number {
  const monthly = estimateMonthlyWaste(selectedIds);
  if (monthly <= 0) {
    return 0;
  }
  return Math.ceil(AUDIT_PRICE_USD / monthly);
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// A plain-English summary of the result, which converts better than a bare
// figure because it reflects what the visitor actually told us.
export function buildNarrative(selectedIds: string[]): string {
  const lines = buildBreakdown(selectedIds);
  if (lines.length === 0) {
    return 'Nothing you selected looks obviously wasteful. That is a good sign, and an audit would confirm it across the tools this calculator does not ask about.';
  }
  const monthly = estimateMonthlyWaste(selectedIds);
  const biggest = lines[0];
  const payback = auditPaybackMonths(selectedIds);
  // The labels contain commas, so they are introduced with a colon rather
  // than folded into the sentence, which reads badly.
  return `Biggest line: ${biggest.label}, at ${money(
    biggest.monthlyWasteUsd,
  )} a month. Across everything you picked, roughly ${money(
    monthly,
  )} a month looks recoverable, and the $${AUDIT_PRICE_USD} audit pays for itself in about ${payback} months.`;
}

// Builds the message the contact form is prefilled with, listing the waste
// items the visitor selected. Returns '' when nothing costly is picked.
export function buildPrefillMessage(selectedIds: string[]): string {
  const lines = buildBreakdown(selectedIds);
  if (lines.length === 0) {
    return '';
  }
  const items = lines.map(
    (l) => `- ${l.label}: about ${money(l.monthlyWasteUsd)}/month recoverable`,
  );
  return `From the savings calculator, here is what I pay for:\n${items.join(
    '\n',
  )}\n\nEstimated recoverable spend: about ${money(
    estimateMonthlyWaste(selectedIds),
  )}/month, or ${money(estimateAnnualWaste(selectedIds))} a year.`;
}

// URL state, so a result can be shared with a business partner, returned to
// later, and deep-linked from an outreach email with the findings we already
// detected. Unknown ids are dropped rather than throwing.
export function encodeSelection(selectedIds: string[]): string {
  const seen = new Set<string>();
  const clean = selectedIds.filter((id) => {
    if (!isKnownOption(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return clean.join(',');
}

export function decodeSelection(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return encodeSelection(value.split(',').map((s) => s.trim())).split(',').filter(Boolean);
}
