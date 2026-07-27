import { describe, expect, it } from 'vitest';
import {
  CITIES,
  buildSearchPlan,
  dayIndex,
  filterNewProspects,
  isExcludedHost,
  placeToProspect,
  type PlaceResult,
  type SearchQuery,
} from '../src/lib/prospect/discover';
import type { Prospect } from '../src/lib/prospect/compose';

const query: SearchQuery = {
  textQuery: 'hvac contractor in Tempe AZ',
  vertical: 'HVAC & Plumbing',
  city: 'Tempe AZ',
};

describe('buildSearchPlan', () => {
  it('returns the requested number of queries', () => {
    expect(buildSearchPlan(0, 5)).toHaveLength(5);
  });

  it('gives consecutive days disjoint query sets', () => {
    const day1 = buildSearchPlan(0, 6);
    const day2 = buildSearchPlan(1, 6);
    const seen = new Set(day1.map((q) => q.textQuery));
    expect(day2.some((q) => seen.has(q.textQuery))).toBe(false);
  });

  it('spans multiple verticals within a single run', () => {
    // Interleaved ordering: a 6-query window must never serve one trade.
    // 208 combinations / 6 per run = 35 distinct daily windows before wrap.
    for (let day = 0; day < 35; day += 1) {
      const plan = buildSearchPlan(day, 6);
      const trades = new Set(plan.map((q) => q.vertical));
      expect(trades.size).toBeGreaterThan(1);
    }
  });

  it('wraps around the end of the combination list', () => {
    const big = buildSearchPlan(0, 10_000);
    // Capped at the total number of combinations, never repeated past it.
    expect(new Set(big.map((q) => q.textQuery)).size).toBe(big.length);
  });

  it('handles negative day indexes', () => {
    expect(buildSearchPlan(-5, 2)).toHaveLength(2);
  });

  it('returns nothing when the cap is zero or negative', () => {
    expect(buildSearchPlan(0, 0)).toEqual([]);
    expect(buildSearchPlan(0, -1)).toEqual([]);
  });

  it('builds queries as term plus city, tagged with the vertical', () => {
    const [first] = buildSearchPlan(0, 1);
    expect(first.textQuery).toMatch(/ in .+ AZ$/);
    expect(CITIES).toContain(first.city);
    expect(first.vertical.length).toBeGreaterThan(0);
  });
});

describe('isExcludedHost', () => {
  it('excludes platform and directory hosts, including subdomains', () => {
    expect(isExcludedHost('facebook.com')).toBe(true);
    expect(isExcludedHost('https://www.yelp.com/biz/x')).toBe(true);
    expect(isExcludedHost('shop.square.site')).toBe(true);
  });

  it('allows a real business domain', () => {
    expect(isExcludedHost('acmehvac.com')).toBe(false);
  });
});

describe('placeToProspect', () => {
  it('maps a complete result and strips the state suffix from the city', () => {
    const place: PlaceResult = {
      displayName: { text: 'Acme HVAC' },
      websiteUri: 'https://www.acmehvac.com/home',
      businessStatus: 'OPERATIONAL',
    };
    expect(placeToProspect(place, query)).toEqual({
      business: 'Acme HVAC',
      domain: 'acmehvac.com',
      vertical: 'HVAC & Plumbing',
      city: 'Tempe',
    });
  });

  it('accepts a result with no businessStatus field', () => {
    const place: PlaceResult = {
      displayName: { text: 'Acme' },
      websiteUri: 'https://acme.com',
    };
    expect(placeToProspect(place, query)?.domain).toBe('acme.com');
  });

  it('rejects a result with no website', () => {
    expect(placeToProspect({ displayName: { text: 'Acme' } }, query)).toBeNull();
  });

  it('rejects a result with no name', () => {
    expect(placeToProspect({ websiteUri: 'https://acme.com' }, query)).toBeNull();
  });

  it('rejects an empty display name', () => {
    expect(
      placeToProspect({ displayName: { text: '  ' }, websiteUri: 'https://a.com' }, query),
    ).toBeNull();
  });

  it('rejects a permanently closed business', () => {
    const place: PlaceResult = {
      displayName: { text: 'Gone' },
      websiteUri: 'https://gone.com',
      businessStatus: 'CLOSED_PERMANENTLY',
    };
    expect(placeToProspect(place, query)).toBeNull();
  });

  it('rejects a platform-hosted website', () => {
    const place: PlaceResult = {
      displayName: { text: 'Social Only' },
      websiteUri: 'https://facebook.com/socialonly',
    };
    expect(placeToProspect(place, query)).toBeNull();
  });

  it('rejects a website that normalizes to nothing', () => {
    const place: PlaceResult = {
      displayName: { text: 'Weird' },
      websiteUri: 'https://',
    };
    expect(placeToProspect(place, query)).toBeNull();
  });
});

describe('filterNewProspects', () => {
  const make = (domain: string): Prospect => ({ business: domain, domain });

  it('drops domains already in the ledger', () => {
    const out = filterNewProspects([make('a.com'), make('b.com')], new Set(['a.com']));
    expect(out.map((p) => p.domain)).toEqual(['b.com']);
  });

  it('collapses duplicates within the same batch', () => {
    const out = filterNewProspects(
      [make('dup.com'), make('www.dup.com'), make('other.com')],
      new Set(),
    );
    expect(out.map((p) => p.domain)).toEqual(['dup.com', 'other.com']);
  });

  it('returns everything when nothing is known', () => {
    expect(filterNewProspects([make('x.com')], new Set())).toHaveLength(1);
  });
});

describe('dayIndex', () => {
  it('increments once per day', () => {
    const a = dayIndex(new Date('2026-07-24T00:00:00Z'));
    const b = dayIndex(new Date('2026-07-25T00:00:00Z'));
    expect(b - a).toBe(1);
  });
});
