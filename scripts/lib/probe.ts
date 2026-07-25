// Network probe for one prospect domain: one HTTP fetch plus three DNS
// lookups. Shared by the manual audit script and the automated pipeline.
// Lives in scripts/ (not src/) because it is pure network I/O; all
// classification happens in the coverage-gated src/lib/prospect code.
import { promises as dns } from 'node:dns';
import { normalizeDomain } from '../../src/lib/prospect/ledger';
import type { DomainProbe } from '../../src/lib/prospect/types';

const UA =
  'HonedTechBot/1.0 (+https://honedtech.com; tech-stack audit outreach)';
const TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': UA },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Starts at http:// on purpose so the redirect to https (or its absence) is
// itself a finding. A failed fetch still returns a probe: the DNS signals
// alone are enough to classify email hosting and authentication.
export async function probeDomain(domain: string): Promise<DomainProbe> {
  const bare = normalizeDomain(domain);
  const probe: DomainProbe = { domain: bare };

  try {
    const res = await fetchWithTimeout(`http://${bare}`);
    probe.finalUrl = res.url;
    probe.statusCode = res.status;
    probe.redirectedToHttps = res.url.startsWith('https://');
    probe.headers = Object.fromEntries(res.headers.entries());
    const html = await res.text();
    probe.html = html;
    probe.htmlBytes = Buffer.byteLength(html, 'utf8');
    probe.requestCount =
      (html.match(/<(script|link|img)\b/gi) ?? []).length || undefined;
  } catch (err) {
    console.warn(`  ! fetch failed for ${bare}: ${(err as Error).message}`);
  }

  try {
    const mx = await dns.resolveMx(bare);
    probe.mxRecords = mx.map((r) => r.exchange);
  } catch {
    probe.mxRecords = [];
  }
  try {
    probe.txtRecords = (await dns.resolveTxt(bare)).map((r) => r.join(''));
  } catch {
    probe.txtRecords = [];
  }
  try {
    probe.dmarcRecords = (await dns.resolveTxt(`_dmarc.${bare}`)).map((r) =>
      r.join(''),
    );
  } catch {
    probe.dmarcRecords = [];
  }

  return probe;
}
