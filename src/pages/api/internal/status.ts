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
  byVertical?: unknown[];
}

interface VerticalRow {
  vertical: string;
  drafted: number;
  sent: number;
  replied: number;
  booked: number;
}

function isVerticalRow(value: unknown): value is VerticalRow {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Partial<VerticalRow>;
  return (
    typeof row.vertical === 'string' &&
    typeof row.drafted === 'number' &&
    typeof row.sent === 'number' &&
    typeof row.replied === 'number' &&
    typeof row.booked === 'number'
  );
}

// Drafted and sent are named apart because they are different events: the
// pipeline drafts, a human sends. Collapsing them into one "Contacted" line is
// what let a pile of unsent drafts read as prospects who had heard from us.
const STAT_LABELS: Record<string, string> = {
  discovered: 'Discovered',
  drafted: 'Drafted (in your review inbox)',
  sent: 'Sent by hand from Gmail',
  pendingDrafts: 'Drafts pending your send',
  skipped: 'Skipped',
  emailed: 'Addresses in drafts',
  awaitingReply: 'Awaiting reply',
  replied: 'Replied',
  booked: 'Booked',
  declined: 'Declined',
  bounced: 'Bounced',
  optedOut: 'Opted out',
  replyRate: 'Reply rate (of sent)',
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
  const byVertical = (payload.byVertical ?? []).filter(isVerticalRow);
  if (changes.length === 0 && Object.keys(stats).length === 0) {
    return new Response('Nothing to report', { status: 400 });
  }

  const statLines = Object.entries(stats).map(([key, value]) => {
    const label = STAT_LABELS[key] ?? key;
    return `${label}: ${value}${key === 'replyRate' ? '%' : ''}`;
  });

  const verticalLines = byVertical.map(
    (v) =>
      `${v.vertical}: ${v.drafted} drafted, ${v.sent} sent, ` +
      `${v.replied} replied, ${v.booked} booked`,
  );

  // Said outright rather than left to be inferred from a counter, because a
  // pile of drafts nobody has sent is the one state where every other number
  // in this email looks like progress and none of it has reached a prospect.
  const pending = typeof stats.pendingDrafts === 'number' ? stats.pendingDrafts : 0;
  const pendingNote =
    pending > 0
      ? `${pending} draft(s) are still waiting in your digest emails. Nothing reaches a ` +
        'prospect until you send it from Gmail, then log it with npm run prospect:sent.'
      : '';

  // Only reachable on a forced send, since the runner stays silent when there
  // is nothing to report. Better than a heading with nothing under it.
  const changeLines = changes.length
    ? changes
    : ['Nothing moved since the last report.'];

  const text = [
    'What changed this week:',
    ...changeLines.map((c) => `- ${c}`),
    ...(pendingNote ? ['', pendingNote] : []),
    '',
    'Current totals:',
    ...statLines.map((l) => `- ${l}`),
    ...(verticalLines.length
      ? ['', 'By vertical:', ...verticalLines.map((l) => `- ${l}`)]
      : []),
    ...(dueDomains.length
      ? ['', `Follow-ups due (${dueDomains.length}):`, ...dueDomains.map((d) => `- ${d}`)]
      : ['', 'No follow-ups due.']),
    '',
    'This email only arrives when something moved since last week.',
  ].join('\n');

  const html = [
    '<h2>What changed this week</h2><ul>',
    ...changeLines.map((c) => `<li>${escapeHtml(c)}</li>`),
    '</ul>',
    pendingNote ? `<p><strong>${escapeHtml(pendingNote)}</strong></p>` : '',
    '<h3>Current totals</h3><ul>',
    ...statLines.map((l) => `<li>${escapeHtml(l)}</li>`),
    '</ul>',
    verticalLines.length
      ? `<h3>By vertical</h3><ul>${verticalLines
          .map((l) => `<li>${escapeHtml(l)}</li>`)
          .join('')}</ul>`
      : '',
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
