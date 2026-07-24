// Extracts the best contact email from a page's markup. Prefers an address
// on the prospect's own domain; falls back to the first plausible address.
// Filters out asset filenames and common no-reply/vendor noise.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const NOISE = [
  'example.com',
  'sentry.io',
  'wixpress.com',
  'squarespace.com',
  'godaddy.com',
  'no-reply',
  'noreply',
  'donotreply',
];

export function extractContactEmail(
  html: string,
  domain: string,
): string | null {
  if (!html) {
    return null;
  }

  const matches = html.match(EMAIL_RE);
  if (!matches) {
    return null;
  }

  const cleaned = matches
    .map((m) => m.toLowerCase())
    // Strip a trailing dot picked up from sentence punctuation.
    .map((m) => m.replace(/\.$/, ''))
    .filter((m) => !m.match(/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/))
    .filter((m) => !NOISE.some((n) => m.includes(n)));

  if (cleaned.length === 0) {
    return null;
  }

  const bareDomain = domain.toLowerCase().replace(/^www\./, '');
  const onDomain = cleaned.find((m) => m.endsWith(`@${bareDomain}`));
  return onDomain ?? cleaned[0];
}
