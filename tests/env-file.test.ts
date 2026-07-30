import { describe, expect, it } from 'vitest';
import { applyUnsetEnv, parseEnvFile } from '../src/lib/env-file';

describe('parseEnvFile', () => {
  it('parses keys, skips comments and blanks, and strips quotes', () => {
    const parsed = parseEnvFile(
      [
        '# a comment',
        '',
        'CLOUDFLARE_API_TOKEN=abc123',
        'export GOOGLE_PLACES_API_KEY="places-key"',
        "DIGEST_SECRET='secret value'",
        'NOT_A_LINE',
        '=novalue',
        '1BAD=nope',
        'OUTREACH_KV_NAMESPACE_ID= ns-id ',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      CLOUDFLARE_API_TOKEN: 'abc123',
      GOOGLE_PLACES_API_KEY: 'places-key',
      DIGEST_SECRET: 'secret value',
      OUTREACH_KV_NAMESPACE_ID: 'ns-id',
    });
  });
});

describe('applyUnsetEnv', () => {
  it('fills missing and empty keys without overriding set ones', () => {
    const env: Record<string, string | undefined> = {
      KEEP: 'already',
      EMPTY: '',
    };
    applyUnsetEnv(env, {
      KEEP: 'ignored',
      EMPTY: 'filled',
      NEW: 'added',
    });
    expect(env).toEqual({
      KEEP: 'already',
      EMPTY: 'filled',
      NEW: 'added',
    });
  });
});
