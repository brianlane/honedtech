import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  NOTIFY_FROM,
  NOTIFY_TO,
  escapeHtml,
  guardInternalRequest,
} from '../../../lib/internal';

export const prerender = false;

// Internal endpoint: the scheduled prospector posts composed drafts here and
// the Worker emails them to the verified inbox for review. Guarded by a shared
// secret because it can send mail. It never emails prospects: the free email
// plan only delivers to verified destinations, and a human sends the drafts.

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

interface FollowUp {
  domain?: string;
  daysAgo?: number;
}

export const POST: APIRoute = async ({ request }) => {
  const rejection = guardInternalRequest(
    request,
    (env as { DIGEST_SECRET?: string }).DIGEST_SECRET,
    'Digest',
  );
  if (rejection) {
    return rejection;
  }

  let payload: { drafts?: Draft[]; followUps?: FollowUp[] };
  try {
    payload = (await request.json()) as {
      drafts?: Draft[];
      followUps?: FollowUp[];
    };
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const drafts = (payload.drafts ?? []).filter(
    (d): d is ValidDraft => Boolean(d && d.subject && d.body),
  );
  const followUps = (payload.followUps ?? []).filter(
    (f): f is FollowUp & { domain: string } => Boolean(f && f.domain),
  );
  // A morning with no new prospects can still owe follow-ups, so only bail
  // when there is genuinely nothing to tell you.
  if (drafts.length === 0 && followUps.length === 0) {
    return new Response('Nothing to send', { status: 400 });
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

  const followUpText = followUps.length
    ? [
        '',
        `=== Follow-ups due (${followUps.length}) ===`,
        'One nudge each, then stop. Mark it with: npm run prospect:followup -- <domain>',
        ...followUps.map(
          (f) => `- ${f.domain}${f.daysAgo ? ` (contacted ${f.daysAgo} days ago)` : ''}`,
        ),
        '',
      ].join('\n')
    : '';

  const followUpHtml = followUps.length
    ? `<h2>Follow-ups due (${followUps.length})</h2><p>One nudge each, then stop. Mark it with <code>npm run prospect:followup -- &lt;domain&gt;</code>.</p><ul>${followUps
        .map(
          (f) =>
            `<li>${escapeHtml(f.domain)}${
              f.daysAgo ? ` (contacted ${f.daysAgo} days ago)` : ''
            }</li>`,
        )
        .join('')}</ul>`
    : '';

  const intro = drafts.length
    ? `${drafts.length} outreach draft(s) ready for review. Send from Gmail using send-as leads@honedtech.com, then log the domains so they are not contacted again.`
    : 'No new drafts this morning, but you have follow-ups due.';

  const subject = drafts.length
    ? `Outreach digest: ${drafts.length} draft(s) ready` +
      (followUps.length ? `, ${followUps.length} follow-up(s) due` : '')
    : `Outreach digest: ${followUps.length} follow-up(s) due`;

  try {
    await env.EMAIL.send({
      to: NOTIFY_TO,
      from: NOTIFY_FROM,
      subject,
      text: `${intro}\n${followUpText}\n${textParts.join('\n')}`,
      html: `<p>${escapeHtml(intro)}</p>${followUpHtml}${htmlParts.join('')}`,
    });
  } catch (error) {
    console.error('Digest email failed:', error);
    return new Response('Failed to send digest', { status: 500 });
  }

  return new Response(
    JSON.stringify({ sent: drafts.length, followUps: followUps.length }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
