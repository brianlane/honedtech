import { ENTERPRISE_AUDIT_PRICE_USD } from './seats';
import { accountScore, primarySignal, totalMonthlyReclaim } from './score';
import type { EnterpriseAccount } from './types';

// Composes the two things a human needs to act: the draft email itself, and a
// research brief that never leaves our inbox. Keeping them separate matters,
// because the brief cites WARN filings and job postings by URL and pasting
// that into a cold email reads like surveillance rather than homework.

const SENDER_NAME = 'Brian Lane';
const SENDER_EMAIL = 'brian@honedtech.com';
const MAILING_ADDRESS = 'Honed Tech, Phoenix, AZ';
const SITE = 'https://honedtech.com';

export interface ComposedBrief {
  subject: string;
  body: string;
  brief: string[];
}

export function enterpriseUrl(): string {
  const params = new URLSearchParams({
    utm_source: 'outreach',
    utm_medium: 'email',
    utm_campaign: 'enterprise',
  });
  return `${SITE}/enterprise?${params.toString()}`;
}

export function bookingUrl(): string {
  return 'https://www.newcoworker.com/book/newcoworker/honed-tech';
}

// Deep-links the seat-reclaim estimate with the numbers we already inferred,
// so a reader who is not ready to reply still lands on their own figures.
// Returns '' when we have no seat count worth showing.
export function reclaimUrl(seats: number): string {
  if (seats <= 0) {
    return '';
  }
  const params = new URLSearchParams({
    r: `${Math.trunc(seats)}|0|email_suite,comms,crm`,
    utm_source: 'outreach',
    utm_medium: 'email',
    utm_campaign: 'enterprise',
  });
  return `${SITE}/enterprise?${params.toString()}`;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// Everything a human needs to decide whether to send, and to find the right
// person before they do. Contact discovery stays manual on purpose: free
// signals cannot produce a verified executive address, and guessing patterns
// burns the sending domain.
export function buildBrief(account: EnterpriseAccount): string[] {
  const lines: string[] = [];
  const where = [account.city, account.state].filter(Boolean).join(', ');
  lines.push(`${account.company} (${account.domain}${where ? `, ${where}` : ''})`);
  lines.push(`Score ${accountScore(account)}, ${account.signals.length} signal(s)`);
  for (const signal of account.signals) {
    const dollars =
      signal.monthlyReclaimUsd > 0
        ? ` [${money(signal.monthlyReclaimUsd)}/mo]`
        : '';
    lines.push(`${signal.kind}${dollars}: ${signal.evidence ?? signal.headline}`);
  }
  lines.push(
    'Find the CFO, COO, or VP of IT on LinkedIn before sending. Do not send to a general inbox.',
  );
  return lines;
}

// The draft itself. Deterministic, and the thing we test; the optional AI
// polish step in the pipeline may rewrite tone but never the facts.
export function composeEnterpriseEmail(
  account: EnterpriseAccount,
): ComposedBrief {
  const lead = primarySignal(account.signals);
  const monthly = totalMonthlyReclaim(account.signals);
  const seats = estimateSeats(account);

  const subject = monthly
    ? `${account.company}: about ${money(monthly)}/mo in seats that may still be billing`
    : `${account.company}: a note on your software stack`;

  const lines: string[] = [];
  lines.push('Hi there,');
  lines.push('');
  lines.push(
    `I run Honed Tech, a Phoenix firm that audits software spend, and something about ${account.company} showed up in public filings worth two minutes of your time.`,
  );
  lines.push('');

  if (lead) {
    lines.push(lead.headline);
    lines.push('');
  }

  const supporting = account.signals.filter((s) => s !== lead).slice(0, 2);
  if (supporting.length > 0) {
    lines.push('Also worth a look:');
    for (const s of supporting) {
      lines.push(`- ${s.headline}`);
    }
    lines.push('');
  }

  if (monthly > 0) {
    lines.push(
      `Conservatively that is around ${money(
        monthly,
      )} a month, and I have deliberately estimated low. The real figure usually sits above it once contracts and tiers are opened up.`,
    );
    lines.push('');
  }

  lines.push(
    `An Enterprise audit is a flat ${money(
      ENTERPRISE_AUDIT_PRICE_USD,
    )}: seat-by-seat license utilization, duplicate tooling, and an executive report with the exact savings. If I cannot find the fee back in recoverable spend, I will say so plainly.`,
  );
  lines.push('');
  lines.push(`Worth a short call? Grab a time here: ${bookingUrl()}`);
  lines.push(`Details on the audit: ${enterpriseUrl()}`);

  const calc = reclaimUrl(seats);
  if (calc) {
    lines.push('');
    lines.push(`Prefer to run the numbers yourself first? ${calc}`);
  }

  lines.push('');
  lines.push('Best,');
  lines.push(SENDER_NAME);
  lines.push(SENDER_EMAIL);
  lines.push('');
  lines.push('---');
  lines.push(
    `${MAILING_ADDRESS}. You received this one-time note because your company appears in public records. Reply "unsubscribe" and I will not contact you again.`,
  );

  return { subject, body: lines.join('\n'), brief: buildBrief(account) };
}

// Recovers the headcount behind a layoff signal from its evidence string, so
// the calculator deep link opens on their actual number. Returns 0 when the
// account has no layoff signal to read.
export function estimateSeats(account: EnterpriseAccount): number {
  for (const signal of account.signals) {
    if (signal.kind !== 'layoff') {
      continue;
    }
    const match = /(\d+) affected/.exec(signal.evidence ?? '');
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return 0;
}
