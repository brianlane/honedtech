import { describe, expect, it } from 'vitest';
import {
  detectEmailProvider,
  detectPlatform,
  hasNoStorefront,
  missingEmailAuth,
} from '../src/lib/prospect/detect';
import { extractContactEmail } from '../src/lib/prospect/contact';
import { buildFindings, totalMonthlyWaste } from '../src/lib/prospect/findings';
import {
  auditUrl,
  composeEmail,
  verticalPath,
  type Prospect,
} from '../src/lib/prospect/compose';
import {
  buildSuppressionSet,
  ledgerKnownDomains,
  ledgerKnownEmails,
  normalizeDomain,
  normalizeEmail,
  parseDomainList,
  parseLedger,
  partitionProspects,
  recordContacted,
  recordDiscovered,
  recordOptedOut,
  serializeLedger,
} from '../src/lib/prospect/ledger';
import type { DomainProbe } from '../src/lib/prospect/types';

describe('detectPlatform', () => {
  it('detects Shopify from an asset host', () => {
    expect(detectPlatform({ domain: 'x', html: '<script src="//cdn.shopify.com/s/x.js">' })).toBe('shopify');
  });
  it('detects Shopify from a response header', () => {
    expect(
      detectPlatform({ domain: 'x', headers: { 'x-shopify-stage': 'production' } }),
    ).toBe('shopify');
  });
  it('detects Wix', () => {
    expect(detectPlatform({ domain: 'x', headers: { 'x-wix-request-id': '1' } })).toBe('wix');
  });
  it('detects Squarespace', () => {
    expect(detectPlatform({ domain: 'x', html: 'built on static1.squarespace.com' })).toBe('squarespace');
  });
  it('detects Webflow', () => {
    expect(detectPlatform({ domain: 'x', html: '<link href="assets.webflow.com/x.css">' })).toBe('webflow');
  });
  it('detects Weebly', () => {
    expect(detectPlatform({ domain: 'x', html: 'cdn2.editmysite.com/x' })).toBe('weebly');
  });
  it('detects GoDaddy', () => {
    expect(detectPlatform({ domain: 'x', html: 'websitebuilder.godaddy hosted' })).toBe('godaddy');
  });
  it('detects WordPress', () => {
    expect(detectPlatform({ domain: 'x', html: '<link href="/wp-content/themes/x">' })).toBe('wordpress');
  });
  it('returns unknown with no signal and no headers/html', () => {
    expect(detectPlatform({ domain: 'x' })).toBe('unknown');
  });
});

describe('hasNoStorefront', () => {
  it('is false when a cart or product signal is present', () => {
    expect(hasNoStorefront({ domain: 'x', html: '<a href="/cart">Cart</a>' })).toBe(false);
  });
  it('is true for a Shopify page with no store signals', () => {
    expect(hasNoStorefront({ domain: 'x', html: '<h1>Welcome to our brochure</h1>' })).toBe(true);
  });
  it('is false when html is missing', () => {
    expect(hasNoStorefront({ domain: 'x' })).toBe(false);
  });
});

describe('detectEmailProvider', () => {
  it('returns none with no MX', () => {
    expect(detectEmailProvider({ domain: 'x' })).toBe('none');
  });
  it('detects Google', () => {
    expect(detectEmailProvider({ domain: 'x', mxRecords: ['aspmx.l.google.com'] })).toBe('google');
  });
  it('detects Microsoft', () => {
    expect(
      detectEmailProvider({ domain: 'x', mxRecords: ['x.mail.protection.outlook.com'] }),
    ).toBe('microsoft');
  });
  it('returns other for an unrecognized host', () => {
    expect(detectEmailProvider({ domain: 'x', mxRecords: ['mx.zoho.com'] })).toBe('other');
  });
});

