// prospect:skip - record a draft you read and decided not to send, so it stops
// counting as pending work and never turns up on the follow-up list. The
// domain stays suppressed: it was drafted once already, and spending another
// slot on a prospect you have judged is not worth it.
//
// Usage:
//   npm run prospect:skip -- acme.com [more.com]
import { normalizeDomain, recordSkipped } from '../src/lib/prospect/ledger';
import { loadLedgerForDomains } from './lib/ledger-io';

async function main() {
  const inputs = process.argv.slice(2).filter((a) => a.trim().length > 0);
  if (inputs.length === 0) {
    console.error('Usage: npm run prospect:skip -- <domain> [more domains]');
    process.exit(1);
  }

  const domains = inputs.map(normalizeDomain).filter((d) => d.length > 0);
  const { key, ledger, save } = await loadLedgerForDomains(domains);
  const before = new Set(ledger.skipped);
  const updated = recordSkipped(ledger, inputs);
  await save(updated);

  console.log(`Ledger: ${key}`);
  for (const domain of domains) {
    console.log(
      before.has(domain)
        ? `  ${domain} was already skipped`
        : `  ${domain} skipped, no email will be sent`,
    );
  }
  console.log(`\nLedger now records ${updated.skipped.length} skipped draft(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
