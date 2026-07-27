import type { Prospect } from './compose';

// Normalizes a domain or URL to a bare, comparable host: lowercase, no
// scheme, no leading www, no path, no trailing dot.
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  d = d.split('?')[0];
  d = d.replace(/\.$/, '');
  return d;
}

// Parses the first column of a CSV/plain list into normalized domains,
// skipping blank lines, comments (#), and an optional "domain" header.
export function parseDomainList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(',')[0].trim())
    .filter((cell) => cell.length > 0 && cell.toLowerCase() !== 'domain')
    .map(normalizeDomain)
    .filter((d) => d.length > 0);
}

// Union of opt-out entries and already-contacted domains from the log.
export function buildSuppressionSet(
  optoutText: string,
  logText: string,
): Set<string> {
  return new Set([
    ...parseDomainList(optoutText),
    ...parseDomainList(logText),
  ]);
}

// The automated pipeline keeps its state as one JSON value in KV instead of
// the local CSVs, because the scheduled runner is ephemeral.
// What happened after we emailed. Recorded by hand from your inbox, since
// replies land in Gmail and the pipeline never sees them.
export const OUTCOME_STATUSES = [
  'replied',
  'booked',
  'declined',
  'bounced',
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export function isOutcomeStatus(value: string): value is OutcomeStatus {
  return (OUTCOME_STATUSES as readonly string[]).includes(value);
}

// Drafting and sending are two different events, and only the second one is
// outreach. The pipeline drafts and delivers the digest to our own inbox; a
// human then sends each draft by hand from Gmail. The `contacted*` fields
// record the drafting, `sentAt` records the sending, and everything that
// depends on a prospect having actually heard from us keys off `sentAt`.
export interface OutreachLedger {
  discovered: string[];
  // Domains a draft was composed for. Suppression keys off this, because a
  // domain we drafted must not be surfaced and drafted a second time.
  contacted: string[];
  // Addresses a draft was addressed to. Tracked separately from domains
  // because one address can front several businesses (a shared owner or the
  // agency that runs both sites), and nobody should get two cold emails.
  contactedEmails: string[];
  optedOut: string[];
  // domain -> ISO timestamp the draft was composed.
  contactedAt: Record<string, string>;
  // domain -> ISO timestamp the email actually left Gmail, recorded by hand
  // with prospect:sent. Follow-up timing keys off this, so a draft that was
  // never sent is never nudged.
  sentAt: Record<string, string>;
  // Drafts deliberately not sent. Recorded so they stop counting as pending
  // work and never reach the follow-up list.
  skipped: string[];
  // domain -> ISO timestamp the single allowed follow-up went out.
  followedUpAt: Record<string, string>;
  // domain -> what came back, which closes the loop and stops follow-ups.
  outcomes: Record<string, { status: OutcomeStatus; at: string }>;
  // domain -> vertical it was discovered under, so outcomes can be compared
  // per trade. Without this a heavy week in one vertical reads as market
  // signal when it is only what discovery happened to be searching.
  verticals: Record<string, string>;
}

const EMPTY_LEDGER: OutreachLedger = {
  discovered: [],
  contacted: [],
  contactedEmails: [],
  optedOut: [],
  contactedAt: {},
  sentAt: {},
  skipped: [],
  followedUpAt: {},
  outcomes: {},
  verticals: {},
};

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function domainArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(normalizeDomain)
    .filter((d) => d.length > 0);
}

// domain -> non-empty string, with normalized keys. Used for both the
// timestamp maps and the vertical map.
function domainStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, ts] of Object.entries(value as Record<string, unknown>)) {
    const domain = normalizeDomain(key);
    if (domain && typeof ts === 'string' && ts.length > 0) {
      out[domain] = ts;
    }
  }
  return out;
}

function outcomeMap(
  value: unknown,
): Record<string, { status: OutcomeStatus; at: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, { status: OutcomeStatus; at: string }> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const domain = normalizeDomain(key);
    if (!domain || !entry || typeof entry !== 'object') {
      continue;
    }
    const { status, at } = entry as { status?: unknown; at?: unknown };
    if (typeof status === 'string' && isOutcomeStatus(status) && typeof at === 'string') {
      out[domain] = { status, at };
    }
  }
  return out;
}

function emailArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(normalizeEmail)
    .filter((e) => e.includes('@'));
}

export interface LedgerReadResult {
  ledger: OutreachLedger;
  // True when there was text but it did not parse. An absent or blank key is
  // NOT corrupt: that is simply the first run.
  corrupt: boolean;
}

