// prospect:skip - record a draft you read and decided not to send, so it stops
// counting as pending work and never turns up on the follow-up list. The
// domain stays suppressed: it was drafted once already, and spending another
// slot on a prospect you have judged is not worth it.
//
// Usage:
//   npm run prospect:skip -- acme.com [more.com]
import { normalizeDomain, recordSkipped } from '../src/lib/prospect/ledger';
import { loadLedgerBatches } from './lib/ledger-io';

async function main() {
  const inputs = process.argv.slice(2).filter((a) => a.trim().length > 0);
  if (inputs.length === 0) {
    console.error('Usage: npm run prospect:skip -- <domain> [more domains]');
    process.exit(1);
  }

  const domains = inputs.map(normalizeDomain).filter((d) => d.length > 0);
  const batches = await loadLedgerBatches(domains);
  for (const { key, domains: batchDomains, handle } of batches) {
    const before = new Set(handle.ledger.skipped);
    const updated = recordSkipped(handle.ledger, batchDomains);
    await handle.save(updated);

    console.log(`Ledger: ${key}`);
    for (const domain of batchDomains) {
      console.log(
        before.has(domain)
          ? `  ${domain} was already skipped`
          : `  ${domain} skipped, no email will be sent`,
      );
    }
    console.log(`  ${updated.skipped.length} skipped draft(s) on this ledger.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