describe('missingEmailAuth', () => {
  it('is true when neither SPF nor DMARC present', () => {
    expect(missingEmailAuth({ domain: 'x' })).toBe(true);
  });
  it('is false when SPF present', () => {
    expect(missingEmailAuth({ domain: 'x', txtRecords: ['v=spf1 include:_spf.google.com ~all'] })).toBe(false);
  });
  it('is false when DMARC present', () => {
    expect(missingEmailAuth({ domain: 'x', dmarcRecords: ['v=DMARC1; p=none'] })).toBe(false);
  });
});

describe('extractContactEmail', () => {
  it('returns null with empty html', () => {
    expect(extractContactEmail('', 'acme.com')).toBeNull();
  });
  it('returns null when no email present', () => {
    expect(extractContactEmail('<p>call us</p>', 'acme.com')).toBeNull();
  });
  it('prefers an on-domain address and strips trailing dot', () => {
    const html = 'reach vendor@gmail.com or hello@acme.com.';
    expect(extractContactEmail(html, 'www.acme.com')).toBe('hello@acme.com');
  });
  it('falls back to first plausible when none on-domain', () => {
    expect(extractContactEmail('info@partner.com', 'acme.com')).toBe('info@partner.com');
  });
  it('filters out asset filenames and noise addresses', () => {
    const html = 'logo@2x.png sprite@sentry.io no-reply@acme.com hi@acme.com';
    expect(extractContactEmail(html, 'acme.com')).toBe('hi@acme.com');
  });
  it('returns null when every match is noise', () => {
    expect(extractContactEmail('no-reply@acme.com', 'acme.com')).toBeNull();
  });
});

describe('buildFindings + totalMonthlyWaste', () => {
  it('flags a Shopify site with no storefront as the top finding', () => {
    const probe: DomainProbe = { domain: 'acme.com', html: 'cdn.shopify.com brochure' };
    const findings = buildFindings(probe);
    expect(findings[0].code).toBe('ecommerce_platform_no_store');
    expect(totalMonthlyWaste(findings)).toBe(39);
  });

  it('does not flag Shopify when a store is present', () => {
    const probe: DomainProbe = { domain: 'acme.com', html: 'cdn.shopify.com <a href="/cart">' };
    expect(buildFindings(probe).some((f) => f.code === 'ecommerce_platform_no_store')).toBe(false);
  });

  it('flags a page-builder platform', () => {
    const findings = buildFindings({ domain: 'x', headers: { 'x-wix-request-id': '1' } });
    expect(findings.some((f) => f.code === 'page_builder_site')).toBe(true);
  });

  it('flags Google and Microsoft email hosting', () => {
    expect(
      buildFindings({ domain: 'x', mxRecords: ['aspmx.l.google.com'] }).some(
        (f) => f.code === 'paid_email_hosting',
      ),
    ).toBe(true);
    expect(
      buildFindings({ domain: 'x', mxRecords: ['x.protection.outlook.com'] }).some(
        (f) => f.code === 'paid_email_hosting',
      ),
    ).toBe(true);
  });

  it('omits the email-auth finding when SPF is published', () => {
    const probe: DomainProbe = {
      domain: 'x',
      headers: { 'x-wix-request-id': '1' },
      txtRecords: ['v=spf1 include:_spf.google.com ~all'],
    };
    expect(buildFindings(probe).some((f) => f.code === 'missing_email_auth')).toBe(false);
  });

  it('flags heavy pages by bytes or by request count', () => {
    expect(buildFindings({ domain: 'x', htmlBytes: 3_000_000 }).some((f) => f.code === 'heavy_page')).toBe(true);
    expect(buildFindings({ domain: 'x', requestCount: 120 }).some((f) => f.code === 'heavy_page')).toBe(true);
  });

  it('flags a missing HTTPS redirect only when explicitly false', () => {
    expect(buildFindings({ domain: 'x', redirectedToHttps: false }).some((f) => f.code === 'no_https_redirect')).toBe(true);
    expect(buildFindings({ domain: 'x' }).some((f) => f.code === 'no_https_redirect')).toBe(false);
  });

  it('sorts by severity and sums only dollar findings', () => {
    const probe: DomainProbe = {
      domain: 'acme.com',
      headers: { 'x-wix-request-id': '1' },
      mxRecords: ['aspmx.l.google.com'],
      redirectedToHttps: false,
    };
    const findings = buildFindings(probe);
    const severities = findings.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
    expect(totalMonthlyWaste(findings)).toBe(23 + 7);
  });
});

