// WARN Act filing source. Network I/O only; normalization, the contact window
// rule, and selection live in src/lib/enterprise/warn.ts so they stay
// testable.
//
// Default source is the CanaryWhistle archive, which needs no API key and is
// licensed CC BY 4.0 for commercial use, crediting CanaryWhistle
// (https://canarywhistle.com/data). It publishes one bulk JSON of every
// historical filing rather than a query API, which suits us: its archive is
// explicitly "layoffs already notified over 30 days ago and already
// effective", so it lines up with the decency window instead of fighting it.
//
// Deliberately not WARN Firehose: its free tier serves only recent filings
// and paywalls history, which is exactly backwards for a pipeline whose whole
// point is waiting 45 days before making contact.
//
// The endpoint and an optional key header are env-driven so switching
// provider stays configuration. The normalizer already accepts the common
// field spellings across providers.
import {
  normalizeWarnRecord,
  selectContactableRecords,
} from '../../src/lib/enterprise/warn';
import type { WarnRecord } from '../../src/lib/enterprise/types';

const DEFAULT_ARCHIVE_URL =
  'https://canarywhistle.com/data/canarywhistle-warn-layoffs.json';

// The archive is a few megabytes, so allow more than a normal API call.
const TIMEOUT_MS = 60_000;

// Pulls the array of filings out of whichever envelope the provider uses.
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
  // Two-letter codes. Empty means every state the provider covers, which is
  // the sensible default: filtering to one state usually yields nothing.
  states?: string[];
}

// Filings already inside the contact window, freshest first.
export async function fetchWarnRecords(
  opts: WarnFetchOptions = {},
): Promise<WarnRecord[]> {
  const { now = new Date(), states = [] } = opts;
  const url = process.env.WARN_ARCHIVE_URL || DEFAULT_ARCHIVE_URL;
  const apiKey = process.env.WARN_API_KEY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // A failed fetch throws rather than returning nothing. Returning an empty
  // list made a broken URL, a network blip, or an upstream outage look exactly
  // like a quiet filing week: the pipeline announced it had nothing to work
  // with and exited successfully, so the job stayed green while the whole
  // source was down.
  let payload: unknown;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: apiKey ? { 'X-API-Key': apiKey } : {},
    });
    if (!res.ok) {
      throw new Error(
        `WARN source ${url} returned ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    payload = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const rows = extractRows(payload);
  const records: WarnRecord[] = [];
  for (const row of rows) {
    const record = normalizeWarnRecord(row);
    if (record) {
      records.push(record);
    }
  }
  console.log(`  archive: ${rows.length} filing(s) read`);

  return selectContactableRecords(records, now, states);
}
