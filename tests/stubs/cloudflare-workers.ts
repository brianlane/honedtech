// Test stand-in for the workerd-only `cloudflare:workers` module
// (aliased in vitest.config.ts). Tests mutate this object per case.

// Minimal in-memory KV matching the subset of KVNamespace the endpoints use.
export class MemoryKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export const env: {
  EMAIL: { send: (message: unknown) => Promise<void> };
  SUBSCRIBERS: MemoryKV;
  TURNSTILE_SECRET_KEY?: string;
} = {
  EMAIL: { send: async () => {} },
  SUBSCRIBERS: new MemoryKV(),
};
