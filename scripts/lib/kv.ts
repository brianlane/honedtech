// Cloudflare KV access over the REST API, used by the scheduled pipeline to
// keep the outreach ledger between ephemeral runs. The Worker itself uses its
// native binding; only these out-of-band scripts need REST.
const ACCOUNT_ID = 'a5cf6e879c42087de72a0ea6fb2dc0af';

function base(namespaceId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}`;
}

export async function kvGet(
  token: string,
  namespaceId: string,
  key: string,
): Promise<string> {
  const res = await fetch(`${base(namespaceId)}/values/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // A missing key is normal on the first run.
  if (res.status === 404) {
    return '';
  }
  if (!res.ok) {
    throw new Error(`KV get failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return res.text();
}

// Used to undo a speculative write. A missing key is already the desired
// end state, so a 404 counts as success.
export async function kvDelete(
  token: string,
  namespaceId: string,
  key: string,
): Promise<void> {
  const res = await fetch(`${base(namespaceId)}/values/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `KV delete failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
}

export async function kvPut(
  token: string,
  namespaceId: string,
  key: string,
  value: string,
): Promise<void> {
  // An empty write is never intentional and silently destroys the ledger, so
  // refuse it rather than persisting the result of some upstream failure.
  if (!value.trim()) {
    throw new Error(`Refusing to write an empty value to KV key "${key}"`);
  }

  // The values endpoint expects multipart form data.
  const form = new FormData();
  form.set('value', value);
  form.set('metadata', '{}');
  const res = await fetch(`${base(namespaceId)}/values/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`KV put failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}
