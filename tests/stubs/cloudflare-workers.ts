// Test stand-in for the workerd-only `cloudflare:workers` module
// (aliased in vitest.config.ts). Tests mutate this object per case.
export const env: {
  EMAIL: { send: (message: unknown) => Promise<void> };
  TURNSTILE_SECRET_KEY?: string;
} = {
  EMAIL: { send: async () => {} },
};