describe('composeEmail + url helpers', () => {
  const base: Prospect = { business: 'Acme HVAC', domain: 'acme.com', vertical: 'HVAC & Plumbing' };

  it('derives a slug path and homepage fallback', () => {
    expect(verticalPath('HVAC & Plumbing')).toBe('/audits/hvac-plumbing');
    expect(verticalPath(undefined)).toBe('/');
    expect(verticalPath('&&&')).toBe('/');
  });

  it('builds a UTM-tagged audit url', () => {
    const url = auditUrl('Law Firms & CPAs');
    expect(url).toContain('/audits/law-firms-cpas');
    expect(url).toContain('utm_source=outreach');
  });

  it('composes a dollar-led email with findings', () => {
    const findings = buildFindings({ domain: 'acme.com', html: 'cdn.shopify.com brochure' });
    const email = composeEmail(base, findings);
    expect(email.subject).toContain('$39/mo');
    expect(email.body).toContain('Hi there,');
    expect(email.body).toContain('acme.com');
    expect(email.body).toContain('$299');
    expect(email.body).toContain('unsubscribe');
    expect(email.body).toContain('/audits/hvac-plumbing');
  });

  it('greets a named contact and handles the no-dollar, no-findings case', () => {
    const email = composeEmail({ ...base, contactName: 'Dana' }, []);
    expect(email.body).toContain('Hi Dana,');
    expect(email.subject).toContain('quick tech-stack notes');
    expect(email.body).not.toContain('/month you may be able to stop');
  });
});

