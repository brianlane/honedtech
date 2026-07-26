// Applicant tracking system detection. Every major ATS publishes an
// unauthenticated JSON job feed so companies can embed their own listings, so
// a careers page link is all we need to read what a company is hiring for. No
// HTML scraping and no terms-of-service grey area.
//
// Escaped-dot regex rather than string matching on hostname-shaped literals,
// matching the convention in src/lib/prospect/detect.ts: this is content
// fingerprinting, and it clears the CodeQL URL-substring rule.

export type AtsVendor =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'smartrecruiters'
  | 'workable'
  | 'recruitee';

export interface AtsBoard {
  vendor: AtsVendor;
  // The company's board identifier, whatever each vendor calls it.
  token: string;
}

// Order matters only for determinism; a page normally links to just one.
const BOARD_PATTERNS: { vendor: AtsVendor; pattern: RegExp }[] = [
  { vendor: 'greenhouse', pattern: /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/i },
  { vendor: 'lever', pattern: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { vendor: 'ashby', pattern: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
  {
    vendor: 'smartrecruiters',
    pattern: /careers\.smartrecruiters\.com\/([a-z0-9_-]+)/i,
  },
  { vendor: 'workable', pattern: /apply\.workable\.com\/([a-z0-9_-]+)/i },
  { vendor: 'recruitee', pattern: /([a-z0-9_-]+)\.recruitee\.com/i },
];

// Finds the company's job board from careers-page markup, or null when the
// page uses an ATS we do not read.
export function detectAtsBoard(html: string): AtsBoard | null {
  if (!html) {
    return null;
  }
  for (const { vendor, pattern } of BOARD_PATTERNS) {
    const match = pattern.exec(html);
    if (match && match[1]) {
      return { vendor, token: match[1].toLowerCase() };
    }
  }
  return null;
}

// The public JSON feed for a board. Descriptions are requested where the
// vendor supports it, since the software names live in the body text.
export function atsFeedUrl(board: AtsBoard): string {
  const token = encodeURIComponent(board.token);
  switch (board.vendor) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
    case 'lever':
      return `https://api.lever.co/v0/postings/${token}?mode=json`;
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${token}`;
    case 'smartrecruiters':
      return `https://api.smartrecruiters.com/v1/companies/${token}/postings`;
    case 'workable':
      return `https://apply.workable.com/api/v1/widget/accounts/${token}`;
    default:
      return `https://${token}.recruitee.com/api/offers/`;
  }
}

export interface JobPosting {
  title: string;
  description: string;
}

function plain(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  // Greenhouse returns HTML-escaped HTML, so unescape once and then strip.
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Normalizes any of the vendor payloads into title and description pairs.
// Unknown shapes yield an empty list rather than throwing, because a feed that
// changed shape should cost us one signal, not the whole run.
export function parseJobFeed(vendor: AtsVendor, payload: unknown): JobPosting[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const root = payload as Record<string, unknown>;

  let rows: unknown[];
  switch (vendor) {
    case 'greenhouse':
      rows = asArray(root.jobs);
      break;
    case 'lever':
    case 'recruitee':
      rows = Array.isArray(payload) ? payload : asArray(root.offers);
      break;
    case 'ashby':
      rows = asArray(root.jobs);
      break;
    case 'smartrecruiters':
      rows = asArray(root.content);
      break;
    default:
      rows = asArray(root.jobs);
      break;
  }

  const out: JobPosting[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const job = row as Record<string, unknown>;
    const title = plain(job.title ?? job.text ?? job.name);
    if (!title) {
      continue;
    }
    const description = plain(
      job.content ?? job.description ?? job.descriptionPlain ?? job.jobDescription,
    );
    out.push({ title, description });
  }
  return out;
}
