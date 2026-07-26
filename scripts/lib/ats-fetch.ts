// Reads a company's public job board. Network I/O only; board detection and
// feed parsing live in src/lib/enterprise/ats.ts.
//
// Every major ATS publishes an unauthenticated JSON feed so companies can
// embed their own listings elsewhere. We follow the careers-page link to find
// which one they use, then read the feed the vendor already intends to be
// read. No HTML scraping of the listings themselves.
import {
  atsFeedUrl,
  detectAtsBoard,
  parseJobFeed,
  type AtsBoard,
  type JobPosting,
} from '../../src/lib/enterprise/ats';

const UA =
  'HonedTechBot/1.0 (+https://honedtech.com; tech-stack audit outreach)';
const TIMEOUT_MS = 12_000;

// Where careers links live on a corporate site, in rough order of likelihood.
const CAREERS_PATHS = ['/careers', '/jobs', '/company/careers', '/about/careers', '/'];

async function getText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': UA },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'application/json' },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Walks the likely careers paths until one names a board we can read.
export async function findAtsBoard(domain: string): Promise<AtsBoard | null> {
  for (const path of CAREERS_PATHS) {
    const html = await getText(`https://${domain}${path}`);
    if (!html) {
      continue;
    }
    const board = detectAtsBoard(html);
    if (board) {
      return board;
    }
  }
  return null;
}

// Open postings for a domain, or an empty list when the company uses an ATS we
// do not read. An empty list costs one signal, never the run.
export async function fetchJobPostings(domain: string): Promise<JobPosting[]> {
  const board = await findAtsBoard(domain);
  if (!board) {
    return [];
  }
  const payload = await getJson(atsFeedUrl(board));
  if (payload === null) {
    return [];
  }
  return parseJobFeed(board.vendor, payload);
}
