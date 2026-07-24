import {
  detectEmailProvider,
  detectPlatform,
  hasNoStorefront,
  missingEmailAuth,
} from './detect';
import type { DomainProbe, Finding, Platform } from './types';

// Conservative, defensible monthly figures. We would rather under-claim in a
// cold email than be accused of inflating the number.
const WASTE = {
  shopifyNoStore: 39, // Shopify Basic
  pageBuilder: 23, // typical Wix/Squarespace/GoDaddy plan
  paidEmailPerMailbox: 7, // Google Workspace / M365 entry tier, per mailbox
};

const PAGE_BUILDERS: Platform[] = ['wix', 'squarespace', 'godaddy', 'weebly'];

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

// Turns a raw probe into an ordered list of prospect-facing findings. Pure
// and deterministic: identical input always yields identical output.
export function buildFindings(probe: DomainProbe): Finding[] {
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
