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
