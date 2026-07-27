import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  describeChanges,
  parseSnapshot,
  serializeSnapshot,
  snapshotChanged,
} from '../src/lib/prospect/status';
import {
  parseLedger,
  recordContacted,
  recordOutcome,
  recordSent,
  recordSkipped,
  type OutreachLedger,
} from '../src/lib/prospect/ledger';

const EMPTY = parseLedger('');
const NOW = new Date('2026-07-25T00:00:00Z');

// Sent 10 days ago, so it sits inside the follow-up window.
function withOverdueContact(domain: string): OutreachLedger {
  return recordSent(EMPTY, [domain], [], new Date('2026-07-15T00:00:00Z'));
}

describe('buildSnapshot', () => {
  it('captures stats and the sorted list of due domains', () => {
    let ledger = withOverdueContact('b.com');
    ledger = recordSent(ledger, ['a.com'], [], new Date('2026-07-15T00:00:00Z'));
    const snapshot = buildSnapshot(ledger, NOW);
    expect(snapshot.stats.sent).toBe(2);
    expect(snapshot.dueDomains).toEqual(['a.com', 'b.com']);
  });

  it('omits day counts, so ageing alone is not a change', () => {
    const ledger = withOverdueContact('a.com');
    const week1 = buildSnapshot(ledger, new Date('2026-07-22T00:00:00Z'));
    const week2 = buildSnapshot(ledger, new Date('2026-07-29T00:00:00Z'));
    expect(snapshotChanged(week1, week2)).toBe(false);
  });
});

describe('snapshot persistence', () => {
  it('round-trips through serialize and parse', () => {
    const snapshot = buildSnapshot(withOverdueContact('a.com'), NOW);
    expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot);
  });

  it('treats blank, malformed, or incomplete stored values as absent', () => {
    expect(parseSnapshot('')).toBeNull();
    expect(parseSnapshot('   ')).toBeNull();
    expect(parseSnapshot('{not json')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ dueDomains: [] }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ stats: {} }))).toBeNull();
  });
});

describe('snapshotChanged', () => {
  it('reports change when there is no previous snapshot', () => {
    expect(snapshotChanged(null, buildSnapshot(EMPTY, NOW))).toBe(true);
  });

  it('is false for an identical week', () => {
    const a = buildSnapshot(withOverdueContact('a.com'), NOW);
    const b = buildSnapshot(withOverdueContact('a.com'), NOW);
    expect(snapshotChanged(a, b)).toBe(false);
  });

  it('is true when a stat moves', () => {
    const before = buildSnapshot(EMPTY, NOW);
    const after = buildSnapshot(recordContacted(EMPTY, ['new.com']), NOW);
    expect(snapshotChanged(before, after)).toBe(true);
  });

  it('is true when a domain becomes due', () => {
    const before = buildSnapshot(EMPTY, NOW);
    const after = buildSnapshot(withOverdueContact('a.com'), NOW);
    expect(snapshotChanged(before, after)).toBe(true);
  });

  // Whether to send and what to say have to agree, or the email arrives with
  // an empty "what changed" section. An older snapshot storing the same
  // backlog under the previous field names is exactly that case.
  it('stays silent for a snapshot that only differs in shape', () => {
    const legacy = parseSnapshot(
      JSON.stringify({
        stats: { discovered: 15, contacted: 15, emailed: 7, awaitingReply: 15, replyRate: 0 },
        dueDomains: [],
      }),
    );
    const sameLedger = recordContacted(
      EMPTY,
      Array.from({ length: 15 }, (_, i) => `biz${i + 1}.com`),
      Array.from({ length: 7 }, (_, i) => `owner@biz${i + 1}.com`),
    );
    const next = buildSnapshot(sameLedger, NOW);
    expect(describeChanges(legacy, next)).toEqual([]);
    expect(snapshotChanged(legacy, next)).toBe(false);
  });
});

