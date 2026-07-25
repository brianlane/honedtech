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
  type OutreachLedger,
} from '../src/lib/prospect/ledger';

const EMPTY = parseLedger('');
const NOW = new Date('2026-07-25T00:00:00Z');

// Contacted 10 days ago, so it sits inside the follow-up window.
function withOverdueContact(domain: string): OutreachLedger {
  const ledger = recordContacted(EMPTY, [domain], [], new Date('2026-07-15T00:00:00Z'));
  return ledger;
}

describe('buildSnapshot', () => {
  it('captures stats and the sorted list of due domains', () => {
    let ledger = withOverdueContact('b.com');
    ledger = recordContacted(ledger, ['a.com'], [], new Date('2026-07-15T00:00:00Z'));
    const snapshot = buildSnapshot(ledger, NOW);
    expect(snapshot.stats.contacted).toBe(2);
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
});

describe('describeChanges', () => {
  it('says it is the first report when there is no baseline', () => {
    expect(describeChanges(null, buildSnapshot(EMPTY, NOW))).toEqual([
      'First status report.',
    ]);
  });

  it('reports each moved counter with its direction', () => {
    const before = buildSnapshot(EMPTY, NOW);
    const after = buildSnapshot(recordContacted(EMPTY, ['a.com'], ['a@a.com']), NOW);
    const changes = describeChanges(before, after);
    expect(changes).toContain('Discovered: 0 to 1 (+1)');
    expect(changes).toContain('Contacted: 0 to 1 (+1)');
    expect(changes).toContain('Addresses emailed: 0 to 1 (+1)');
  });

  it('shows a minus sign when a counter goes down', () => {
    const before = buildSnapshot(recordContacted(EMPTY, ['a.com', 'b.com']), NOW);
    const after = buildSnapshot(recordContacted(EMPTY, ['a.com']), NOW);
    expect(describeChanges(before, after)).toContain('Contacted: 2 to 1 (-1)');
  });

  it('reports outcome counters and the reply rate', () => {
    const contacted = recordContacted(EMPTY, ['a.com']);
    const before = buildSnapshot(contacted, NOW);
    const after = buildSnapshot(recordOutcome(contacted, 'a.com', 'booked'), NOW);
    const changes = describeChanges(before, after);
    expect(changes).toContain('Booked: 0 to 1 (+1)');
    expect(changes.some((c) => c.startsWith('Reply rate:'))).toBe(true);
  });

  it('reports a decline, which also counts as an opt-out', () => {
    const contacted = recordContacted(EMPTY, ['a.com']);
    const changes = describeChanges(
      buildSnapshot(contacted, NOW),
      buildSnapshot(recordOutcome(contacted, 'a.com', 'declined'), NOW),
    );
    expect(changes).toContain('Declined: 0 to 1 (+1)');
    expect(changes).toContain('Opted out: 0 to 1 (+1)');
  });

  it('reports a bounce', () => {
    const contacted = recordContacted(EMPTY, ['a.com']);
    const changes = describeChanges(
      buildSnapshot(contacted, NOW),
      buildSnapshot(recordOutcome(contacted, 'a.com', 'bounced'), NOW),
    );
    expect(changes).toContain('Bounced: 0 to 1 (+1)');
  });

  it('reports a reply', () => {
    const contacted = recordContacted(EMPTY, ['a.com']);
    const changes = describeChanges(
      buildSnapshot(contacted, NOW),
      buildSnapshot(recordOutcome(contacted, 'a.com', 'replied'), NOW),
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
