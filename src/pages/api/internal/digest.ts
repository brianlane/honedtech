import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Internal endpoint: the scheduled prospector posts composed drafts here and
// the Worker emails them to the verified inbox for review. Guarded by a shared
// secret because it can send mail. It never emails prospects: the free email
// plan only delivers to verified destinations, and a human sends the drafts.
const DIGEST_TO = 'brianlane2@gmail.com';
const DIGEST_FROM = { email: 'leads@honedtech.com', name: 'Honed Tech Prospector' };

interface Draft {
  business?: string;
  domain?: string;
  to?: string;
  subject?: string;
  body?: string;
  findingCount?: number;
}

// A draft that survived validation: subject and body are guaranteed present.
type ValidDraft = Draft & { subject: string; body: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Constant-time-ish comparison so the secret cannot be probed byte by byte.
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export const POST: APIRoute = async ({ request }) => {
  const expected = (env as { DIGEST_SECRET?: string }).DIGEST_SECRET;
  if (!expected) {
    return new Response('Digest endpoint is not configured', { status: 503 });
  }

  const provided = request.headers.get('x-digest-secret') ?? '';
  if (!secretMatches(provided, expected)) {
    return new Response('Forbidden', { status: 403 });
  }

  let payload: { drafts?: Draft[] };
  try {
    payload = (await request.json()) as { drafts?: Draft[] };
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const drafts = (payload.drafts ?? []).filter(
    (d): d is ValidDraft => Boolean(d && d.subject && d.body),
  );
  if (drafts.length === 0) {
    return new Response('No drafts to send', { status: 400 });
  }

  const textParts = drafts.map((d, i) => {
    const to = d.to || 'NO EMAIL FOUND, look up manually';
    return [
      `--- Draft ${i + 1} of ${drafts.length}: ${d.business ?? d.domain ?? 'unknown'} ---`,
      `Domain: ${d.domain ?? 'unknown'}`,
      `To: ${to}`,
      `Subject: ${d.subject}`,
      '',
      d.body,
      '',
    ].join('\n');
  });

  const htmlParts = drafts.map((d, i) => {
    const to = d.to || 'NO EMAIL FOUND, look up manually';
    return `<h3>Draft ${i + 1} of ${drafts.length}: ${escapeHtml(
      d.business ?? d.domain ?? 'unknown',
    )}</h3><p><strong>To:</strong> ${escapeHtml(to)}<br><strong>Subject:</strong> ${escapeHtml(
      d.subject,
    )}</p><pre style="white-space:pre-wrap;font-family:inherit;background:#f4f6f8;padding:12px;border-radius:6px">${escapeHtml(
      d.body,
    )}</pre>`;
  });

  const intro = `${drafts.length} outreach draft(s) ready for review. Send from Gmail using send-as leads@honedtech.com, then log the domains so they are not contacted again.`;

  try {
    await env.EMAIL.send({
      to: DIGEST_TO,
      from: DIGEST_FROM,
      subject: `Outreach digest: ${drafts.length} draft(s) ready`,
      text: `${intro}\n\n${textParts.join('\n')}`,
      html: `<p>${escapeHtml(intro)}</p>${htmlParts.join('')}`,
    });
  } catch (error) {
    console.error('Digest email failed:', error);
    return new Response('Failed to send digest', { status: 500 });
  }

  return new Response(JSON.stringify({ sent: drafts.length }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
