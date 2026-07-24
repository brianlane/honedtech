// Savings-calculator model. Pure and coverage-gated so the numbers are
// tested; the /calculator page and its client script both consume this.
// Estimates are deliberately conservative monthly figures.

export interface CalcOption {
  id: string;
  label: string;
  monthlyWasteUsd: number;
}

export interface CalcSection {
  id: string;
  title: string;
  // 'single' renders as radios (pick one), 'multi' as checkboxes.
  mode: 'single' | 'multi';
  options: CalcOption[];
}

export const CALCULATOR_SECTIONS: CalcSection[] = [
  {
    id: 'website',
    title: 'Your website',
    mode: 'single',
    options: [
      { id: 'shopify_no_store', label: 'Shopify, but we do not sell online', monthlyWasteUsd: 39 },
      { id: 'page_builder', label: 'Wix, Squarespace, or GoDaddy builder', monthlyWasteUsd: 23 },
      { id: 'managed_wp', label: 'WordPress on premium managed hosting', monthlyWasteUsd: 25 },
      { id: 'website_fine', label: 'Custom or already lean', monthlyWasteUsd: 0 },
    ],
  },
  {
    id: 'email',
    title: 'Business email',
    mode: 'single',
    options: [
      { id: 'email_none', label: 'Free routing or not sure', monthlyWasteUsd: 0 },
      { id: 'email_small', label: 'Paid Google or Microsoft, 1 to 3 mailboxes', monthlyWasteUsd: 21 },
      { id: 'email_mid', label: 'Paid Google or Microsoft, 4 to 10 mailboxes', monthlyWasteUsd: 56 },
      { id: 'email_large', label: 'Paid Google or Microsoft, 10 or more', monthlyWasteUsd: 105 },
    ],
  },
  {
    id: 'extras',
    title: 'Other tools you pay for',
    mode: 'multi',
    options: [
      { id: 'managed_hosting', label: 'Premium hosting for a simple site', monthlyWasteUsd: 20 },
      { id: 'overlapping_marketing', label: 'Overlapping marketing tools (for example Mailchimp plus a CRM)', monthlyWasteUsd: 30 },
      { id: 'phone_pos', label: 'Phone, scheduling, or POS on a high tier', monthlyWasteUsd: 25 },
      { id: 'unused_saas', label: 'SaaS seats or licenses nobody uses', monthlyWasteUsd: 22 },
    ],
  },
];

const OPTIONS_BY_ID = new Map<string, CalcOption>(
  CALCULATOR_SECTIONS.flatMap((s) => s.options.map((o) => [o.id, o])),
);

// Sums the estimated monthly waste for the selected option ids. Unknown ids
// are ignored so stale query state can never throw.
export function estimateMonthlyWaste(selectedIds: string[]): number {
  return selectedIds.reduce((sum, id) => sum + (OPTIONS_BY_ID.get(id)?.monthlyWasteUsd ?? 0), 0);
}

export function estimateAnnualWaste(selectedIds: string[]): number {
  return estimateMonthlyWaste(selectedIds) * 12;
}

// Builds the message the contact form is prefilled with, listing the waste
// items the visitor selected. Returns '' when nothing costly is picked.
export function buildPrefillMessage(selectedIds: string[]): string {
  const picked = selectedIds
    .map((id) => OPTIONS_BY_ID.get(id))
    .filter((o): o is CalcOption => o !== undefined && o.monthlyWasteUsd > 0);
  if (picked.length === 0) {
    return '';
  }
  const lines = picked.map((o) => `- ${o.label}`);
  const monthly = estimateMonthlyWaste(selectedIds);
  return `From the savings calculator, here is what I pay for:\n${lines.join('\n')}\n\nEstimated recoverable spend: about $${monthly.toLocaleString('en-US')}/month.`;
}
