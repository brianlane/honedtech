import { verticals } from '../../data/verticals';
import type { Prospect } from './compose';
import { normalizeDomain } from './ledger';

// Automated prospect discovery via Google Places Text Search. Pure logic
// only: query planning, result mapping, and filtering. The network call lives
// in scripts/ so this stays deterministic and testable.

// Phoenix metro, the service area on the Google Business Profile.
export const CITIES = [
  'Phoenix AZ',
  'Scottsdale AZ',
  'Tempe AZ',
  'Mesa AZ',
  'Chandler AZ',
  'Gilbert AZ',
  'Glendale AZ',
  'Peoria AZ',
];

export interface SearchQuery {
  textQuery: string;
  vertical: string;
  city: string;
}

// A Places result, narrowed to the fields our field mask requests.
export interface PlaceResult {
  displayName?: { text?: string };
  websiteUri?: string;
  formattedAddress?: string;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
}

// Websites we cannot audit: the "site" is someone else's platform, so there is
// no stack of their own to review and no owner inbox behind the domain.
const EXCLUDED_HOSTS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'yelp.com',
  'google.com',
  'business.site',
  'wixsite.com',
  'squarespace.com',
  'weebly.com',
  'wordpress.com',
  'blogspot.com',
  'linktr.ee',
  'godaddysites.com',
  'square.site',
  'doordash.com',
  'ubereats.com',
];

// Every vertical x city x term combination, interleaved round-robin across
// verticals. Grouping by vertical instead would hand each trade a contiguous
// block of 16-24 queries, and the sliding daily window then serves one trade
// for weeks straight (an all-pest-control month, then an all-law-firm month).
// Interleaving makes any contiguous window span as many trades as it has
// queries.
function allCombinations(): SearchQuery[] {
  const perVertical: SearchQuery[][] = verticals.map((vertical) => {
    const queries: SearchQuery[] = [];
    for (const city of CITIES) {
      for (const term of vertical.searchTerms) {
        queries.push({
          textQuery: `${term} in ${city}`,
          vertical: vertical.name,
          city,
        });
      }
    }
    return queries;
  });

  const longest = Math.max(...perVertical.map((queries) => queries.length));
  const out: SearchQuery[] = [];
  for (let i = 0; i < longest; i += 1) {
    for (const queries of perVertical) {
      if (i < queries.length) {
        out.push(queries[i]);
      }
    }
  }
  return out;
}

// Picks the queries for one run. The start advances by a full run each day,
// so consecutive runs use disjoint queries instead of re-buying yesterday's
// Places searches, and the cap bounds what a single run can spend.
export function buildSearchPlan(dayIndex: number, queriesPerRun: number): SearchQuery[] {
  const all = allCombinations();
  if (queriesPerRun <= 0 || all.length === 0) {
    return [];
  }
  const count = Math.min(queriesPerRun, all.length);
  const start = (((dayIndex * count) % all.length) + all.length) % all.length;
  const plan: SearchQuery[] = [];
  for (let i = 0; i < count; i += 1) {
    plan.push(all[(start + i) % all.length]);
  }
  return plan;
}

export function isExcludedHost(domain: string): boolean {
  const bare = normalizeDomain(domain);
  return EXCLUDED_HOSTS.some((host) => bare === host || bare.endsWith(`.${host}`));
}

// Maps a Places result to a Prospect, or null when it is not worth contacting:
// no website (nothing to audit), not operational, or a platform-hosted site.
export function placeToProspect(
  place: PlaceResult,
  query: SearchQuery,
): Prospect | null {
  const business = place.displayName?.text?.trim();
  const website = place.websiteUri?.trim();
  if (!business || !website) {
    return null;
  }
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') {
    return null;
  }
  const domain = normalizeDomain(website);
  if (!domain || isExcludedHost(domain)) {
    return null;
  }
  return {
    business,
    domain,
    vertical: query.vertical,
    city: query.city.replace(/ AZ$/, ''),
  };
}

// Drops prospects already discovered, contacted, or opted out, and collapses
// duplicates within the same batch (chains appear under several queries).
export function filterNewProspects(
  incoming: Prospect[],
  known: Set<string>,
): Prospect[] {
  const seen = new Set<string>();
  const out: Prospect[] = [];
  for (const p of incoming) {
    const domain = normalizeDomain(p.domain);
    if (known.has(domain) || seen.has(domain)) {
      continue;
    }
    seen.add(domain);
    out.push(p);
  }
  return out;
}

// Day number since epoch, the rotation key for buildSearchPlan.
export function dayIndex(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}
