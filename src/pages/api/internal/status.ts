import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  NOTIFY_FROM,
  NOTIFY_TO,
  escapeHtml,
  guardInternalRequest,
} from '../../../lib/internal';

export const prerender = false;

// Internal endpoint: the weekly status job posts a summary here only when
// something changed since the previous week, and the Worker emails it. The
// runner decides whether to call at all; this just renders and sends.

interface StatusPayload {
  changes?: string[];
  stats?: Record<string, number>;
  dueDomains?: string[];
}

const STAT_LABELS: Record<string, string> = {
  discovered: 'Discovered',
  contacted: 'Contacted',
  emailed: 'Addresses emailed',
  awaitingReply: 'Awaiting reply',
  replied: 'Replied',
  booked: 'Booked',
  declined: 'Declined',
  bounced: 'Bounced',
  optedOut: 'Opted out',
  replyRate: 'Reply rate',
};

export const POST: APIRoute = async ({ request }) => {
  const rejection = guardInternalRequest(
    request,
    (env as { DIGEST_SECRET?: string }).DIGEST_SECRET,
    'Status',
  );
  if (rejection) {
    return rejection;
  }

  let payload: StatusPayload;
  try {
    payload = (await request.json()) as StatusPayload;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const changes = (payload.changes ?? []).filter((c) => typeof c === 'string');
  const stats = payload.stats ?? {};
  const dueDomains = (payload.dueDomains ?? []).filter(
    (d) => typeof d === 'string',
  );
  if (changes.length === 0 && Object.keys(stats).length === 0) {
    return new Response('Nothing to report', { status: 400 });
  }

  const statLines = Object.entries(stats).map(([key, value]) => {
    const label = STAT_LABELS[key] ?? key;
    return `${label}: ${value}${key === 'replyRate' ? '%' : ''}`;
  });

  const text = [
    'What changed this week:',
    ...changes.map((c) => `- ${c}`),
    '',
    'Current totals:',
    ...statLines.map((l) => `- ${l}`),
    ...(dueDomains.length
      ? ['', `Follow-ups due (${dueDomains.length}):`, ...dueDomains.map((d) => `- ${d}`)]
      : ['', 'No follow-ups due.']),
    '',
    'This email only arrives when something moved since last week.',
  ].join('\n');

  const html = [
    '<h2>What changed this week</h2><ul>',
    ...changes.map((c) => `<li>${escapeHtml(c)}</li>`),
    '</ul><h3>Current totals</h3><ul>',
    ...statLines.map((l) => `<li>${escapeHtml(l)}</li>`),
    '</ul>',
    dueDomains.length
      ? `<h3>Follow-ups due (${dueDomains.length})</h3><ul>${dueDomains
          .map((d) => `<li>${escapeHtml(d)}</li>`)
          .join('')}</ul>`
      : '<p>No follow-ups due.</p>',
    '<p style="color:#6b8199;font-size:13px">This email only arrives when something moved since last week.</p>',
  ].join('');

  try {
    await env.EMAIL.send({
      to: NOTIFY_TO,
      from: NOTIFY_FROM,
      subject: `Outreach weekly status: ${changes.length} change(s)`,
      text,
      html,
    });
  } catch (error) {
    console.error('Status email failed:', error);
    return new Response('Failed to send status', { status: 500 });
  }

  return new Response(JSON.stringify({ sent: true, changes: changes.length }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