describe('ledger', () => {
  it('normalizes domains', () => {
    expect(normalizeDomain('HTTPS://WWW.Acme.com/contact?x=1')).toBe('acme.com');
    expect(normalizeDomain('acme.com.')).toBe('acme.com');
  });

  it('parses a domain list ignoring headers, comments, blanks', () => {
    const text = 'domain\n# a comment\n\nAcme.com, Acme HVAC\nhttps://foo.com/x\n';
    expect(parseDomainList(text)).toEqual(['acme.com', 'foo.com']);
  });

  it('drops rows whose first cell is empty', () => {
    expect(parseDomainList(',just a note\nacme.com')).toEqual(['acme.com']);
  });

  it('builds a suppression set from opt-out and log', () => {
    const set = buildSuppressionSet('optout.com', 'sent.com');
    expect(set.has('optout.com')).toBe(true);
    expect(set.has('sent.com')).toBe(true);
  });

  const EMPTY = {
    discovered: [],
    contacted: [],
    contactedEmails: [],
    optedOut: [],
  };

  it('parses an empty or blank ledger to empty lists', () => {
    expect(parseLedger('')).toEqual(EMPTY);
    expect(parseLedger('   ')).toEqual(EMPTY);
  });

  it('parses malformed JSON to an empty ledger instead of throwing', () => {
    expect(parseLedger('{not json')).toEqual(EMPTY);
  });

  it('reads a ledger written before contactedEmails existed', () => {
    const legacy = JSON.stringify({ discovered: ['a.com'], contacted: [], optedOut: [] });
    expect(parseLedger(legacy).contactedEmails).toEqual([]);
  });

  it('normalizes and filters ledger entries, dropping non-strings and bad shapes', () => {
    const ledger = parseLedger(
      JSON.stringify({
        discovered: ['HTTPS://WWW.A.com/x', 42, '', null],
        contacted: 'not-an-array',
        optedOut: ['b.com'],
      }),
    );
    expect(ledger.discovered).toEqual(['a.com']);
    expect(ledger.contacted).toEqual([]);
    expect(ledger.optedOut).toEqual(['b.com']);
  });

  it('round-trips through serialize', () => {
    const ledger = {
      discovered: ['a.com'],
      contacted: ['b.com'],
      contactedEmails: ['owner@b.com'],
      optedOut: [],
    };
    expect(parseLedger(serializeLedger(ledger))).toEqual(ledger);
  });

  it('normalizes emails and drops entries that are not addresses', () => {
    const ledger = parseLedger(
      JSON.stringify({ contactedEmails: ['  Owner@ACME.com ', 'not-an-email', 7] }),
    );
    expect(ledger.contactedEmails).toEqual(['owner@acme.com']);
  });

  it('ignores a contactedEmails value that is not an array', () => {
    expect(parseLedger(JSON.stringify({ contactedEmails: 'nope' })).contactedEmails).toEqual([]);
  });

  it('records contacted domains and addresses, marking domains discovered', () => {
    const next = recordContacted(
      { discovered: [], contacted: [], contactedEmails: [], optedOut: [] },
      ['acme.com'],
      ['Owner@Acme.com', 'bad', ''],
    );
    expect(next.contacted).toEqual(['acme.com']);
    expect(next.contactedEmails).toEqual(['owner@acme.com']);
    expect(next.discovered).toEqual(['acme.com']);
    expect(ledgerKnownEmails(next).has('owner@acme.com')).toBe(true);
  });

  it('defaults to no emails and does not duplicate on repeat', () => {
    const once = recordContacted(
      { discovered: [], contacted: [], contactedEmails: [], optedOut: [] },
      ['acme.com'],
    );
    expect(once.contactedEmails).toEqual([]);
    const twice = recordContacted(once, ['www.acme.com'], []);
    expect(twice.contacted).toEqual(['acme.com']);
  });

  it('normalizes an email for comparison', () => {
    expect(normalizeEmail('  Owner@ACME.com ')).toBe('owner@acme.com');
  });

  it('unions every list into the known-domain set', () => {
    const known = ledgerKnownDomains({
      discovered: ['a.com'],
      contacted: ['b.com'],
      optedOut: ['c.com'],
    });
    expect([...known].sort()).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('records newly discovered domains without duplicating', () => {
    const next = recordDiscovered(
      { discovered: ['a.com'], contacted: [], optedOut: [] },
      ['www.a.com', 'b.com', ''],
    );
    expect(next.discovered.sort()).toEqual(['a.com', 'b.com']);
  });

  it('records opt-outs and suppresses them via the known set', () => {
    const next = recordOptedOut(
      { discovered: ['a.com'], contacted: [], optedOut: [] },
      ['https://www.b.com/contact', ''],
    );
    expect(next.optedOut).toEqual(['b.com']);
    // Also marked discovered so it stays suppressed if discovered is rebuilt.
    expect(next.discovered.sort()).toEqual(['a.com', 'b.com']);
    expect(ledgerKnownDomains(next).has('b.com')).toBe(true);
  });

  it('opting out twice does not duplicate the entry', () => {
    const once = recordOptedOut(
      { discovered: [], contacted: [], optedOut: [] },
      ['b.com'],
    );
    const twice = recordOptedOut(once, ['www.b.com']);
    expect(twice.optedOut).toEqual(['b.com']);
  });

  it('partitions prospects against the suppression set', () => {
    const prospects: Prospect[] = [
      { business: 'A', domain: 'a.com' },
      { business: 'B', domain: 'www.b.com' },
    ];
    const { sendable, skipped } = partitionProspects(prospects, new Set(['b.com']));
    expect(sendable.map((p) => p.business)).toEqual(['A']);
    expect(skipped.map((p) => p.business)).toEqual(['B']);
  });
});
