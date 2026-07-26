// Seat-reclaim model for the Enterprise track. Pure and coverage-gated so the
// numbers in a $2,499 pitch are tested, the same way src/lib/calculator.ts
// backs the SMB one.
//
// Per-seat figures are published list prices checked in July 2026, taken at
// the low end of each range and at the MONTHLY billing rate. The whole
// catalog sums to about $127 per seat, which sits at the bottom of the
// commonly cited $100 to $300 per employee per month for mid-market software
// spend. Undershooting is deliberate: an estimate that survives contact with
// a real invoice keeps the meeting, and one that overshoots ends it.

export interface SeatTool {
  id: string;
  label: string;
  // Per seat, per month, in USD.
  perSeatUsd: number;
  note: string;
}

// The flat Enterprise audit fee, used for the payback figure.
export const ENTERPRISE_AUDIT_PRICE_USD = 2499;

// A second tool serving a function you already cover. Held flat and low on
// purpose: a duplicate BI tool at even twenty seats clears this figure, so a
// flat floor is defensible against any invoice.
export const DUPLICATE_CATEGORY_USD = 250;

export const SEAT_TOOLS: SeatTool[] = [
  {
    id: 'email_suite',
    label: 'Google Workspace or Microsoft 365',
    perSeatUsd: 12,
    note: 'Business Standard tiers run $12.50 to $14 per user. Entry tiers cost less, so this is the floor.',
  },
  {
    id: 'comms',
    label: 'Slack or Teams on a paid tier',
    perSeatUsd: 8,
    note: 'Slack Pro is $8.75 per user billed monthly.',
  },
  {
    id: 'crm',
    label: 'CRM seat (Salesforce, HubSpot, Dynamics)',
    perSeatUsd: 25,
    note: 'Salesforce starts at $25 per user and climbs fast. Most mid-market seats cost far more.',
  },
  {
    id: 'pm',
    label: 'Project management (Jira, Asana, Monday)',
    perSeatUsd: 10,
    note: 'Standard tiers cluster around $10 to $12 per user.',
  },
  {
    id: 'bi',
    label: 'BI or analytics (Tableau, Power BI, Looker)',
    perSeatUsd: 20,
    note: 'Tableau Viewer is $15 and Creator is $75. Twenty dollars is a conservative blend.',
  },
  {
    id: 'itsm',
    label: 'Service desk (ServiceNow, Zendesk, Freshservice)',
    perSeatUsd: 19,
    note: 'Zendesk Suite Team is $19 per agent billed monthly.',
  },
  {
    id: 'hris',
    label: 'HR or payroll platform (Workday, ADP, Rippling)',
    perSeatUsd: 8,
    note: 'Per-employee pricing here is usually $8 to $15, and it bills on roster count.',
  },
  {
    id: 'security',
    label: 'Storage, VPN, password manager, or endpoint agent',
    perSeatUsd: 10,
    note: 'Several small per-seat agents that are rarely reclaimed at offboarding.',
  },
  {
    id: 'design_dev',
    label: 'Design or developer tooling (Adobe, GitHub, Figma)',
    perSeatUsd: 15,
    note: 'Only counts for the seats that actually carried these licenses.',
  },
];

const TOOLS_BY_ID = new Map<string, SeatTool>(SEAT_TOOLS.map((t) => [t.id, t]));

export function isKnownSeatTool(id: string): boolean {
  return TOOLS_BY_ID.has(id);
}

// Per-seat monthly cost of the selected tools. Unknown ids and duplicates are
// dropped rather than throwing, since these arrive from URL state.
export function perSeatMonthly(toolIds: string[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const id of toolIds) {
    const tool = TOOLS_BY_ID.get(id);
    if (tool && !seen.has(id)) {
      seen.add(id);
      total += tool.perSeatUsd;
    }
  }
  return total;
}

export interface SeatLine {
  id: string;
  label: string;
  perSeatUsd: number;
  monthlyUsd: number;
  note: string;
}

// Itemized per-tool cost for the seats being reclaimed. Buyers trust a
// line-by-line total far more than a single headline figure.
export function buildSeatBreakdown(seats: number, toolIds: string[]): SeatLine[] {
  if (seats <= 0) {
    return [];
  }
  const seen = new Set<string>();
  const lines: SeatLine[] = [];
  for (const id of toolIds) {
    const tool = TOOLS_BY_ID.get(id);
    if (!tool || seen.has(id)) {
      continue;
    }
    seen.add(id);
    lines.push({
      id: tool.id,
      label: tool.label,
      perSeatUsd: tool.perSeatUsd,
      monthlyUsd: tool.perSeatUsd * seats,
      note: tool.note,
    });
  }
  return lines.sort((a, b) => b.monthlyUsd - a.monthlyUsd);
}

// Spend still billing for seats nobody occupies.
export function seatWasteMonthly(seats: number, toolIds: string[]): number {
  if (seats <= 0) {
    return 0;
  }
  return seats * perSeatMonthly(toolIds);
}

