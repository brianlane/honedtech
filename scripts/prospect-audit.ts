// prospect:audit - probes each domain in a prospects CSV and writes raw
// findings to outreach/findings.jsonl. For manual/ad-hoc runs; the scheduled
// pipeline (prospect:pipeline) does the same work against the KV ledger.
//
// Usage:
//   npm run prospect:audit -- outreach/prospects.csv
//
// prospects.csv columns (header row required):
//   business,domain,vertical,city,contactName
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildFindings } from '../src/lib/prospect/findings';
import { extractContactEmail } from '../src/lib/prospect/contact';
import type { Prospect } from '../src/lib/prospect/compose';
import { probeDomain } from './lib/probe';

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
