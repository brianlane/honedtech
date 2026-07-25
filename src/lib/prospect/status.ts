// Weekly status snapshot and change detection. The weekly email should only
// arrive when something actually moved, so an untouched week stays silent
// and the email keeps meaning something when it does land.
import {
  dueForFollowUp,
  ledgerStats,
  type LedgerStats,
  type OutreachLedger,
} from './ledger';

export interface StatusSnapshot {
  stats: LedgerStats;
  // Sorted so two runs over the same set always compare equal.
  dueDomains: string[];
}

export function buildSnapshot(
  ledger: OutreachLedger,
  now: Date = new Date(),
): StatusSnapshot {
  return {
    stats: ledgerStats(ledger),
    // Domain names only, deliberately not the day counts: a prospect ageing
    // from 7 to 8 days is not news, but one newly becoming due is.
    dueDomains: dueForFollowUp(ledger, now)
      .map((d) => d.domain)
      .sort(),
  };
}

export function parseSnapshot(text: string): StatusSnapshot | null {
  if (!text.trim()) {
    return null;
  }
  try {
    const raw = JSON.parse(text) as Partial<StatusSnapshot>;
    if (!raw.stats || !Array.isArray(raw.dueDomains)) {
      return null;
    }
    return { stats: raw.stats as LedgerStats, dueDomains: raw.dueDomains };
  } catch {
    return null;
  }
}

export function serializeSnapshot(snapshot: StatusSnapshot): string {
  return JSON.stringify(snapshot);
}

// A missing previous snapshot counts as changed, so the very first run always
// reports rather than silently doing nothing.
export function snapshotChanged(
  previous: StatusSnapshot | null,
  next: StatusSnapshot,
): boolean {
  if (!previous) {
    return true;
  }
  return serializeSnapshot(previous) !== serializeSnapshot(next);
}

// Human-readable diff for the email, so the message leads with what moved
// instead of making you compare two tables.
export function describeChanges(
  previous: StatusSnapshot | null,
  next: StatusSnapshot,
): string[] {
  if (!previous) {
    return ['First status report.'];
  }

  const changes: string[] = [];
  const labels: Array<[keyof LedgerStats, string]> = [
    ['discovered', 'Discovered'],
    ['contacted', 'Contacted'],
    ['emailed', 'Addresses emailed'],
    ['replied', 'Replied'],
    ['booked', 'Booked'],
    ['declined', 'Declined'],
    ['bounced', 'Bounced'],
    ['optedOut', 'Opted out'],
  ];

  for (const [key, label] of labels) {
    const before = previous.stats[key];
    const after = next.stats[key];
    if (before !== after) {
      const delta = after - before;
      changes.push(`${label}: ${before} to ${after} (${delta > 0 ? '+' : ''}${delta})`);
    }
  }

  if (previous.stats.replyRate !== next.stats.replyRate) {
    changes.push(
      `Reply rate: ${previous.stats.replyRate}% to ${next.stats.replyRate}%`,
    );
  }

  const before = new Set(previous.dueDomains);
  const after = new Set(next.dueDomains);
  const newlyDue = next.dueDomains.filter((d) => !before.has(d));
  const noLongerDue = previous.dueDomains.filter((d) => !after.has(d));
  if (newlyDue.length > 0) {
    changes.push(`Newly due for follow-up: ${newlyDue.join(', ')}`);
  }
  if (noLongerDue.length > 0) {
    changes.push(`Cleared from follow-up: ${noLongerDue.join(', ')}`);
  }

  return changes;
}
