// Parses a dotenv-style file into key/value pairs. Used by local CLI scripts
// so `npm run prospect:sent` (and friends) pick up CLOUDFLARE_API_TOKEN from
// `.env` without requiring the shell to export it first. CI already injects
// secrets into the environment, so applyUnsetEnv never overwrites a set key.

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Copies parsed values into env only when the key is currently unset or empty.
export function applyUnsetEnv(
  env: Record<string, string | undefined>,
  values: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(values)) {
    const current = env[key];
    if (current === undefined || current === '') {
      env[key] = value;
    }
  }
}