// Tolerant of missing, empty, or malformed values, but it reports whether the
// value was unreadable. Callers that only read can carry on with an empty
// ledger; callers that are about to WRITE must not, because an empty ledger
// merged over a real one silently discards every opt-out it held.
export function parseLedgerResult(text: string): LedgerReadResult {
  if (!text.trim()) {
    return { ledger: { ...EMPTY_LEDGER }, corrupt: false };
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    return {
      ledger: {
        discovered: domainArray(raw.discovered),
        contacted: domainArray(raw.contacted),
        contactedEmails: emailArray(raw.contactedEmails),
        optedOut: domainArray(raw.optedOut),
        contactedAt: domainStringMap(raw.contactedAt),
        sentAt: domainStringMap(raw.sentAt),
        skipped: domainArray(raw.skipped),
        followedUpAt: domainStringMap(raw.followedUpAt),
        outcomes: outcomeMap(raw.outcomes),
        verticals: domainStringMap(raw.verticals),
      },
      corrupt: false,
    };
  } catch {
    return { ledger: { ...EMPTY_LEDGER }, corrupt: true };
  }
}

export function parseLedger(text: string): OutreachLedger {
  return parseLedgerResult(text).ledger;
}

export function serializeLedger(ledger: OutreachLedger): string {
  return JSON.stringify(ledger);
}

// Every domain the pipeline must not surface again.
export function ledgerKnownDomains(ledger: OutreachLedger): Set<string> {
  return new Set([
    ...ledger.discovered,
    ...ledger.contacted,
    ...ledger.optedOut,
  ]);
}

// Every address that has already received an email.
export function ledgerKnownEmails(ledger: OutreachLedger): Set<string> {
  return new Set(ledger.contactedEmails);
}

function addDomains(existing: string[], domains: string[]): string[] {
  const set = new Set(existing);
  for (const d of domains) {
    const bare = normalizeDomain(d);
    if (bare) set.add(bare);
  }
  return [...set];
}

function addEmails(existing: string[], emails: string[]): string[] {
  const set = new Set(existing);
  for (const e of emails) {
    const clean = normalizeEmail(e);
    if (clean.includes('@')) set.add(clean);
  }
  return [...set];
}

export function recordDiscovered(
  ledger: OutreachLedger,
  domains: string[],
): OutreachLedger {
  return { ...ledger, discovered: addDomains(ledger.discovered, domains) };
}

// Marks domains and addresses as drafted. Both are also marked discovered so
// the pair stays suppressed even if the discovered list is rebuilt. The first
// draft timestamp and the vertical are never overwritten, because outcome
// attribution keys off the original discovery, not the most recent
// bookkeeping.
export function recordContacted(
  ledger: OutreachLedger,
  domains: string[],
  emails: string[] = [],
  now: Date = new Date(),
  verticalByDomain: Record<string, string> = {},
): OutreachLedger {
  const contactedAt = { ...ledger.contactedAt };
  const verticals = { ...ledger.verticals };
  for (const d of domains) {
    const bare = normalizeDomain(d);
    if (!bare) {
      continue;
    }
    if (!contactedAt[bare]) {
      contactedAt[bare] = now.toISOString();
    }
    const vertical = verticalByDomain[d] ?? verticalByDomain[bare];
    if (vertical && !verticals[bare]) {
      verticals[bare] = vertical;
    }
  }
  return {
    ...ledger,
    contacted: addDomains(ledger.contacted, domains),
    contactedEmails: addEmails(ledger.contactedEmails, emails),
    discovered: addDomains(ledger.discovered, domains),
    contactedAt,
    verticals,
  };
}

// Marks that the email genuinely went out from Gmail, which is the event that
// starts the follow-up clock and the only one the reply rate is measured
// against. Also records the draft side, so a domain emailed by hand that the
// pipeline never drafted is still suppressed from here on.
export function recordSent(
  ledger: OutreachLedger,
  domains: string[],
  emails: string[] = [],
  now: Date = new Date(),
): OutreachLedger {
  const sentAt = { ...ledger.sentAt };
  for (const d of domains) {
    const bare = normalizeDomain(d);
    // First send wins: a second log of the same domain is bookkeeping, not a
    // second cold email, and follow-up timing keys off the original.
    if (bare && !sentAt[bare]) {
      sentAt[bare] = now.toISOString();
    }
  }
  return { ...recordContacted(ledger, domains, emails, now), sentAt };
}

// Records a draft passed over rather than sent. It stays suppressed, because
// it was already drafted once and re-drafting it would spend a slot on a
// prospect already judged not worth one.
export function recordSkipped(
  ledger: OutreachLedger,
  domains: string[],
): OutreachLedger {
  return {
    ...ledger,
    skipped: addDomains(ledger.skipped, domains),
    discovered: addDomains(ledger.discovered, domains),
  };
}

