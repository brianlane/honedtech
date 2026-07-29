import { totalMonthlyWaste } from './findings';
import type { Finding, FindingCode } from './types';

export interface Prospect {
  business: string;
  domain: string;
  vertical?: string;
  city?: string;
  contactName?: string;
}

export interface ComposedEmail {
  subject: string;
  body: string;
}

const SENDER_NAME = 'Brian Lane';
// A cold email signed by a person should come from that person. leads@ reads
// like a marketing list and invites the reply nobody sends.
const SENDER_EMAIL = 'brian@honedtech.com';
const MAILING_ADDRESS = 'Honed Tech, Phoenix, AZ';
const SITE = 'https://honedtech.com';

// Maps a prospect vertical to its landing page slug. Falls back to the
// homepage when the vertical has no dedicated page.
export function verticalPath(vertical: string | undefined): string {
  if (!vertical) {
    return '/';
  }
  const slug = vertical
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `/audits/${slug}` : '/';
}

export function auditUrl(vertical: string | undefined): string {
  const path = verticalPath(vertical);
  const params = new URLSearchParams({
    utm_source: 'outreach',
    utm_medium: 'email',
    utm_campaign: 'prospector',
  });
  return `${SITE}${path}?${params.toString()}`;
}

export function bookingUrl(): string {
  return 'https://www.newcoworker.com/book/newcoworker/honed-tech';
}

// Detected findings map onto calculator options, so a prospect who is not
// ready to reply can open the calculator already showing their own numbers.
const FINDING_TO_CALC: Partial<Record<FindingCode, string>> = {
  ecommerce_platform_no_store: 'shopify_no_store',
  page_builder_site: 'wix',
  paid_email_hosting: 'email_1_3',
  ada_overlay_widget: 'ada_overlay',
};

// A finding's own option wins over the per-code default, since one code can
// cover several platforms at different prices.
export function calculatorSelection(findings: Finding[]): string[] {
  const ids: string[] = [];
  for (const finding of findings) {
    const id = finding.calcOptionId ?? FINDING_TO_CALC[finding.code];
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

// Returns '' when nothing we detected maps to a priced calculator option, so
// the email never links to an empty estimate.
export function calculatorUrl(findings: Finding[]): string {
  const selection = calculatorSelection(findings);
  if (selection.length === 0) {
    return '';
  }
  const params = new URLSearchParams({
    s: selection.join(','),
    utm_source: 'outreach',
    utm_medium: 'email',
    utm_campaign: 'prospector',
  });
  return `${SITE}/calculator?${params.toString()}`;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

function greeting(prospect: Prospect): string {
  return prospect.contactName ? `Hi ${prospect.contactName},` : 'Hi there,';
}

// Renders a plain-text cold email grounded in the findings. Deterministic;
// an optional AI polish step in the script can rewrite the body, but this is
// the always-available baseline and the thing we test.
export function composeEmail(
  prospect: Prospect,
  findings: Finding[],
): ComposedEmail {
  const top = findings.slice(0, 2);
  const monthly = totalMonthlyWaste(findings);

  const subject = monthly
    ? `${prospect.business}: about ${money(monthly)}/mo in likely tech waste`
    : `${prospect.business}: a couple of quick tech-stack notes`;

  const lines: string[] = [];
  lines.push(greeting(prospect));
  lines.push('');
  lines.push(
    `I run Honed Tech, a Phoenix tech-stack audit shop, and I took a quick look at ${prospect.domain} before reaching out.`,
  );
  lines.push('');

  if (top.length > 0) {
    lines.push('A couple of things stood out:');
    for (const f of top) {
      lines.push(`- ${f.headline}`);
    }
    lines.push('');
  }

  if (monthly > 0) {
    lines.push(
      `Rough math, that is around ${money(monthly)}/month you may be able to stop paying for without losing anything you actually use.`,
    );
    lines.push('');
  }

  lines.push(
    `A full audit is a flat ${money(299)}: I review every subscription, license, and tool, then hand you a written report with the exact savings and a fix plan. If I cannot find at least the audit fee in savings, I will tell you plainly.`,
  );
  lines.push('');
  lines.push(`Worth a quick look? Grab a time here: ${bookingUrl()}`);
  lines.push(`Details on the audit: ${auditUrl(prospect.vertical)}`);
  const calcUrl = calculatorUrl(findings);
  if (calcUrl) {
    lines.push('');
    lines.push(
      `Not ready to talk? Run your own numbers, no email required: ${calcUrl}`,
    );
  }
  lines.push('');
  lines.push('Best,');
  lines.push(`${SENDER_NAME}`);
  lines.push(`${SENDER_EMAIL}`);
  lines.push('');
  lines.push('---');
  lines.push(
    `${MAILING_ADDRESS}. You received this one-time note because your business has a public website. Reply "unsubscribe" and I will not contact you again.`,
  );

  return { subject, body: lines.join('\n') };
}
