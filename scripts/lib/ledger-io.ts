// Shared load/save for the outreach ledger, so every command talks to the
// same KV key and fails the same way when config is missing.
import {
  ledgerTracksDomain,
  mergeLedgers,
  normalizeDomain,
  parseLedgerResult,
  serializeLedger,
  type OutreachLedger,
} from '../../src/lib/prospect/ledger';
import { kvGet, kvPut } from './kv';
import { loadDotEnv } from './load-env';

export const LEDGER_KEY = 'outreach-ledger';
export const ENTERPRISE_LEDGER_KEY = 'enterprise-ledger';

export function requiredEnv(name: string): string {
  loadDotEnv();
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set (see .env).`);
    process.exit(1);
  }
  return value;
}

export interface LedgerHandle {
  key: string;
  ledger: OutreachLedger;
  save: (next: OutreachLedger) => Promise<void>;
}

// Writes a ledger back, merging against whatever is in KV at that moment.
//
// KV has no compare-and-swap, so the scheduled pipeline and the hand-run
// commands can interleave. Re-reading immediately before the write and
// merging means a concurrent writer's opt-out or contact record survives
// instead of being overwritten by our older snapshot. It does not make the
// write atomic, but it shrinks the losing window to the read-merge-write
// itself and every field converges rather than clobbering.
// Reads the ledger, refusing to carry on when the stored value exists but
// does not parse.
//
// Treating a corrupt read as an empty ledger is the dangerous default here.
// On the way in it makes every domain look uncontacted, which queues outreach
// to people already emailed or opted out. On the way out it merges an empty
// ledger over a real one and writes the result, discarding every suppression
// KV still held. An aborted run is cheap; either of those is not.
export async function readLedgerStrict(
  token: string,
  namespaceId: string,
  key: string,
): Promise<OutreachLedger> {
  const { ledger, corrupt } = parseLedgerResult(await kvGet(token, namespaceId, key));
  if (corrupt) {
    throw new Error(
      `Refusing to continue: KV key "${key}" holds a value that is not valid ledger JSON. ` +
        'Treating it as empty would drop every contacted domain and opt-out it should contain. ' +
        'Inspect the key and restore it before rerunning.',
    );
  }
  return ledger;
}

export async function saveLedgerMerged(
  token: string,
  namespaceId: string,
  key: string,
  next: OutreachLedger,
): Promise<void> {
  const current = await readLedgerStrict(token, namespaceId, key);
  const merged = mergeLedgers(current, next);
  await kvPut(token, namespaceId, key, serializeLedger(merged));
}

export async function loadLedger(key: string = LEDGER_KEY): Promise<LedgerHandle> {
  const token = requiredEnv('CLOUDFLARE_API_TOKEN');
  const namespaceId = requiredEnv('OUTREACH_KV_NAMESPACE_ID');
  const ledger = await readLedgerStrict(token, namespaceId, key);
  return {
    key,
    ledger,
    save: (next) => saveLedgerMerged(token, namespaceId, key, next),
  };
}

export interface LedgerBatch {
  key: string;
  domains: string[];
  handle: LedgerHandle;
}

// Splits domains across enterprise-ledger and outreach-ledger so a mixed
// batch never writes SMB marks into the enterprise key (or the reverse).
export async function loadLedgerBatches(domains: string[]): Promise<LedgerBatch[]> {
  const token = requiredEnv('CLOUDFLARE_API_TOKEN');
  const namespaceId = requiredEnv('OUTREACH_KV_NAMESPACE_ID');
  const bare = [...new Set(domains.map(normalizeDomain).filter((d) => d.length > 0))];

  const enterprise = await readLedgerStrict(token, namespaceId, ENTERPRISE_LEDGER_KEY);
  const enterpriseDomains: string[] = [];
  const outreachDomains: string[] = [];
  for (const domain of bare) {
    if (ledgerTracksDomain(enterprise, domain)) {
      enterpriseDomains.push(domain);
    } else {
      outreachDomains.push(domain);
    }
  }

  const batches: LedgerBatch[] = [];
  if (enterpriseDomains.length > 0) {
    batches.push({
      key: ENTERPRISE_LEDGER_KEY,
      domains: enterpriseDomains,
      handle: {
        key: ENTERPRISE_LEDGER_KEY,
        ledger: enterprise,
        save: (next) => saveLedgerMerged(token, namespaceId, ENTERPRISE_LEDGER_KEY, next),
      },
    });
  }
  if (outreachDomains.length > 0) {
    batches.push({
      key: LEDGER_KEY,
      domains: outreachDomains,
      handle: await loadLedger(LEDGER_KEY),
    });
  }
  return batches;
}