export function recordFollowUp(
  ledger: OutreachLedger,
  domains: string[],
  now: Date = new Date(),
): OutreachLedger {
  const followedUpAt = { ...ledger.followedUpAt };
  for (const d of domains) {
    const bare = normalizeDomain(d);
    if (bare) {
      followedUpAt[bare] = now.toISOString();
    }
  }
  return { ...ledger, followedUpAt };
}

export function recordOutcome(
  ledger: OutreachLedger,
  domain: string,
  status: OutcomeStatus,
  now: Date = new Date(),
): OutreachLedger {
  const bare = normalizeDomain(domain);
  if (!bare) {
    return ledger;
  }
  const next: OutreachLedger = {
    ...ledger,
    outcomes: { ...ledger.outcomes, [bare]: { status, at: now.toISOString() } },
  };
  // A bounce or a decline means stop contacting them, same as an opt-out.
  return status === 'declined' || status === 'bounced'
    ? recordOptedOut(next, [bare])
    : next;
}

// Combines two ledger snapshots without losing anything from either.
//
// Cloudflare KV has no compare-and-swap, so every writer does read, modify,
// write. The scheduled pipeline and the hand-run commands (optout, sent,
// reply, followup) share one key, and a manual opt-out landing mid-pipeline
// used to be erased by the pipeline's later write. Silently dropping an
// opt-out is the worst failure this system has, so writes merge instead of
// overwrite.
//
// Every field is designed to converge: the lists are set unions, the draft
// and send timestamps are the earliest seen because follow-up timing keys off
// the original send, and follow-ups and outcomes take the most recent because
// they are corrections to an earlier state.
export function mergeLedgers(
  base: OutreachLedger,
  incoming: OutreachLedger,
): OutreachLedger {
  return {
    discovered: addDomains(base.discovered, incoming.discovered),
    contacted: addDomains(base.contacted, incoming.contacted),
    contactedEmails: addEmails(base.contactedEmails, incoming.contactedEmails),
    optedOut: addDomains(base.optedOut, incoming.optedOut),
    contactedAt: mergeTimestamps(base.contactedAt, incoming.contactedAt, 'earliest'),
    sentAt: mergeTimestamps(base.sentAt, incoming.sentAt, 'earliest'),
    skipped: addDomains(base.skipped, incoming.skipped),
    followedUpAt: mergeTimestamps(base.followedUpAt, incoming.followedUpAt, 'latest'),
    outcomes: mergeOutcomes(base.outcomes, incoming.outcomes),
    // First writer wins, same spirit as the earliest contact timestamp: the
    // vertical a domain was originally discovered under is the true one.
    verticals: { ...incoming.verticals, ...base.verticals },
  };
}

function mergeTimestamps(
  base: Record<string, string>,
  incoming: Record<string, string>,
  keep: 'earliest' | 'latest',
): Record<string, string> {
  const out = { ...base };
  for (const [domain, at] of Object.entries(incoming)) {
    const existing = out[domain];
    if (!existing) {
      out[domain] = at;
      continue;
    }
    // Unparseable values lose to a usable one rather than winning by accident.
    const a = Date.parse(existing);
    const b = Date.parse(at);
    if (Number.isNaN(b)) {
      continue;
    }
    if (Number.isNaN(a) || (keep === 'earliest' ? b < a : b > a)) {
      out[domain] = at;
    }
  }
  return out;
}

function mergeOutcomes(
  base: Record<string, { status: OutcomeStatus; at: string }>,
  incoming: Record<string, { status: OutcomeStatus; at: string }>,
): Record<string, { status: OutcomeStatus; at: string }> {
  const out = { ...base };
  for (const [domain, entry] of Object.entries(incoming)) {
    const existing = out[domain];
    if (!existing) {
      out[domain] = entry;
      continue;
    }
    const a = Date.parse(existing.at);
    const b = Date.parse(entry.at);
    if (Number.isNaN(b)) {
      continue;
    }
    if (Number.isNaN(a) || b > a) {
      out[domain] = entry;
    }
  }
  return out;
}

export interface FollowUpDue {
  domain: string;
  sentAt: string;
  daysAgo: number;
}

// Who is owed the single allowed follow-up: sent to at least `minDays` ago,
// no reply recorded, no follow-up sent yet, and not opted out. Reading from
// `sentAt` rather than `contactedAt` is the point: nudging somebody about an
// email that only ever existed as a draft in our own inbox is nonsense.
//
// The upper bound keeps the list from filling with stale prospects nobody
// will chase.
export function dueForFollowUp(
  ledger: OutreachLedger,
  now: Date = new Date(),
  minDays = 5,
  maxDays = 21,
): FollowUpDue[] {
  const optedOut = new Set(ledger.optedOut);
  const due: FollowUpDue[] = [];

  for (const [domain, at] of Object.entries(ledger.sentAt)) {
    if (optedOut.has(domain) || ledger.outcomes[domain] || ledger.followedUpAt[domain]) {
      continue;
    }
    const sent = Date.parse(at);
    if (Number.isNaN(sent)) {
      continue;
    }
    const daysAgo = Math.floor((now.getTime() - sent) / 86_400_000);
    if (daysAgo >= minDays && daysAgo <= maxDays) {
      due.push({ domain, sentAt: at, daysAgo });
    }
  }

  return due.sort((a, b) => b.daysAgo - a.daysAgo);
}

