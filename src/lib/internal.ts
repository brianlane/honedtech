// Shared helpers for the secret-guarded internal endpoints, so the auth check
// and escaping exist once rather than being copied per endpoint.

// Where every internal notification goes. Must stay a verified Email Routing
// destination: the free plan will not deliver anywhere else. This is the
// brand mailbox, which is also where outreach is sent from, so drafts and the
// replies they produce stay in one place.
export const NOTIFY_TO = 'honedtechcontact@gmail.com';
export const NOTIFY_FROM = {
  email: 'leads@honedtech.com',
  name: 'Honed Tech Prospector',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Constant-time-ish comparison so the secret cannot be probed byte by byte.
export function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// Returns a Response when the caller should be rejected, or null to proceed.
export function guardInternalRequest(
  request: Request,
  expected: string | undefined,
  label: string,
): Response | null {
  if (!expected) {
    return new Response(`${label} endpoint is not configured`, { status: 503 });
  }
  if (!secretMatches(request.headers.get('x-digest-secret') ?? '', expected)) {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}
