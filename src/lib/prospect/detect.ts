import type { DomainProbe, EmailProvider, Platform } from './types';

function haystack(probe: DomainProbe): string {
  const headerText = probe.headers
    ? Object.entries(probe.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : '';
  return `${headerText}\n${probe.html ?? ''}`.toLowerCase();
}

// Detects the website platform from headers and markup fingerprints. Order
// matters: the most specific, least spoofable signals are checked first.
export function detectPlatform(probe: DomainProbe): Platform {
  const text = haystack(probe);

  if (
    text.includes('cdn.shopify.com') ||
    text.includes('x-shopify') ||
    text.includes('shopify.theme')
  ) {
    return 'shopify';
  }
  if (
    text.includes('x-wix-') ||
    text.includes('wix.com') ||
    text.includes('static.wixstatic.com')
  ) {
    return 'wix';
  }
  if (
    text.includes('squarespace.com') ||
    text.includes('static1.squarespace') ||
    text.includes('x-servedby: squarespace')
  ) {
    return 'squarespace';
  }
  if (text.includes('assets.webflow.com') || text.includes('generator" content="webflow')) {
    return 'webflow';
  }
  if (text.includes('weebly.com') || text.includes('editmysite.com')) {
    return 'weebly';
  }
  if (text.includes('godaddy') || text.includes('websitebuilder.godaddy')) {
    return 'godaddy';
  }
  if (
    text.includes('wp-content') ||
    text.includes('wp-includes') ||
    text.includes('generator" content="wordpress')
  ) {
    return 'wordpress';
  }
  return 'unknown';
}

// True when the page presents as a Shopify store but shows no sign of an
// actual storefront (no cart, no products). This is the flagship finding.
export function hasNoStorefront(probe: DomainProbe): boolean {
  const html = (probe.html ?? '').toLowerCase();
  if (!html) {
    return false;
  }
  const storeSignals = [
    '/cart',
    'add to cart',
    'addtocart',
    '/products/',
    '/collections/',
    'data-product-id',
    'shopify-payment-button',
  ];
  return !storeSignals.some((s) => html.includes(s));
}

// Classifies the email provider from MX host records.
export function detectEmailProvider(probe: DomainProbe): EmailProvider {
  const mx = (probe.mxRecords ?? []).map((r) => r.toLowerCase());
  if (mx.length === 0) {
    return 'none';
  }
  if (mx.some((r) => r.includes('google') || r.includes('googlemail'))) {
    return 'google';
  }
  if (
    mx.some(
      (r) =>
        r.includes('outlook') ||
        r.includes('office365') ||
        r.includes('.protection.') ||
        r.includes('microsoft'),
    )
  ) {
    return 'microsoft';
  }
  return 'other';
}

// True when neither SPF (in TXT) nor DMARC is published. Missing email
// authentication hurts deliverability and is a common oversight.
export function missingEmailAuth(probe: DomainProbe): boolean {
  const txt = (probe.txtRecords ?? []).map((r) => r.toLowerCase());
  const dmarc = (probe.dmarcRecords ?? []).map((r) => r.toLowerCase());
  const hasSpf = txt.some((r) => r.includes('v=spf1'));
  const hasDmarc = dmarc.some((r) => r.includes('v=dmarc1'));
  return !hasSpf && !hasDmarc;
}