export interface LedgerStats {
  discovered: number;
  // Drafts composed and delivered to the review inbox. Emphatically not the
  // number of prospects who heard from us.
  drafted: number;
  sent: number;
  skipped: number;
  // Drafted, not sent, not skipped: the queue still waiting on a human.
  pendingDrafts: number;
  emailed: number;
  awaitingReply: number;
  replied: number;
  booked: number;
  declined: number;
  bounced: number;
  optedOut: number;
  // Share of SENT domains that produced any reply, as a percentage. Measuring
  // it against drafts instead would read unsent mail as market silence.
  replyRate: number;
}

export function ledgerStats(ledger: OutreachLedger): LedgerStats {
  const counts = { replied: 0, booked: 0, declined: 0, bounced: 0 };
  for (const { status } of Object.values(ledger.outcomes)) {
    counts[status] += 1;
  }
  const sentDomains = Object.keys(ledger.sentAt);
  const sent = sentDomains.length;
  const skipped = new Set(ledger.skipped);
  // A booking is a reply too, so both count toward the rate. Counted over the
  // sent domains rather than over every outcome on record, because the two
  // sides of a rate have to describe the same population: an outcome logged
  // against a domain with no send on record would otherwise push the rate
  // above 100%.
  const anyReply = sentDomains.filter((d) => {
    const status = ledger.outcomes[d]?.status;
    return status === 'replied' || status === 'booked';
  }).length;
  return {
    discovered: ledger.discovered.length,
    drafted: ledger.contacted.length,
    sent,
    skipped: skipped.size,
    pendingDrafts: ledger.contacted.filter(
      (d) => !ledger.sentAt[d] && !skipped.has(d),
    ).length,
    emailed: ledger.contactedEmails.length,
    awaitingReply: sentDomains.filter((d) => !ledger.outcomes[d]).length,
    ...counts,
    optedOut: ledger.optedOut.length,
    replyRate: sent === 0 ? 0 : Math.round((anyReply / sent) * 1000) / 10,
  };
}

export interface VerticalStats {
  vertical: string;
  drafted: number;
  sent: number;
  replied: number;
  booked: number;
}

// Outcomes grouped by the vertical each domain was discovered under, which is
// the evidence that separates "this trade responds" from "this trade is what
// discovery happened to be searching that week". Drafted and sent are both
// carried, since a trade can only be judged on the mail that went out.
// Domains drafted before verticals were tracked group under "(unknown)".
export function verticalBreakdown(ledger: OutreachLedger): VerticalStats[] {
  const byVertical = new Map<string, VerticalStats>();
  for (const domain of ledger.contacted) {
    const vertical = ledger.verticals[domain] ?? '(unknown)';
    let entry = byVertical.get(vertical);
    if (!entry) {
      entry = { vertical, drafted: 0, sent: 0, replied: 0, booked: 0 };
      byVertical.set(vertical, entry);
    }
    entry.drafted += 1;
    if (ledger.sentAt[domain]) entry.sent += 1;
    const status = ledger.outcomes[domain]?.status;
    if (status === 'replied') entry.replied += 1;
    if (status === 'booked') entry.booked += 1;
  }
  return [...byVertical.values()].sort(
    (a, b) => b.drafted - a.drafted || a.vertical.localeCompare(b.vertical),
  );
}

// Opting out also marks the domain discovered, so it is suppressed even if the
// ledger's discovered list is ever cleared or rebuilt.
export function recordOptedOut(
  ledger: OutreachLedger,
  domains: string[],
): OutreachLedger {
  return {
    ...ledger,
    optedOut: addDomains(ledger.optedOut, domains),
    discovered: addDomains(ledger.discovered, domains),
  };
}

// Splits prospects into those safe to contact and those suppressed.
export function partitionProspects(
  prospects: Prospect[],
  suppressed: Set<string>,
): { sendable: Prospect[]; skipped: Prospect[] } {
  const sendable: Prospect[] = [];
  const skipped: Prospect[] = [];
  for (const p of prospects) {
    if (suppressed.has(normalizeDomain(p.domain))) {
      skipped.push(p);
    } else {
      sendable.push(p);
    }
  }
  return { sendable, skipped };
}
