// Loads the repo-root `.env` into process.env once per process. Missing file
// is fine (CI and shells that already exported secrets). Never overrides a
// value that is already set.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyUnsetEnv, parseEnvFile } from '../../src/lib/env-file';

let loaded = false;

export function loadDotEnv(cwd: string = process.cwd()): void {
  if (loaded) {
    return;
  }
  loaded = true;
  const path = resolve(cwd, '.env');
  if (!existsSync(path)) {
    return;
  }
  applyUnsetEnv(process.env, parseEnvFile(readFileSync(path, 'utf8')));
}
