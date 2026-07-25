// prospect:discover - finds new prospects via Google Places and appends them
// to outreach/prospects.csv. For manual/ad-hoc runs; the scheduled pipeline
// discovers against the KV ledger instead.
//
// Usage:
//   npm run prospect:discover -- 15
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildSuppressionSet, normalizeDomain } from '../src/lib/prospect/ledger';
import { discoverProspects } from './lib/places';

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function main() {
  const limit = Number(process.argv[2] ?? '15');
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not set (see .env).');
    process.exit(1);
  }

  // Never rediscover a domain already listed, contacted, or opted out.
  const existingCsv = await readOptional('outreach/prospects.csv');
  const known = buildSuppressionSet(
    await readOptional('outreach/optout.csv'),
    await readOptional('outreach/outreach-log.csv'),
  );
  for (const line of existingCsv.split(/\r?\n/).slice(1)) {
    const domain = line.split(',')[1]?.trim();
    if (domain) known.add(normalizeDomain(domain));
  }

  const found = await discoverProspects({ apiKey, known, limit });

  if (found.length === 0) {
    console.log('\nNo new prospects found this run.');
    return;
  }

  await mkdir('outreach', { recursive: true });
  if (!existingCsv.trim()) {
    await writeFile(
      'outreach/prospects.csv',
      'business,domain,vertical,city,contactName\n',
      'utf8',
    );
  }
  const rows = found
    .map((p) => `${p.business.replace(/,/g, '')},${p.domain},${p.vertical ?? ''},${p.city ?? ''},`)
    .join('\n');
  await appendFile('outreach/prospects.csv', `${rows}\n`, 'utf8');

  console.log(`\nAppended ${found.length} prospect(s) to outreach/prospects.csv`);
  for (const p of found) console.log(`  ${p.business} (${p.domain})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
