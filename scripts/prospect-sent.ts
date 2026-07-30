// prospect:sent - record that an email actually went out, which starts the
// follow-up clock and is what the reply rate is measured against. Run this
// after every send from Gmail, including drafts the digest composed: the
// pipeline only knows it drafted them, never that you sent them.
//
// Usage:
//   npm run prospect:sent -- acme.com
//   npm run prospect:sent -- acme.com owner@acme.com
//   npm run prospect:sent -- owner@acme.com other@shop.com
import {
  normalizeDomain,
  normalizeEmail,
  recordSent,
} from '../src/lib/prospect/ledger';
import { loadLedgerForDomains } from './lib/ledger-io';

async function main() {
  const inputs = process.argv.slice(2).filter((a) => a.trim().length > 0);
  if (inputs.length === 0) {
    console.error(
      'Usage: npm run prospect:sent -- <domain or email> [more...]',
    );
    process.exit(1);
  }

  // An address implies its domain, so logging one email suppresses both.
  const emails = inputs.filter((i) => i.includes('@')).map(normalizeEmail);
  const domains = [
    ...inputs.filter((i) => !i.includes('@')).map(normalizeDomain),
    ...emails.map((e) => normalizeDomain(e.split('@')[1] ?? '')),
  ].filter((d) => d.length > 0);

  const { key, ledger, save } = await loadLedgerForDomains(domains);
  const alreadySent = { ...ledger.sentAt };
  const updated = recordSent(ledger, domains, emails);
  await save(updated);

  console.log(`Ledger: ${key}`);
  for (const domain of domains) {
    console.log(
      alreadySent[domain]
        ? `  ${domain} was already logged as sent`
        : `  ${domain} logged as sent`,
    );
  }
  console.log(
    `\nLedger now records ${Object.keys(updated.sentAt).length} sent domain(s) ` +
      `out of ${updated.contacted.length} drafted.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
