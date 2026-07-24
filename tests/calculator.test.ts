import { describe, expect, it } from 'vitest';
import {
  CALCULATOR_SECTIONS,
  buildPrefillMessage,
  estimateAnnualWaste,
  estimateMonthlyWaste,
} from '../src/lib/calculator';

describe('calculator model', () => {
  it('has unique option ids across all sections', () => {
    const ids = CALCULATOR_SECTIONS.flatMap((s) => s.options.map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sums monthly waste for selected ids', () => {
    expect(estimateMonthlyWaste(['shopify_no_store', 'email_small'])).toBe(60);
  });

  it('ignores unknown ids', () => {
    expect(estimateMonthlyWaste(['nope', 'website_fine'])).toBe(0);
  });

  it('returns 0 for an empty selection', () => {
    expect(estimateMonthlyWaste([])).toBe(0);
  });

  it('computes annual as twelve months', () => {
    expect(estimateAnnualWaste(['email_small'])).toBe(252);
  });

  it('builds a message listing only costly picks with the total', () => {
    const msg = buildPrefillMessage(['shopify_no_store', 'website_fine', 'phone_pos']);
    expect(msg).toContain('Shopify, but we do not sell online');
    expect(msg).toContain('Phone, scheduling, or POS on a high tier');
    expect(msg).not.toContain('Custom or already lean');
    expect(msg).toContain('$64/month');
  });

  it('returns an empty message when nothing costly is picked', () => {
    expect(buildPrefillMessage(['website_fine', 'email_none'])).toBe('');
    expect(buildPrefillMessage([])).toBe('');
  });
});
