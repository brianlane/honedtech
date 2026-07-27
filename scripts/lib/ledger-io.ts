// Shared load/save for the outreach ledger, so every command talks to the
// same KV key and fails the same way when config is missing.
import {
  mergeLedgers,
  parseLedger,
  serializeLedger,
  type OutreachLedger,
} from '../../src/lib/prospect/ledger';
import { kvGet, kvPut } from './kv';

export const LEDGER_KEY = 'outreach-ledger';

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set (see .env).`);
    process.exit(1);
  }
  return value;
}

export interface LedgerHandle {
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
export async function saveLedgerMerged(
  token: string,
  namespaceId: string,
  key: string,
  next: OutreachLedger,
): Promise<void> {
  const current = parseLedger(await kvGet(token, namespaceId, key));
  const merged = mergeLedgers(current, next);
  await kvPut(token, namespaceId, key, serializeLedger(merged));
}

export async function loadLedger(): Promise<LedgerHandle> {
  const token = requiredEnv('CLOUDFLARE_API_TOKEN');
  const namespaceId = requiredEnv('OUTREACH_KV_NAMESPACE_ID');
  const ledger = parseLedger(await kvGet(token, namespaceId, LEDGER_KEY));
  return {
    ledger,
    save: (next) => saveLedgerMerged(token, namespaceId, LEDGER_KEY, next),
  };
}
