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
import { kvDelete, kvGet, kvPut } from './lib/kv';
import { readLedgerStrict, requiredEnv } from './lib/ledger-io';

const LEDGER_KEY = 'outreach-ledger';
const SNAPSHOT_KEY = 'status-snapshot';

// Puts the snapshot back the way it was after a send that did not land, so
// the next run still sees a change and retries. Best effort by definition: if
// this fails too, the report is skipped rather than duplicated, which is the
// direction we would choose anyway.
async function restoreSnapshot(
  token: string,
  namespaceId: string,
  previousRaw: string,
): Promise<void> {
  try {
    if (previousRaw.trim()) {
      await kvPut(token, namespaceId, SNAPSHOT_KEY, previousRaw);
    } else {
      // No snapshot existed before this run, so removing ours restores that.
      await kvDelete(token, namespaceId, SNAPSHOT_KEY);
    }
  } catch (err) {
    console.error(
      `Could not roll back the snapshot, so this report may be skipped next run: ${
        (err as Error).message
      }`,
    );
  }
}

async function main() {
  const token = requiredEnv('CLOUDFLARE_API_TOKEN');
  const namespaceId = requiredEnv('OUTREACH_KV_NAMESPACE_ID');
  const force = process.env.FORCE_STATUS === '1';
  const dryRun = process.env.DRY_RUN === '1';

  // Strict, because a report built from a ledger that failed to parse would
  // read as "nothing has happened" rather than as the problem it is.
  const ledger = await readLedgerStrict(token, namespaceId, LEDGER_KEY);
  // Kept in raw form as well, because rolling back a failed send has to write
  // exactly what was there before.
  const previousRaw = await kvGet(token, namespaceId, SNAPSHOT_KEY);
  const previous = parseSnapshot(previousRaw);
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

  // Recorded BEFORE sending. The other order can email and then fail to save,
  // which leaves the next run looking at a stale snapshot and mailing the
  // identical report a week later. Recording first means a failed save sends
  // nothing at all, and a failed send is undone below, so the worst case is a
  // retry rather than a duplicate.
  await kvPut(token, namespaceId, SNAPSHOT_KEY, serializeSnapshot(next));

  let res: Response;
  try {
    res = await fetch(statusUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-digest-secret': secret },
      body: JSON.stringify({
        changes,
        stats: next.stats,
        dueDomains: next.dueDomains,
      }),
    });
  } catch (err) {
    await restoreSnapshot(token, namespaceId, previousRaw);
    throw err;
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    await restoreSnapshot(token, namespaceId, previousRaw);
    throw new Error(`Status send failed (${res.status}): ${body}`);
  }

  console.log('\nStatus emailed and snapshot saved.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
