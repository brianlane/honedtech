// Google Places Text Search client. Network I/O only; query planning and
// result filtering live in src/lib/prospect/discover.ts.
import {
  buildSearchPlan,
  dayIndex,
  filterNewProspects,
  placeToProspect,
  type PlaceResult,
  type SearchQuery,
} from '../../src/lib/prospect/discover';
import type { Prospect } from '../../src/lib/prospect/compose';

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// IMPORTANT (cost): `places.websiteUri` puts this request in a higher-priced
// Places SKU. It is required (a prospect with no website has nothing to
// audit), but do not widen this mask without checking current pricing.
const FIELD_MASK = [
  'places.displayName',
  'places.websiteUri',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.businessStatus',
].join(',');

async function searchOnce(
  apiKey: string,
  query: SearchQuery,
  maxResults: number,
): Promise<PlaceResult[]> {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query.textQuery,
      maxResultCount: maxResults,
      // Many trades are service-area businesses with no storefront address.
      includePureServiceAreaBusinesses: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places search failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { places?: PlaceResult[] };
  return data.places ?? [];
}

export interface DiscoverOptions {
  apiKey: string;
  known: Set<string>;
  // Hard cap on new prospects returned, which also bounds the sending volume.
  limit: number;
  queriesPerRun?: number;
  resultsPerQuery?: number;
  now?: Date;
}

// Runs the day's rotated queries until `limit` new prospects are collected.
export async function discoverProspects(
  opts: DiscoverOptions,
): Promise<Prospect[]> {
  const {
    apiKey,
    known,
    limit,
    queriesPerRun = 6,
    resultsPerQuery = 20,
    now = new Date(),
  } = opts;

  const plan = buildSearchPlan(dayIndex(now), queriesPerRun);
  const collected: Prospect[] = [];

  for (const query of plan) {
    if (collected.length >= limit) break;
    process.stdout.write(`Searching "${query.textQuery}" ... `);
    let places: PlaceResult[];
    try {
      places = await searchOnce(apiKey, query, resultsPerQuery);
    } catch (err) {
      console.log(`failed: ${(err as Error).message}`);
      continue;
    }
    const mapped = places
      .map((place) => placeToProspect(place, query))
      .filter((p): p is Prospect => p !== null);
    const fresh = filterNewProspects(mapped, known);
    for (const p of fresh) {
      if (collected.length >= limit) break;
      collected.push(p);
      known.add(p.domain);
    }
    console.log(`${places.length} result(s), ${fresh.length} new`);
  }

  return collected.slice(0, limit);
}
