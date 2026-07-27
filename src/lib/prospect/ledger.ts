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

export interface OutreachLedger {
  discovered: string[];
  contacted: string[];
  // Addresses we have already emailed. Tracked separately from domains
  // because one address can front several businesses (a shared owner or the
  // agency that runs both sites), and nobody should get two cold emails.
  contactedEmails: string[];
  optedOut: string[];
  // domain -> ISO timestamp of first contact, which drives follow-up timing.
  contactedAt: Record<string, string>;
  // domain -> ISO timestamp the single allowed follow-up went out.
  followedUpAt: Record<string, string>;
  // domain -> what came back, which closes the loop and stops follow-ups.
  outcomes: Record<string, { status: OutcomeStatus; at: string }>;
}

const EMPTY_LEDGER: OutreachLedger = {
  discovered: [],
  contacted: [],
  contactedEmails: [],
  optedOut: [],
  contactedAt: {},
  followedUpAt: {},
  outcomes: {},
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

function timestampMap(value: unknown): Record<string, string> {
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

// Tolerant of missing, empty, or malformed values so a corrupt ledger degrades
// to "contact nobody twice that we can prove" rather than crashing the run.
export function parseLedger(text: string): OutreachLedger {
  if (!text.trim()) {
    return { ...EMPTY_LEDGER };
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    return {
      discovered: domainArray(raw.discovered),
      contacted: domainArray(raw.contacted),
      contactedEmails: emailArray(raw.contactedEmails),
      optedOut: domainArray(raw.optedOut),
      contactedAt: timestampMap(raw.contactedAt),
      followedUpAt: timestampMap(raw.followedUpAt),
      outcomes: outcomeMap(raw.outcomes),
    };
  } catch {
    return { ...EMPTY_LEDGER };
  }
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

// Marks domains and addresses as emailed. Both are also marked discovered so
// the pair stays suppressed even if the discovered list is rebuilt. The first
// contact timestamp is never overwritten, because follow-up timing keys off
// the original send, not the most recent bookkeeping.
export function recordContacted(
  ledger: OutreachLedger,
  domains: string[],
  emails: string[] = [],
  now: Date = new Date(),
): OutreachLedger {
  const contactedAt = { ...ledger.contactedAt };
  for (const d of domains) {
    const bare = normalizeDomain(d);
    if (bare && !contactedAt[bare]) {
      contactedAt[bare] = now.toISOString();
    }
  }
  return {
    ...ledger,
    contacted: addDomains(ledger.contacted, domains),
    contactedEmails: addEmails(ledger.contactedEmails, emails),
    discovered: addDomains(ledger.discovered, domains),
    contactedAt,
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
// Every field is designed to converge: the lists are set unions, first
// contact is the earliest seen because follow-up timing keys off the original
// send, and follow-ups and outcomes take the most recent because they are
// corrections to an earlier state.
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
    followedUpAt: mergeTimestamps(base.followedUpAt, incoming.followedUpAt, 'latest'),
    outcomes: mergeOutcomes(base.outcomes, incoming.outcomes),
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
  contactedAt: string;
  daysAgo: number;
}

// Who is owed the single allowed follow-up: contacted at least `minDays` ago,
// no reply recorded, no follow-up sent yet, and not opted out. The upper bound
// keeps the list from filling with stale prospects nobody will chase.
export function dueForFollowUp(
  ledger: OutreachLedger,
  now: Date = new Date(),
  minDays = 5,
  maxDays = 21,
): FollowUpDue[] {
  const optedOut = new Set(ledger.optedOut);
  const due: FollowUpDue[] = [];

  for (const [domain, at] of Object.entries(ledger.contactedAt)) {
    if (optedOut.has(domain) || ledger.outcomes[domain] || ledger.followedUpAt[domain]) {
      continue;
    }
    const sent = Date.parse(at);
    if (Number.isNaN(sent)) {
      continue;
    }
    const daysAgo = Math.floor((now.getTime() - sent) / 86_400_000);
    if (daysAgo >= minDays && daysAgo <= maxDays) {
      due.push({ domain, contactedAt: at, daysAgo });
    }
  }

  return due.sort((a, b) => b.daysAgo - a.daysAgo);
}

export interface LedgerStats {
  discovered: number;
  contacted: number;
  emailed: number;
  awaitingReply: number;
  replied: number;
  booked: number;
  declined: number;
  bounced: number;
  optedOut: number;
  // Share of contacted domains that produced any reply, as a percentage.
  replyRate: number;
}

export function ledgerStats(ledger: OutreachLedger): LedgerStats {
  const counts = { replied: 0, booked: 0, declined: 0, bounced: 0 };
  for (const { status } of Object.values(ledger.outcomes)) {
    counts[status] += 1;
  }
  const contacted = ledger.contacted.length;
  // A booking is a reply too, so both count toward the rate.
  const anyReply = counts.replied + counts.booked;
  return {
    discovered: ledger.discovered.length,
    contacted,
    emailed: ledger.contactedEmails.length,
    awaitingReply: Math.max(contacted - Object.keys(ledger.outcomes).length, 0),
    ...counts,
    optedOut: ledger.optedOut.length,
    replyRate: contacted === 0 ? 0 : Math.round((anyReply / contacted) * 1000) / 10,
  };
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
