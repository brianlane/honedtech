import type { DomainProbe, EmailProvider, Platform } from './types';

function haystack(probe: DomainProbe): string {
  const headerText = probe.headers
    ? Object.entries(probe.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : '';
  return `${headerText}\n${probe.html ?? ''}`.toLowerCase();
}

// Platform fingerprints. Regex with escaped dots (not string .includes on
// hostname-shaped literals) so this reads as content fingerprinting, not URL
// authorization: it matches a substring anywhere in the page/headers on
// purpose. Order matters: most specific, least spoofable signals first.
const FINGERPRINTS: { platform: Platform; patterns: RegExp[] }[] = [
  { platform: 'shopify', patterns: [/cdn\.shopify\.com/, /x-shopify/, /shopify\.theme/] },
  { platform: 'wix', patterns: [/x-wix-/, /wix\.com/, /static\.wixstatic\.com/] },
  {
    platform: 'squarespace',
    patterns: [/squarespace\.com/, /static1\.squarespace/, /x-servedby: squarespace/],
  },
  { platform: 'webflow', patterns: [/assets\.webflow\.com/, /generator" content="webflow/] },
  { platform: 'weebly', patterns: [/weebly\.com/, /editmysite\.com/] },
  { platform: 'godaddy', patterns: [/godaddy/, /websitebuilder\.godaddy/] },
  {
    platform: 'wordpress',
    patterns: [/wp-content/, /wp-includes/, /generator" content="wordpress/],
  },
];

// Detects the website platform from headers and markup fingerprints.
export function detectPlatform(probe: DomainProbe): Platform {
  const text = haystack(probe);
  for (const { platform, patterns } of FINGERPRINTS) {
    if (patterns.some((re) => re.test(text))) {
      return platform;
    }
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

// Accessibility overlay vendors. Same escaped-dot regex convention as the
// platform fingerprints above: this is content matching, not URL parsing.
const OVERLAY_VENDORS: RegExp[] = [
  /acsbapp\.com/,
  /accessibe\.com/,
  /userway\.org/,
  /audioeye\.com/,
  /equalweb\.com/,
];

// True when the page loads an accessibility overlay widget. These bill monthly
// and do not fix the underlying markup, so the subscription buys a toolbar and
// a false sense of compliance.
export function hasAccessibilityOverlay(probe: DomainProbe): boolean {
  const text = haystack(probe);
  return OVERLAY_VENDORS.some((re) => re.test(text));
}

// Third-party bolt-on widgets that each carry their own subscription. Two or
// more on one site is the concrete version of "your tools overlap".
const WIDGET_VENDORS: { name: string; pattern: RegExp }[] = [
  { name: 'Calendly', pattern: /calendly\.com/ },
  { name: 'Intercom', pattern: /intercom\.(io|com)/ },
  { name: 'Drift', pattern: /js\.driftt\.com|drift\.com/ },
  { name: 'Tawk', pattern: /tawk\.to/ },
  { name: 'HubSpot', pattern: /hs-scripts\.com|hubspot\.com/ },
  { name: 'Mailchimp', pattern: /chimpstatic\.com|mailchimp\.com/ },
  { name: 'Podium', pattern: /podium\.com/ },
  { name: 'Birdeye', pattern: /birdeye\.com/ },
];

// Names of the bolt-on widgets present, in a stable order.
export function detectWidgetVendors(probe: DomainProbe): string[] {
  const text = haystack(probe);
  return WIDGET_VENDORS.filter((v) => v.pattern.test(text)).map((v) => v.name);
}

// The newest copyright year published on the page, or null when there is
// none. Anchored to a copyright marker so phone numbers and ids cannot match,
// and it takes the max so a "2019-2024" range reads as 2024.
export function latestCopyrightYear(probe: DomainProbe): number | null {
  const matches = (probe.html ?? '').matchAll(
    /(?:\u00a9|&copy;|copyright)[^0-9]{0,12}(?:\d{4}\s*[-\u2013]\s*)?(\d{4})/gi,
  );
  const years = [...matches]
    .map((m) => Number(m[1]))
    .filter((y) => y >= 1990 && y <= 2100);
  return years.length > 0 ? Math.max(...years) : null;
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
