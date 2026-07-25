// prospect:sent - record that a domain or address has been emailed, so the
// pipeline never queues it again. The scheduled run records its own digests
// automatically; use this for anything sent by hand or from another list.
//
// Usage:
//   npm run prospect:sent -- acme.com
//   npm run prospect:sent -- acme.com owner@acme.com
//   npm run prospect:sent -- owner@acme.com other@shop.com
import {
  ledgerKnownEmails,
  normalizeDomain,
  normalizeEmail,
  parseLedger,
  recordContacted,
  serializeLedger,
} from '../src/lib/prospect/ledger';
import { kvGet, kvPut } from './lib/kv';

const LEDGER_KEY = 'outreach-ledger';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set (see .env).`);
    process.exit(1);
  }
  return value;
}

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

  const token = required('CLOUDFLARE_API_TOKEN');
  const namespaceId = required('OUTREACH_KV_NAMESPACE_ID');

  const ledger = parseLedger(await kvGet(token, namespaceId, LEDGER_KEY));
  const before = ledgerKnownEmails(ledger);
  const updated = recordContacted(ledger, domains, emails);
  await kvPut(token, namespaceId, LEDGER_KEY, serializeLedger(updated));

  for (const email of emails) {
    console.log(
      before.has(email)
        ? `  ${email} was already logged`
        : `  ${email} logged as emailed`,
    );
  }
  for (const domain of domains) {
    console.log(`  ${domain} marked contacted`);
  }
  console.log(
    `\nLedger now records ${updated.contacted.length} contacted domain(s) and ` +
      `${updated.contactedEmails.length} emailed address(es).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