describe('describeChanges', () => {
  it('says it is the first report when there is no baseline', () => {
    expect(describeChanges(null, buildSnapshot(EMPTY, NOW))).toEqual([
      'First status report.',
    ]);
  });

  // Drafting and sending are reported as separate lines on purpose. One
  // "Contacted" counter is what made a pile of unsent drafts read as outreach.
  it('separates a week of drafting from a week of sending', () => {
    const drafted = recordContacted(EMPTY, ['a.com'], ['a@a.com']);
    const draftChanges = describeChanges(buildSnapshot(EMPTY, NOW), buildSnapshot(drafted, NOW));
    expect(draftChanges).toContain('Discovered: 0 to 1 (+1)');
    expect(draftChanges).toContain('Drafted: 0 to 1 (+1)');
    expect(draftChanges).toContain('Drafts pending: 0 to 1 (+1)');
    expect(draftChanges).toContain('Addresses in drafts: 0 to 1 (+1)');
    expect(draftChanges).not.toContain('Sent: 0 to 1 (+1)');

    const sentChanges = describeChanges(
      buildSnapshot(drafted, NOW),
      buildSnapshot(recordSent(drafted, ['a.com']), NOW),
    );
    expect(sentChanges).toContain('Sent: 0 to 1 (+1)');
    expect(sentChanges).toContain('Drafts pending: 1 to 0 (-1)');
  });

  it('reports a skipped draft', () => {
    const drafted = recordContacted(EMPTY, ['a.com']);
    const changes = describeChanges(
      buildSnapshot(drafted, NOW),
      buildSnapshot(recordSkipped(drafted, ['a.com']), NOW),
    );
    expect(changes).toContain('Skipped: 0 to 1 (+1)');
  });

  it('shows a minus sign when a counter goes down', () => {
    const before = buildSnapshot(recordContacted(EMPTY, ['a.com', 'b.com']), NOW);
    const after = buildSnapshot(recordContacted(EMPTY, ['a.com']), NOW);
    expect(describeChanges(before, after)).toContain('Drafted: 2 to 1 (-1)');
  });

  // A stored snapshot predates any counter added since it was written. New
  // counters start from 0, and the one that was renamed carries its old value
  // over so the first report after the change still shows a true delta.
  it('reads an older snapshot without inventing movement', () => {
    const legacy = parseSnapshot(
      JSON.stringify({ stats: { discovered: 3, contacted: 3 }, dueDomains: [] }),
    );
    let ledger = recordContacted(EMPTY, ['a.com', 'b.com', 'c.com', 'd.com']);
    ledger = recordSent(ledger, ['a.com']);
    const changes = describeChanges(legacy, buildSnapshot(ledger, NOW));
    // Drafted was stored under the old name, so this is +1 and not +4.
    expect(changes).toContain('Drafted: 3 to 4 (+1)');
    // Nothing recorded a send back then, so all 3 counted as pending. One of
    // the 4 drafts has been sent since, which leaves the pending count at 3.
    expect(changes.some((c) => c.startsWith('Drafts pending:'))).toBe(false);
    expect(changes).toContain('Sent: 0 to 1 (+1)');
    expect(changes.some((c) => c.includes('undefined'))).toBe(false);
  });

  it('reports an unchanged backlog as unchanged after the shape change', () => {
    const legacy = parseSnapshot(
      JSON.stringify({ stats: { discovered: 3, contacted: 3 }, dueDomains: [] }),
    );
    const sameBacklog = buildSnapshot(recordContacted(EMPTY, ['a.com', 'b.com', 'c.com']), NOW);
    const changes = describeChanges(legacy, sameBacklog);
    expect(changes.some((c) => c.startsWith('Drafts pending:'))).toBe(false);
    expect(changes.some((c) => c.startsWith('Drafted:'))).toBe(false);
  });

  // The old rate was a share of drafts, so the stored number can differ from
  // the new one without anything having happened.
  it('ignores a rate that differs only because the definition changed', () => {
    const legacy = parseSnapshot(
      JSON.stringify({
        stats: { discovered: 1, contacted: 1, replied: 1, replyRate: 100 },
        dueDomains: [],
      }),
    );
    const unchanged = recordOutcome(recordContacted(EMPTY, ['a.com']), 'a.com', 'replied');
    const changes = describeChanges(legacy, buildSnapshot(unchanged, NOW));
    expect(changes.some((c) => c.startsWith('Reply rate:'))).toBe(false);
    expect(changes).toEqual([]);
  });

  it('reports outcome counters and the reply rate', () => {
    const sent = recordSent(EMPTY, ['a.com']);
    const before = buildSnapshot(sent, NOW);
    const after = buildSnapshot(recordOutcome(sent, 'a.com', 'booked'), NOW);
    const changes = describeChanges(before, after);
    expect(changes).toContain('Booked: 0 to 1 (+1)');
    expect(changes.some((c) => c.startsWith('Reply rate:'))).toBe(true);
  });

  it('reports a decline, which also counts as an opt-out', () => {
    const sent = recordSent(EMPTY, ['a.com']);
    const changes = describeChanges(
      buildSnapshot(sent, NOW),
      buildSnapshot(recordOutcome(sent, 'a.com', 'declined'), NOW),
    );
    expect(changes).toContain('Declined: 0 to 1 (+1)');
    expect(changes).toContain('Opted out: 0 to 1 (+1)');
  });

  it('reports a bounce', () => {
    const sent = recordSent(EMPTY, ['a.com']);
    const changes = describeChanges(
      buildSnapshot(sent, NOW),
      buildSnapshot(recordOutcome(sent, 'a.com', 'bounced'), NOW),
    );
    expect(changes).toContain('Bounced: 0 to 1 (+1)');
  });

  it('reports a reply', () => {
    const sent = recordSent(EMPTY, ['a.com']);
    const changes = describeChanges(
      buildSnapshot(sent, NOW),
      buildSnapshot(recordOutcome(sent, 'a.com', 'replied'), NOW),
    );
    expect(changes).toContain('Replied: 0 to 1 (+1)');
  });

  it('names domains newly due and cleared from follow-up', () => {
    const due = withOverdueContact('a.com');
    const before = buildSnapshot(due, NOW);
    const cleared = recordOutcome(due, 'a.com', 'replied');
    expect(describeChanges(buildSnapshot(EMPTY, NOW), before)).toContain(
      'Newly due for follow-up: a.com',
    );
    expect(describeChanges(before, buildSnapshot(cleared, NOW))).toContain(
      'Cleared from follow-up: a.com',
    );
  });

  it('returns nothing when the week was genuinely quiet', () => {
    const snapshot = buildSnapshot(withOverdueContact('a.com'), NOW);
    expect(describeChanges(snapshot, snapshot)).toEqual([]);
  });
});
