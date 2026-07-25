// prospect:followup - mark that the single allowed follow-up has been sent,
// so the domain drops off the due list and is never nudged again.
//
// Usage:
//   npm run prospect:followup -- acme.com [more.com]
import { normalizeDomain, recordFollowUp } from '../src/lib/prospect/ledger';
import { loadLedger } from './lib/ledger-io';

async function main() {
  const inputs = process.argv.slice(2).filter((a) => a.trim().length > 0);
  if (inputs.length === 0) {
    console.error('Usage: npm run prospect:followup -- <domain> [more domains]');
    process.exit(1);
  }

  const { ledger, save } = await loadLedger();
  await save(recordFollowUp(ledger, inputs));

  for (const input of inputs) {
    console.log(`  ${normalizeDomain(input)} follow-up recorded`);
  }
  console.log('\nThat is the last touch. No further outreach to these domains.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
