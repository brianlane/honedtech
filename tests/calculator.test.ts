import { describe, expect, it } from 'vitest';
import {
  AUDIT_PRICE_USD,
  CALCULATOR_SECTIONS,
  auditPaybackMonths,
  buildBreakdown,
  buildNarrative,
  buildPrefillMessage,
  currentMonthlySpend,
  decodeSelection,
  encodeSelection,
  estimateAnnualWaste,
  estimateMonthlyWaste,
  estimateThreeYearWaste,
  isKnownOption,
} from '../src/lib/calculator';

describe('calculator model', () => {
  it('has unique option ids across all sections', () => {
    const ids = CALCULATOR_SECTIONS.flatMap((s) => s.options.map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never claims savings larger than the current cost', () => {
    for (const section of CALCULATOR_SECTIONS) {
      for (const option of section.options) {
        expect(option.monthlyAfterUsd).toBeLessThanOrEqual(option.monthlyCostUsd);
      }
    }
  });

  it('recognizes known and unknown option ids', () => {
    expect(isKnownOption('shopify_no_store')).toBe(true);
    expect(isKnownOption('nope')).toBe(false);
  });
});

describe('breakdown and totals', () => {
  it('itemizes only selections with recoverable spend, biggest first', () => {
    const lines = buildBreakdown(['registrar_upsells', 'shopify_no_store', 'website_fine']);
    expect(lines.map((l) => l.id)).toEqual(['shopify_no_store', 'registrar_upsells']);
    expect(lines[0].monthlyWasteUsd).toBe(39);
  });

  it('reports cost, after, and waste per line', () => {
    const [line] = buildBreakdown(['wix']);
    expect(line.monthlyCostUsd).toBe(29);
    expect(line.monthlyAfterUsd).toBe(2);
    expect(line.monthlyWasteUsd).toBe(27);
    expect(line.note).toBeTruthy();
  });

  it('ignores unknown ids and duplicates', () => {
    expect(buildBreakdown(['nope', 'wix', 'wix'])).toHaveLength(1);
    expect(estimateMonthlyWaste(['nope'])).toBe(0);
  });

  it('sums waste, and multiplies out to a year and three years', () => {
    const ids = ['shopify_no_store', 'email_1_3'];
    expect(estimateMonthlyWaste(ids)).toBe(54);
    expect(estimateAnnualWaste(ids)).toBe(648);
    expect(estimateThreeYearWaste(ids)).toBe(1944);
  });

  it('reports what they pay today, including non-wasteful picks', () => {
    // email_4_10 costs $45 of which $15 is a genuine need.
    expect(currentMonthlySpend(['email_4_10'])).toBe(45);
    expect(estimateMonthlyWaste(['email_4_10'])).toBe(30);
  });

  it('counts a duplicate selection once in the current spend', () => {
    expect(currentMonthlySpend(['wix', 'wix', 'nope'])).toBe(29);
  });

  it('returns zero for an empty selection', () => {
    expect(estimateMonthlyWaste([])).toBe(0);
    expect(currentMonthlySpend([])).toBe(0);
    expect(buildBreakdown([])).toEqual([]);
  });
});

describe('auditPaybackMonths', () => {
  it('is zero when nothing is recoverable', () => {
    expect(auditPaybackMonths([])).toBe(0);
    expect(auditPaybackMonths(['website_fine'])).toBe(0);
  });

  it('rounds up to whole months', () => {
    // $39/mo against a $299 fee is 7.6 months.
    expect(auditPaybackMonths(['shopify_no_store'])).toBe(8);
  });

  it('shortens as more waste is selected', () => {
    const ids = ['email_11_plus', 'shopify_no_store', 'overlapping_marketing', 'unused_saas'];
    expect(estimateMonthlyWaste(ids)).toBe(139);
    expect(auditPaybackMonths(ids)).toBe(3);
  });

  it('cannot pay back instantly, since the model caps below the audit fee', () => {
    // Sanity check on the whole model: selecting the worst case in every
    // section still lands under the fee, so payback is always 2+ months and
    // the tool can never overpromise.
    const everything = CALCULATOR_SECTIONS.flatMap((s) =>
      s.mode === 'multi'
        ? s.options.map((o) => o.id)
        : [
            s.options.reduce((worst, o) =>
              o.monthlyCostUsd - o.monthlyAfterUsd >
              worst.monthlyCostUsd - worst.monthlyAfterUsd
                ? o
                : worst,
            ).id,
          ],
    );
    expect(estimateMonthlyWaste(everything)).toBeLessThan(AUDIT_PRICE_USD);
    expect(auditPaybackMonths(everything)).toBeGreaterThan(1);
  });
});

describe('buildNarrative', () => {
  it('names the biggest line, the monthly total, and the payback', () => {
    const text = buildNarrative(['shopify_no_store', 'registrar_upsells']);
    expect(text).toContain('Biggest line: Shopify, but we do not sell online');
    expect(text).toContain('$54');
    expect(text).toContain('6 months');
  });

  it('reports payback in months for a larger selection', () => {
    const text = buildNarrative([
      'email_11_plus',
      'shopify_no_store',
      'overlapping_marketing',
      'unused_saas',
    ]);
    expect(text).toContain('$139');
    expect(text).toContain('about 3 months');
  });

  it('stays encouraging when nothing is wasteful', () => {
    expect(buildNarrative(['website_fine'])).toContain('good sign');
  });
});

describe('buildPrefillMessage', () => {
  it('lists each recoverable line with monthly and annual totals', () => {
    const msg = buildPrefillMessage(['shopify_no_store', 'website_fine', 'phone_pos']);
    expect(msg).toContain('Shopify, but we do not sell online');
    expect(msg).toContain('Phone, scheduling, or POS on a high tier');
    expect(msg).not.toContain('Custom or already lean');
    expect(msg).toContain('$57/month');
    expect(msg).toContain('$684 a year');
  });

  it('returns empty when nothing costly is picked', () => {
    expect(buildPrefillMessage(['website_fine', 'email_none'])).toBe('');
    expect(buildPrefillMessage([])).toBe('');
  });
});

describe('URL state', () => {
  it('round-trips a selection', () => {
    const encoded = encodeSelection(['wix', 'email_1_3']);
    expect(encoded).toBe('wix,email_1_3');
    expect(decodeSelection(encoded)).toEqual(['wix', 'email_1_3']);
  });

  it('drops unknown ids and duplicates when encoding', () => {
    expect(encodeSelection(['wix', 'bogus', 'wix'])).toBe('wix');
  });

  it('tolerates whitespace, junk, and missing values when decoding', () => {
    expect(decodeSelection(' wix , bogus ')).toEqual(['wix']);
    expect(decodeSelection('')).toEqual([]);
    expect(decodeSelection(null)).toEqual([]);
    expect(decodeSelection(undefined)).toEqual([]);
    expect(decodeSelection('bogus')).toEqual([]);
  });
});
