import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_CATEGORY_USD,
  ENTERPRISE_AUDIT_PRICE_USD,
  SEAT_TOOLS,
  auditPaybackMonths,
  buildReclaimNarrative,
  buildReclaimPrefill,
  buildSeatBreakdown,
  decodeReclaim,
  duplicateWasteMonthly,
  encodeReclaim,
  isKnownSeatTool,
  perSeatMonthly,
  seatWasteMonthly,
  totalAnnualReclaim,
  totalMonthlyReclaim,
  totalThreeYearReclaim,
} from '../src/lib/enterprise/seats';

const ALL_TOOLS = SEAT_TOOLS.map((t) => t.id);

describe('seat tool catalog', () => {
  it('has unique ids and explains every price', () => {
    const ids = SEAT_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of SEAT_TOOLS) {
      expect(t.perSeatUsd).toBeGreaterThan(0);
      expect(t.note).toBeTruthy();
    }
  });

  it('sums to the low end of the published per-employee range', () => {
    // Commonly cited mid-market software spend is $100 to $300 per employee
    // per month. Landing at the bottom of that is the whole point.
    const total = perSeatMonthly(ALL_TOOLS);
    expect(total).toBeGreaterThanOrEqual(100);
    expect(total).toBeLessThanOrEqual(150);
  });

  it('recognizes known and unknown ids', () => {
    expect(isKnownSeatTool('crm')).toBe(true);
    expect(isKnownSeatTool('nope')).toBe(false);
  });

  it('ignores unknown ids and duplicates when pricing a seat', () => {
    expect(perSeatMonthly(['crm', 'crm', 'nope'])).toBe(25);
    expect(perSeatMonthly([])).toBe(0);
  });
});

describe('seat and duplicate waste', () => {
  it('multiplies per-seat cost by the seats being reclaimed', () => {
    expect(seatWasteMonthly(10, ['email_suite', 'comms'])).toBe(200);
  });

  it('is zero for a non-positive seat count', () => {
    expect(seatWasteMonthly(0, ALL_TOOLS)).toBe(0);
    expect(seatWasteMonthly(-5, ALL_TOOLS)).toBe(0);
  });

  it('charges a flat figure per duplicated function', () => {
    expect(duplicateWasteMonthly(3)).toBe(3 * DUPLICATE_CATEGORY_USD);
    expect(duplicateWasteMonthly(0)).toBe(0);
    expect(duplicateWasteMonthly(-2)).toBe(0);
  });

  it('sums both sources and projects them out', () => {
    const input = { seats: 10, toolIds: ['email_suite'], duplicateCategories: 1 };
    expect(totalMonthlyReclaim(input)).toBe(120 + 250);
    expect(totalAnnualReclaim(input)).toBe(4440);
    expect(totalThreeYearReclaim(input)).toBe(13320);
  });
});

describe('buildSeatBreakdown', () => {
  it('itemizes per tool, biggest first', () => {
    const lines = buildSeatBreakdown(4, ['comms', 'crm']);
    expect(lines.map((l) => l.id)).toEqual(['crm', 'comms']);
    expect(lines[0].perSeatUsd).toBe(25);
    expect(lines[0].monthlyUsd).toBe(100);
    expect(lines[0].note).toBeTruthy();
  });

  it('drops unknown ids and duplicates', () => {
    expect(buildSeatBreakdown(2, ['crm', 'crm', 'nope'])).toHaveLength(1);
  });

  it('is empty without seats', () => {
    expect(buildSeatBreakdown(0, ['crm'])).toEqual([]);
  });
});

describe('auditPaybackMonths', () => {
  it('is zero when nothing is recoverable', () => {
    expect(auditPaybackMonths({ seats: 0, toolIds: [], duplicateCategories: 0 })).toBe(0);
  });

  it('rounds up to whole months', () => {
    // $250/mo against a $2,499 fee is 9.996 months.
    expect(
      auditPaybackMonths({ seats: 0, toolIds: [], duplicateCategories: 1 }),
    ).toBe(10);
  });

  it('never reports less than a full month, even at large scale', () => {
    const input = { seats: 500, toolIds: ALL_TOOLS, duplicateCategories: 5 };
    expect(totalMonthlyReclaim(input)).toBeGreaterThan(ENTERPRISE_AUDIT_PRICE_USD);
    expect(auditPaybackMonths(input)).toBe(1);
  });
});

