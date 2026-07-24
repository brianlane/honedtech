import { describe, expect, it } from 'vitest';
import { verticals } from '../src/data/verticals';
import { verticalPath } from '../src/lib/prospect/compose';

describe('vertical data', () => {
  it('has unique slugs', () => {
    const slugs = verticals.map((v) => v.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // Outreach emails link to /audits/<slug> derived from the vertical name via
  // verticalPath(). If a page slug and that derivation ever diverge, the link
  // 404s. This locks them together.
  it('slug matches the outreach link derived from the name', () => {
    for (const v of verticals) {
      expect(verticalPath(v.name)).toBe(`/audits/${v.slug}`);
    }
  });

  it('every vertical has waste items and FAQ entries', () => {
    for (const v of verticals) {
      expect(v.waste.length).toBeGreaterThan(0);
      expect(v.faq.length).toBeGreaterThan(0);
    }
  });
});
