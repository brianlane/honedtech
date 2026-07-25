// prospect:status:email - the weekly status report, sent only when something
// changed since the previous week. An untouched week stays silent, so the
// email keeps meaning something when it does arrive.
//
// Usage:
//   npm run prospect:status:email
//   FORCE_STATUS=1 npm run prospect:status:email   # send regardless
//
// Env: CLOUDFLARE_API_TOKEN, OUTREACH_KV_NAMESPACE_ID, STATUS_URL,
//      DIGEST_SECRET, optional FORCE_STATUS=1, optional DRY_RUN=1
import {
  buildSnapshot,
  describeChanges,
  parseSnapshot,
  serializeSnapshot,
  snapshotChanged,
} from '../src/lib/prospect/status';
import { parseLedger } from '../src/lib/prospect/ledger';
import { kvGet, kvPut } from './lib/kv';
import { requiredEnv } from './lib/ledger-io';

const LEDGER_KEY = 'outreach-ledger';
const SNAPSHOT_KEY = 'status-snapshot';

async function main() {
  const token = requiredEnv('CLOUDFLARE_API_TOKEN');
  const namespaceId = requiredEnv('OUTREACH_KV_NAMESPACE_ID');
  const force = process.env.FORCE_STATUS === '1';
  const dryRun = process.env.DRY_RUN === '1';

  const ledger = parseLedger(await kvGet(token, namespaceId, LEDGER_KEY));
  const previous = parseSnapshot(await kvGet(token, namespaceId, SNAPSHOT_KEY));
  const next = buildSnapshot(ledger);

  if (!force && !snapshotChanged(previous, next)) {
    console.log('No change since the last report. Skipping the email.');
    return;
  }

  const changes = describeChanges(previous, next);
  console.log(`Changes since last report (${changes.length}):`);
  for (const change of changes) {
    console.log(`  ${change}`);
  }

  if (dryRun) {
    console.log('\nDry run: nothing emailed, snapshot not saved.');
    return;
  }

  const statusUrl = requiredEnv('STATUS_URL');
  const secret = requiredEnv('DIGEST_SECRET');
  const res = await fetch(statusUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-digest-secret': secret },
    body: JSON.stringify({
      changes,
      stats: next.stats,
      dueDomains: next.dueDomains,
    }),
  });
  if (!res.ok) {
    // Leave the old snapshot in place so the next run retries rather than
    // treating an unsent week as reported.
    throw new Error(
      `Status send failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }

  await kvPut(token, namespaceId, SNAPSHOT_KEY, serializeSnapshot(next));
  console.log('\nStatus emailed and snapshot saved.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