describe('buildReclaimNarrative', () => {
  it('stays encouraging when nothing is recoverable', () => {
    expect(
      buildReclaimNarrative({ seats: 0, toolIds: [], duplicateCategories: 0 }),
    ).toContain('good sign');
  });

  it('describes seats alone, using the singular for one seat', () => {
    const text = buildReclaimNarrative({
      seats: 1,
      toolIds: ['crm'],
      duplicateCategories: 0,
    });
    expect(text).toContain('1 seat still licensed');
    expect(text).not.toContain('1 seats');
    expect(text).not.toContain('duplicated function');
  });

  it('describes duplicates alone, using the singular for one', () => {
    const text = buildReclaimNarrative({
      seats: 0,
      toolIds: [],
      duplicateCategories: 1,
    });
    expect(text).toContain('1 duplicated function adds');
    expect(text).not.toContain('still licensed');
    expect(text).toContain('10 months');
  });

  it('reports a one-month payback in the singular', () => {
    const text = buildReclaimNarrative({
      seats: 500,
      toolIds: ALL_TOOLS,
      duplicateCategories: 0,
    });
    expect(text).toContain('about 1 month.');
    expect(text).not.toContain('1 months');
  });

  it('joins both sources and reports payback in the plural', () => {
    const text = buildReclaimNarrative({
      seats: 20,
      toolIds: ['email_suite', 'comms'],
      duplicateCategories: 2,
    });
    expect(text).toContain('20 seats still licensed at $20 each');
    expect(text).toContain('2 duplicated functions');
    expect(text).toContain('$900 a month');
    expect(text).toContain('3 months');
  });
});

describe('buildReclaimPrefill', () => {
  it('lists each licensed tool and the duplicate line', () => {
    const msg = buildReclaimPrefill({
      seats: 10,
      toolIds: ['crm'],
      duplicateCategories: 2,
    });
    expect(msg).toContain('CRM seat');
    expect(msg).toContain('$250/month across 10 seats');
    expect(msg).toContain('2 function(s) covered by more than one tool');
    expect(msg).toContain('$750/month');
  });

  it('omits the duplicate line when there are none', () => {
    const msg = buildReclaimPrefill({
      seats: 5,
      toolIds: ['comms'],
      duplicateCategories: 0,
    });
    expect(msg).not.toContain('more than one tool');
  });

  it('returns empty when nothing is recoverable', () => {
    expect(
      buildReclaimPrefill({ seats: 0, toolIds: [], duplicateCategories: 0 }),
    ).toBe('');
  });
});

describe('URL state', () => {
  it('round-trips an estimate', () => {
    const input = { seats: 40, toolIds: ['crm', 'comms'], duplicateCategories: 2 };
    const encoded = encodeReclaim(input);
    expect(encoded).toBe('40|2|crm,comms');
    expect(decodeReclaim(encoded)).toEqual(input);
  });

  it('drops unknown and duplicate tool ids, and floors negatives', () => {
    expect(
      encodeReclaim({ seats: -3, toolIds: ['crm', 'crm', 'bogus'], duplicateCategories: -1 }),
    ).toBe('0|0|crm');
  });

  it('truncates fractional input rather than emitting a decimal', () => {
    expect(
      encodeReclaim({ seats: 12.7, toolIds: [], duplicateCategories: 1.9 }),
    ).toBe('12|1|');
  });

  it('treats non-finite numbers as zero', () => {
    expect(
      encodeReclaim({ seats: Number.NaN, toolIds: [], duplicateCategories: Infinity }),
    ).toBe('0|0|');
  });

  it('decodes junk and missing values to an empty estimate', () => {
    const empty = { seats: 0, toolIds: [], duplicateCategories: 0 };
    expect(decodeReclaim('')).toEqual(empty);
    expect(decodeReclaim(null)).toEqual(empty);
    expect(decodeReclaim(undefined)).toEqual(empty);
    expect(decodeReclaim('nonsense')).toEqual(empty);
    expect(decodeReclaim('-4|-2|bogus')).toEqual(empty);
  });

  it('tolerates whitespace and a missing tool segment', () => {
    expect(decodeReclaim('5|0| crm , bogus ')).toEqual({
      seats: 5,
      duplicateCategories: 0,
      toolIds: ['crm'],
    });
    expect(decodeReclaim('5')).toEqual({
      seats: 5,
      duplicateCategories: 0,
      toolIds: [],
    });
  });

  it('ignores a repeated tool id when decoding', () => {
    expect(decodeReclaim('1|0|crm,crm').toolIds).toEqual(['crm']);
  });
});
