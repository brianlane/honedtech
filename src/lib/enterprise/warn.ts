import { perSeatMonthly } from './seats';
import type { AccountSignal, WarnRecord } from './types';

// WARN Act filings are public record: every US employer above the statutory
// size threshold must notify the state before a mass layoff or closure. Those
// registries are the strongest outside signal we can get, because a headcount
// drop is a dated, checkable fact and per-seat licenses almost never fall with
// it.
//
// Aggregator schemas differ and vendors change, so normalization accepts the
// common field spellings. Swapping providers should be a config change, not a
// rewrite.

// The core stack we assume a departed employee carried. Deliberately the three
// cheapest, most universal lines rather than the full catalog: nearly every
// office worker has email, chat, and one line-of-business seat, so this is the
// figure we can defend without knowing anything about their contracts.
const ASSUMED_SEAT_TOOLS = ['email_suite', 'comms', 'crm'];

// Share of departing seats we assume were actually reclaimed on time. The
// research puts inactive seats around 23% of a portfolio at any moment, so
// claiming even a third of a layoff is still leaving room.
const UNRECLAIMED_SHARE = 0.35;

// Contacting a company days after it cuts staff is ghoulish and gets mail
// blocked. Waiting until offboarding cleanup has been forgotten is both more
// decent and more effective, since by then the invoice has actually run twice.
export const MIN_LAG_DAYS = 45;
// Past this the urgency is gone and the seats were probably caught, so the
// pitch stops being credible.
export const MAX_LAG_DAYS = 270;

// Below this a layoff is not worth anyone's time. A filing for one person is
// about $16 a month of seats, which is an insulting thing to bring to a
// company alongside a $2,499 audit fee. Roughly two thirds of in-window
// filings clear this, so the floor costs no meaningful supply.
export const MIN_AFFECTED_SEATS = 25;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function count(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    // State registries publish "1,240" and "approx 300" alike.
    const digits = value.replace(/[^0-9]/g, '');
    if (digits.length > 0) {
      const parsed = Number.parseInt(digits, 10);
      return parsed > 0 ? parsed : undefined;
    }
  }
  return undefined;
}

