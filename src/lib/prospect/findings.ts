import {
  detectEmailProvider,
  detectPlatform,
  detectWidgetVendors,
  hasAccessibilityOverlay,
  hasNoStorefront,
  latestCopyrightYear,
  missingEmailAuth,
} from './detect';
import type { DomainProbe, Finding, Platform } from './types';

// Conservative, defensible monthly figures. We would rather under-claim in a
// cold email than be accused of inflating the number.
const WASTE = {
  shopifyNoStore: 39, // Shopify Basic
  pageBuilder: 23, // typical Wix/Squarespace/GoDaddy plan
  paidEmailPerMailbox: 7, // Google Workspace / M365 entry tier, per mailbox
  accessibilityOverlay: 49, // entry plan at the major overlay vendors
};

const PAGE_BUILDERS: Platform[] = ['wix', 'squarespace', 'godaddy', 'weebly'];

// Calculator option per builder. Weebly has no option of its own, so it
// borrows Wix, the closest published price.
const PLATFORM_CALC_OPTION: Partial<Record<Platform, string>> = {
  wix: 'wix',
  squarespace: 'squarespace',
  godaddy: 'godaddy',
  weebly: 'wix',
};

const PLATFORM_LABEL: Record<Platform, string> = {
  shopify: 'Shopify',
  wix: 'Wix',
  squarespace: 'Squarespace',
  godaddy: 'GoDaddy Website Builder',
  weebly: 'Weebly',
  webflow: 'Webflow',
  wordpress: 'WordPress',
  unknown: 'your current platform',
};

const HEAVY_BYTES = 2_000_000;
const HEAVY_REQUESTS = 75;

// How far behind the copyright year has to fall before the site reads as
// abandoned. One year is noise in January; two is a pattern.
const STALE_YEARS = 2;

// Joins vendor names for prose. Only ever called with two or more.
function andList(items: string[]): string {
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Turns a raw probe into an ordered list of prospect-facing findings. Pure
// and deterministic: identical input and clock always yield identical output.
// `now` is injectable so the staleness check is testable.
export function buildFindings(probe: DomainProbe, now: Date = new Date()): Finding[] {
  const findings: Finding[] = [];
  const platform = detectPlatform(probe);

  if (platform === 'shopify' && hasNoStorefront(probe)) {
    findings.push({
      code: 'ecommerce_platform_no_store',
      headline:
        'You appear to be on a paid Shopify plan, but the site shows no online store, no cart, and no products.',
      monthlyWasteUsd: WASTE.shopifyNoStore,
      severity: 100,
    });
  }

  if (PAGE_BUILDERS.includes(platform)) {
    findings.push({
      code: 'page_builder_site',
      headline: `Your site runs on ${PLATFORM_LABEL[platform]}, a monthly page-builder subscription that a lean static site replaces at a fraction of the cost.`,
      monthlyWasteUsd: WASTE.pageBuilder,
      severity: 70,
      // Priced as the platform we actually detected. Sending a Squarespace
      // owner to a calculator showing Wix undercuts the one thing the email
      // has going for it, which is that we looked.
      calcOptionId: PLATFORM_CALC_OPTION[platform],
    });
  }

  const emailProvider = detectEmailProvider(probe);
  if (emailProvider === 'google' || emailProvider === 'microsoft') {
    const label =
      emailProvider === 'google' ? 'Google Workspace' : 'Microsoft 365';
    findings.push({
      code: 'paid_email_hosting',
      headline: `Your email is on ${label}. If you use it mainly to send and receive mail, free email routing on your own domain often covers the same need.`,
      monthlyWasteUsd: WASTE.paidEmailPerMailbox,
      severity: 60,
    });
  }

  if (hasAccessibilityOverlay(probe)) {
    findings.push({
      code: 'ada_overlay_widget',
      headline:
        'Your site runs an accessibility overlay widget. It bills every month, it does not fix the underlying code, and the FTC fined the largest vendor $1M in 2025 over exactly that claim.',
      monthlyWasteUsd: WASTE.accessibilityOverlay,
      severity: 80,
    });
  }

  const copyrightYear = latestCopyrightYear(probe);
  if (copyrightYear !== null && now.getFullYear() - copyrightYear >= STALE_YEARS) {
    findings.push({
      code: 'stale_site',
      headline: `Your site still shows a copyright year of ${copyrightYear}, which tells visitors nobody is minding it and raises the question of what any maintenance retainer is buying.`,
      monthlyWasteUsd: 0,
      severity: 50,
    });
  }

  const widgets = detectWidgetVendors(probe);
  if (widgets.length >= 2) {
    findings.push({
      code: 'widget_overlap',
      headline: `You are running ${andList(widgets)} on the same site. Each carries its own subscription, and one of them usually covers what the others do.`,
      monthlyWasteUsd: 0,
      severity: 45,
    });
  }

  if (missingEmailAuth(probe)) {
    findings.push({
      code: 'missing_email_auth',
      headline:
        'Your domain publishes no SPF or DMARC records, so your email is more likely to land in spam and easier to spoof.',
      monthlyWasteUsd: 0,
      severity: 40,
    });
  }

  const heavy =
    (probe.htmlBytes ?? 0) > HEAVY_BYTES ||
    (probe.requestCount ?? 0) > HEAVY_REQUESTS;
  if (heavy) {
    findings.push({
      code: 'heavy_page',
      headline:
        'Your homepage is heavy enough to slow down load times, which costs you visitors and search ranking.',
      monthlyWasteUsd: 0,
      severity: 30,
    });
  }

  if (probe.redirectedToHttps === false) {
    findings.push({
      code: 'no_https_redirect',
      headline:
        'Your site does not force HTTPS, which browsers flag as "not secure" to visitors.',
      monthlyWasteUsd: 0,
      severity: 20,
    });
  }

  return findings.sort((a, b) => b.severity - a.severity);
}

export function totalMonthlyWaste(findings: Finding[]): number {
  return findings.reduce((sum, f) => sum + f.monthlyWasteUsd, 0);
}
