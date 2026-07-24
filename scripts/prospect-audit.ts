// prospect:audit - probes each domain in a prospects CSV and writes raw
// findings to outreach/findings.jsonl. Network I/O lives here; all
// classification is delegated to the coverage-gated src/lib/prospect code.
//
// Usage:
//   npm run prospect:audit -- outreach/prospects.csv
//
// prospects.csv columns (header row required):
//   business,domain,vertical,city,contactName
import { promises as dns } from 'node:dns';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildFindings } from '../src/lib/prospect/findings';
import { extractContactEmail } from '../src/lib/prospect/contact';
import type { Prospect } from '../src/lib/prospect/compose';
import type { DomainProbe } from '../src/lib/prospect/types';
import { normalizeDomain } from '../src/lib/prospect/ledger';

const UA =
  'HonedTechBot/1.0 (+https://honedtech.com; tech-stack audit outreach)';
const TIMEOUT_MS = 12_000;

function parseProspects(csv: string): Prospect[] {
  const rows = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rows.length === 0) return [];
  const header = rows[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  return rows.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    return {
      business: cells[idx('business')] ?? '',
      domain: cells[idx('domain')] ?? '',
      vertical: cells[idx('vertical')] || undefined,
      city: cells[idx('city')] || undefined,
      contactName: cells[idx('contactname')] || undefined,
    };
  });
}

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

async function probeDomain(domain: string): Promise<DomainProbe> {
  const bare = normalizeDomain(domain);
  const probe: DomainProbe = { domain: bare };

  try {
    const httpUrl = `http://${bare}`;
    const res = await fetchWithTimeout(httpUrl);
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

async function main() {
  const input = process.argv[2] ?? 'outreach/prospects.csv';
  const outPath = 'outreach/findings.jsonl';
  const csv = await readFile(input, 'utf8');
  const prospects = parseProspects(csv);

  await mkdir(dirname(outPath), { recursive: true });
  const out: string[] = [];

  for (const p of prospects) {
    if (!p.domain) continue;
    process.stdout.write(`Probing ${p.domain} ... `);
    const probe = await probeDomain(p.domain);
    const findings = buildFindings(probe);
    const contactEmail = extractContactEmail(probe.html ?? '', probe.domain);
    out.push(JSON.stringify({ prospect: p, findings, contactEmail }));
    console.log(`${findings.length} finding(s)`);
  }

  await writeFile(outPath, `${out.join('\n')}\n`, 'utf8');
  console.log(`\nWrote ${out.length} record(s) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