function firstText(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(raw[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

// Maps one aggregator record onto our shape, or null when there is no employer
// to attribute the filing to.
export function normalizeWarnRecord(input: unknown): WarnRecord | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const employer = firstText(raw, [
    'employer_canonical',
    'employer',
    'company',
    'company_name',
    'name',
  ]);
  if (!employer) {
    return null;
  }
  const affected =
    count(raw.employeesAffected) ??
    count(raw.employees_affected) ??
    count(raw.employees) ??
    count(raw.affected) ??
    count(raw.num_employees);

  return {
    employer,
    city: firstText(raw, ['city', 'location']),
    state: firstText(raw, ['state', 'state_code']),
    employeesAffected: affected,
    noticeDate: firstText(raw, ['notice_date', 'noticeDate', 'received_date']),
    effectiveDate: firstText(raw, [
      'effective_date',
      'effectiveDate',
      'layoff_date',
      'separation_date',
    ]),
    closureType: firstText(raw, ['closure_type', 'closureType', 'type']),
    sourceUrl: firstText(raw, ['official_filing_url', 'source_url', 'sourceUrl', 'url']),
  };
}

// The date the layoff bites. Every state publishes a notice date, and most
// publish an effective date too, so the notice date is the fallback.
function effectiveOrNoticeDate(record: WarnRecord): string | undefined {
  return record.effectiveDate ?? record.noticeDate;
}

// Days since the layoff took effect, or null when no usable date was
// published.
export function daysSinceEffective(
  record: WarnRecord,
  now: Date = new Date(),
): number | null {
  const raw = effectiveOrNoticeDate(record);
  if (!raw) {
    return null;
  }
  const when = Date.parse(raw);
  if (Number.isNaN(when)) {
    return null;
  }
  return Math.floor((now.getTime() - when) / 86_400_000);
}

// Narrowing predicate, so callers that pass the check can treat the day count
// as a number without a second null test that could never fire.
function inLagWindow(
  days: number | null,
  minDays: number,
  maxDays: number,
): days is number {
  return days !== null && days >= minDays && days <= maxDays;
}

// The decency window. Records with no usable date are excluded rather than
// guessed at, because the whole point of the rule is knowing where we are
// relative to the layoff.
export function isWithinContactWindow(
  record: WarnRecord,
  now: Date = new Date(),
  minDays: number = MIN_LAG_DAYS,
  maxDays: number = MAX_LAG_DAYS,
): boolean {
  return inLagWindow(daysSinceEffective(record, now), minDays, maxDays);
}

// One comparable key per employer, so a company that filed in nine states
// does not become nine prospects.
function employerKey(employer: string): string {
  return employer.trim().toLowerCase().replace(/\s+/g, ' ');
}

// The filings worth working this run: inside the contact window, big enough
// to matter, optionally narrowed to given states, one per employer, freshest
// first.
//
// Deduplication is not a nicety. A large employer files separately per site,
// and Amazon alone accounts for over a hundred filings in a typical window.
// Without this, one company would exhaust the weekly limit and each duplicate
// would cost a paid Places lookup. Freshest wins, because the draft claims a
// specific month and that claim has to be the true one.
export function selectContactableRecords(
  records: WarnRecord[],
  now: Date = new Date(),
  states: string[] = [],
): WarnRecord[] {
  const wanted = new Set(
    states.map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0),
  );
  const scored: { record: WarnRecord; days: number }[] = [];

  for (const record of records) {
    if (wanted.size > 0 && !wanted.has((record.state ?? '').toUpperCase())) {
      continue;
    }
    if ((record.employeesAffected ?? 0) < MIN_AFFECTED_SEATS) {
      continue;
    }
    const days = daysSinceEffective(record, now);
    if (!inLagWindow(days, MIN_LAG_DAYS, MAX_LAG_DAYS)) {
      continue;
    }
    scored.push({ record, days });
  }

  scored.sort((a, b) => a.days - b.days);

  const seen = new Set<string>();
  const out: WarnRecord[] = [];
  for (const { record } of scored) {
    const key = employerKey(record.employer);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(record);
  }
  return out;
}

// Conservative monthly spend still billing for seats nobody occupies.
export function unreclaimedSeatSpend(record: WarnRecord): number {
  const seats = record.employeesAffected ?? 0;
  if (seats <= 0) {
    return 0;
  }
  return Math.round(
    seats * UNRECLAIMED_SHARE * perSeatMonthly(ASSUMED_SEAT_TOOLS),
  );
}

// Always reads as two or more months, because MIN_LAG_DAYS keeps anything
// fresher than that out of the run in the first place.
function monthsAgoPhrase(days: number): string {
  return `about ${Math.round(days / 30)} months ago`;
}

// Turns a filing into a contactable signal, or null when it falls outside the
// window or carries no headcount to reason about.
export function warnSignal(
  record: WarnRecord,
  now: Date = new Date(),
): AccountSignal | null {
  const days = daysSinceEffective(record, now);
  if (!inLagWindow(days, MIN_LAG_DAYS, MAX_LAG_DAYS)) {
    return null;
  }
  const seats = record.employeesAffected ?? 0;
  if (seats < MIN_AFFECTED_SEATS) {
    return null;
  }
  const where = record.state ? ` in ${record.state}` : '';
  // Guaranteed present: a day count only exists because one of these parsed.
  const when = effectiveOrNoticeDate(record);
  const link = record.sourceUrl ? `: ${record.sourceUrl}` : '';

  return {
    kind: 'layoff',
    headline: `Your team shrank by ${seats}${where} ${monthsAgoPhrase(
      days,
    )}. Per-seat licenses rarely shrink with it, and the ones nobody cancels keep billing every month.`,
    monthlyReclaimUsd: unreclaimedSeatSpend(record),
    // Bigger reductions are both a stronger pitch and a bigger recovery, but
    // the weight is capped so one enormous filing cannot dominate the ranking.
    strength: Math.min(100, 60 + Math.floor(seats / 25)),
    evidence: `WARN filing, ${seats} affected, effective ${when}${link}`,
  };
}
