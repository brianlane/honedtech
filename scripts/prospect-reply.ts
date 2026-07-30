// prospect:reply - record what came back, which stops follow-ups and feeds
// the reply rate. Declines and bounces also suppress the domain for good.
//
// Usage:
//   npm run prospect:reply -- acme.com replied
//   npm run prospect:reply -- acme.com booked
//   npm run prospect:reply -- acme.com declined
//   npm run prospect:reply -- acme.com bounced
import {
  OUTCOME_STATUSES,
  isOutcomeStatus,
  normalizeDomain,
  recordOutcome,
} from '../src/lib/prospect/ledger';
import { loadLedgerForDomains } from './lib/ledger-io';

async function main() {
  const [rawDomain, rawStatus] = process.argv.slice(2);
  if (!rawDomain || !rawStatus) {
    console.error(
      `Usage: npm run prospect:reply -- <domain> <${OUTCOME_STATUSES.join('|')}>`,
    );
    process.exit(1);
  }

  const status = rawStatus.trim().toLowerCase();
  if (!isOutcomeStatus(status)) {
    console.error(`Unknown status "${rawStatus}". Use one of: ${OUTCOME_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const domain = normalizeDomain(rawDomain);
  const { key, ledger, save } = await loadLedgerForDomains([domain]);
  await save(recordOutcome(ledger, domain, status));

  console.log(`Ledger: ${key}`);
  console.log(`  ${domain} recorded as ${status}`);
  if (status === 'declined' || status === 'bounced') {
    console.log('  Also suppressed, so it will never be contacted again.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
