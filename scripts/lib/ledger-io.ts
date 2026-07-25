// Shared load/save for the outreach ledger, so every command talks to the
// same KV key and fails the same way when config is missing.
import { parseLedger, serializeLedger, type OutreachLedger } from '../../src/lib/prospect/ledger';
import { kvGet, kvPut } from './kv';

const LEDGER_KEY = 'outreach-ledger';

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

export async function loadLedger(): Promise<LedgerHandle> {
  const token = requiredEnv('CLOUDFLARE_API_TOKEN');
  const namespaceId = requiredEnv('OUTREACH_KV_NAMESPACE_ID');
  const ledger = parseLedger(await kvGet(token, namespaceId, LEDGER_KEY));
  return {
    ledger,
    save: (next) => kvPut(token, namespaceId, LEDGER_KEY, serializeLedger(next)),
  };
}
