// WARN Act filing source. Network I/O only; normalization and the contact
// window rule live in src/lib/enterprise/warn.ts so they stay testable.
//
// Several aggregators republish the state registries (WARN Firehose,
// CanaryWhistle, LayoffLens). The endpoint and the auth header are env-driven
// so switching provider is configuration rather than a rewrite, and the
// normalizer already tolerates the common field spellings.
import {
  MAX_LAG_DAYS,
  MIN_LAG_DAYS,
  normalizeWarnRecord,
} from '../../src/lib/enterprise/warn';
import type { WarnRecord } from '../../src/lib/enterprise/types';

const DEFAULT_URL = 'https://warnfirehose.com/api/records';

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Pulls the array of records out of whichever envelope the provider uses.
function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const root = payload as Record<string, unknown>;
  for (const key of ['records', 'results', 'data', 'notices', 'items']) {
    if (Array.isArray(root[key])) {
      return root[key] as unknown[];
    }
  }
  return [];
}

export interface WarnFetchOptions {
  now?: Date;
  limit?: number;
  // Two-letter codes. Empty means every state the provider covers.
  states?: string[];
}

// Fetches filings whose effective date already sits inside the contact
// window, so nothing outside it is ever pulled into the run in the first
// place.
export async function fetchWarnRecords(
  opts: WarnFetchOptions = {},
): Promise<WarnRecord[]> {
  const { now = new Date(), limit = 200, states = [] } = opts;
  const baseUrl = process.env.WARN_API_URL || DEFAULT_URL;
  const apiKey = process.env.WARN_API_KEY;

  // Oldest allowed first: a filing MAX_LAG_DAYS old is the earliest we will
  // still pitch, and one MIN_LAG_DAYS old is the most recent that is decent.
  const from = new Date(now.getTime() - MAX_LAG_DAYS * 86_400_000);
  const to = new Date(now.getTime() - MIN_LAG_DAYS * 86_400_000);

  const queries: string[][] = states.length
    ? states.map((s) => ['state', s])
    : [[]];

  const collected: WarnRecord[] = [];
  const seen = new Set<string>();

  for (const pair of queries) {
    const url = new URL(baseUrl);
    url.searchParams.set('date_from', isoDay(from));
    url.searchParams.set('date_to', isoDay(to));
    url.searchParams.set('limit', String(limit));
    if (pair.length === 2) {
      url.searchParams.set(pair[0], pair[1]);
    }

    let payload: unknown;
    try {
      const res = await fetch(url, {
        headers: apiKey ? { 'X-API-Key': apiKey } : {},
      });
      if (!res.ok) {
        console.warn(
          `  ! WARN source returned ${res.status} for ${pair[1] ?? 'all states'}`,
        );
        continue;
      }
      payload = await res.json();
    } catch (err) {
      console.warn(`  ! WARN fetch failed: ${(err as Error).message}`);
      continue;
    }

    for (const row of extractRows(payload)) {
      const record = normalizeWarnRecord(row);
      if (!record) {
        continue;
      }
      // One national layoff can appear as several state filings, so collapse
      // on employer plus effective date rather than treating each as new.
      const key = `${record.employer.toLowerCase()}|${record.effectiveDate ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      collected.push(record);
    }
  }

  return collected;
}