// Cost of functions covered by more than one tool. Independent of seat count
// by design, see DUPLICATE_CATEGORY_USD.
export function duplicateWasteMonthly(duplicateCategories: number): number {
  if (duplicateCategories <= 0) {
    return 0;
  }
  return duplicateCategories * DUPLICATE_CATEGORY_USD;
}

export interface ReclaimInput {
  seats: number;
  toolIds: string[];
  duplicateCategories: number;
}

export function totalMonthlyReclaim(input: ReclaimInput): number {
  return (
    seatWasteMonthly(input.seats, input.toolIds) +
    duplicateWasteMonthly(input.duplicateCategories)
  );
}

export function totalAnnualReclaim(input: ReclaimInput): number {
  return totalMonthlyReclaim(input) * 12;
}

// The cost of doing nothing, which is the figure that actually moves a budget
// holder.
export function totalThreeYearReclaim(input: ReclaimInput): number {
  return totalMonthlyReclaim(input) * 36;
}

// Whole months for the Enterprise fee to pay for itself. Zero when nothing is
// recoverable, and never rounds below a full month.
export function auditPaybackMonths(input: ReclaimInput): number {
  const monthly = totalMonthlyReclaim(input);
  if (monthly <= 0) {
    return 0;
  }
  return Math.max(Math.ceil(ENTERPRISE_AUDIT_PRICE_USD / monthly), 1);
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// Plain-English summary of the result, which converts better than a bare
// number because it reflects what the visitor actually told us.
export function buildReclaimNarrative(input: ReclaimInput): string {
  const monthly = totalMonthlyReclaim(input);
  if (monthly <= 0) {
    return 'Nothing you entered points at recoverable seat spend. That is a good sign, and an audit would confirm it across the contracts and tiers this page does not ask about.';
  }
  const parts: string[] = [];
  const seatWaste = seatWasteMonthly(input.seats, input.toolIds);
  if (seatWaste > 0) {
    parts.push(
      `${input.seats} seat${input.seats === 1 ? '' : 's'} still licensed at ${money(
        perSeatMonthly(input.toolIds),
      )} each is ${money(seatWaste)} a month`,
    );
  }
  const dupWaste = duplicateWasteMonthly(input.duplicateCategories);
  if (dupWaste > 0) {
    parts.push(
      `${input.duplicateCategories} duplicated function${
        input.duplicateCategories === 1 ? '' : 's'
      } adds about ${money(dupWaste)}`,
    );
  }
  return `${parts.join(', and ')}. That is roughly ${money(
    monthly,
  )} a month, or ${money(
    totalAnnualReclaim(input),
  )} a year, and the ${money(
    ENTERPRISE_AUDIT_PRICE_USD,
  )} Enterprise audit pays for itself in about ${auditPaybackMonths(
    input,
  )} month${auditPaybackMonths(input) === 1 ? '' : 's'}.`;
}

// Prefills the contact form so the visitor does not retype what they just
// entered. Returns '' when there is nothing to recover.
export function buildReclaimPrefill(input: ReclaimInput): string {
  const monthly = totalMonthlyReclaim(input);
  if (monthly <= 0) {
    return '';
  }
  const lines = buildSeatBreakdown(input.seats, input.toolIds).map(
    (l) => `- ${l.label}: ${money(l.monthlyUsd)}/month across ${input.seats} seats`,
  );
  if (input.duplicateCategories > 0) {
    lines.push(
      `- ${input.duplicateCategories} function(s) covered by more than one tool: about ${money(
        duplicateWasteMonthly(input.duplicateCategories),
      )}/month`,
    );
  }
  return `From the seat-reclaim estimate:\n${lines.join(
    '\n',
  )}\n\nEstimated recoverable spend: about ${money(monthly)}/month, or ${money(
    totalAnnualReclaim(input),
  )} a year.`;
}

// URL state, so an estimate can be forwarded to whoever owns the budget and
// deep-linked from an outreach email with the seats we already know about.
export function encodeReclaim(input: ReclaimInput): string {
  const seen = new Set<string>();
  const tools = input.toolIds.filter((id) => {
    if (!isKnownSeatTool(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const seats = Number.isFinite(input.seats) ? Math.max(Math.trunc(input.seats), 0) : 0;
  const dupes = Number.isFinite(input.duplicateCategories)
    ? Math.max(Math.trunc(input.duplicateCategories), 0)
    : 0;
  return `${seats}|${dupes}|${tools.join(',')}`;
}

export function decodeReclaim(value: string | null | undefined): ReclaimInput {
  const empty: ReclaimInput = { seats: 0, toolIds: [], duplicateCategories: 0 };
  if (!value) {
    return empty;
  }
  // split always yields at least one element, so only the later segments can
  // be missing.
  const [seatsRaw, dupesRaw, toolsRaw] = value.split('|');
  const seats = Number.parseInt(seatsRaw, 10);
  const dupes = Number.parseInt(dupesRaw ?? '', 10);
  const seen = new Set<string>();
  const toolIds = (toolsRaw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((id) => {
      if (!isKnownSeatTool(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  return {
    seats: Number.isNaN(seats) || seats < 0 ? 0 : seats,
    duplicateCategories: Number.isNaN(dupes) || dupes < 0 ? 0 : dupes,
    toolIds,
  };
}
