// prospect:optout - permanently suppress one or more domains. Run this the
// moment someone asks to stop hearing from us (CAN-SPAM: same day, no
// exceptions). Updates the shared KV ledger the scheduled pipeline reads.
//
// Usage:
//   npm run prospect:optout -- acme.com
//   npm run prospect:optout -- acme.com other.com https://www.third.com/contact
import {
  ledgerKnownDomains,
  normalizeDomain,
  recordOptedOut,
} from '../src/lib/prospect/ledger';
import { loadLedger } from './lib/ledger-io';

async function main() {
  const inputs = process.argv.slice(2).filter((a) => a.trim().length > 0);
  if (inputs.length === 0) {
    console.error('Usage: npm run prospect:optout -- <domain> [more domains]');
    process.exit(1);
  }

  const { ledger, save } = await loadLedger();
  const before = new Set(ledger.optedOut);
  const updated = recordOptedOut(ledger, inputs);
  await save(updated);

  for (const input of inputs) {
    const domain = normalizeDomain(input);
    console.log(
      before.has(domain)
        ? `  ${domain} was already opted out`
        : `  ${domain} opted out`,
    );
  }
  console.log(
    `\nLedger now suppresses ${ledgerKnownDomains(updated).size} domain(s), ` +
      `${updated.optedOut.length} of them opt-outs.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
