import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The workerd-only module is stubbed so the contact endpoint can be
      // unit-tested in Node. Tests mutate the stub's env directly.
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Coverage scope is gated at 100% for everything in this list
      // (see AGENTS.md). Grow the list, never shrink the threshold.
      include: [
        'src/pages/api/**/*.ts',
        'src/lib/prospect/**/*.ts',
        'src/lib/calculator.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
