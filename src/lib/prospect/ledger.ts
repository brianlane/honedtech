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
export interface OutreachLedger {
  discovered: string[];
  contacted: string[];
  optedOut: string[];
}

const EMPTY_LEDGER: OutreachLedger = {
  discovered: [],
  contacted: [],
  optedOut: [],
};

function domainArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(normalizeDomain)
    .filter((d) => d.length > 0);
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
      optedOut: domainArray(raw.optedOut),
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

function addDomains(existing: string[], domains: string[]): string[] {
  const set = new Set(existing);
  for (const d of domains) {
    const bare = normalizeDomain(d);
    if (bare) set.add(bare);
  }
  return [...set];
}

export function recordDiscovered(
  ledger: OutreachLedger,
  domains: string[],
): OutreachLedger {
  return { ...ledger, discovered: addDomains(ledger.discovered, domains) };
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
