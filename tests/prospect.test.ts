import { describe, expect, it } from 'vitest';
import {
  detectEmailProvider,
  detectPlatform,
  detectWidgetVendors,
  hasAccessibilityOverlay,
  hasNoStorefront,
  latestCopyrightYear,
  missingEmailAuth,
} from '../src/lib/prospect/detect';
import { extractContactEmail } from '../src/lib/prospect/contact';
import { buildFindings, totalMonthlyWaste } from '../src/lib/prospect/findings';
import {
  auditUrl,
  calculatorSelection,
  calculatorUrl,
  composeEmail,
  verticalPath,
  type Prospect,
} from '../src/lib/prospect/compose';
import {
  buildSuppressionSet,
  dueForFollowUp,
  isOutcomeStatus,
  ledgerKnownDomains,
  ledgerKnownEmails,
  ledgerStats,
  mergeLedgers,
  normalizeDomain,
  normalizeEmail,
  parseDomainList,
  parseLedger,
  parseLedgerResult,
  partitionProspects,
  recordContacted,
  recordDiscovered,
  recordFollowUp,
  recordOptedOut,
  recordOutcome,
  serializeLedger,
  verticalBreakdown,
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

describe('hasAccessibilityOverlay', () => {
  it('detects the major overlay vendors', () => {
    expect(
      hasAccessibilityOverlay({
        domain: 'x',
        html: '<script src="https://acsbapp.com/apps/app/dist/js/app.js">',
      }),
    ).toBe(true);
    expect(
      hasAccessibilityOverlay({ domain: 'x', html: '<script src="//cdn.userway.org/widget.js">' }),
    ).toBe(true);
  });
  it('is false for a page with no overlay', () => {
    expect(hasAccessibilityOverlay({ domain: 'x', html: '<p>Welcome</p>' })).toBe(false);
  });
});

describe('detectWidgetVendors', () => {
  it('lists every bolt-on widget it finds, in a stable order', () => {
    const html = 'assets.calendly.com/x js.hs-scripts.com/1.js embed.tawk.to/2';
    expect(detectWidgetVendors({ domain: 'x', html })).toEqual([
      'Calendly',
      'Tawk',
      'HubSpot',
    ]);
  });
  it('returns nothing when the page loads none of them', () => {
    expect(detectWidgetVendors({ domain: 'x' })).toEqual([]);
  });
});

describe('latestCopyrightYear', () => {
  it('reads a copyright line', () => {
    expect(latestCopyrightYear({ domain: 'x', html: '<p>&copy; 2021 Acme HVAC</p>' })).toBe(2021);
  });
  it('takes the end of a year range', () => {
    expect(latestCopyrightYear({ domain: 'x', html: 'Copyright 2015-2019 Acme' })).toBe(2019);
  });
  it('ignores digits that are not tied to a copyright marker', () => {
    expect(latestCopyrightYear({ domain: 'x', html: 'Call 6025551212, serving since 1998' })).toBeNull();
  });
  it('drops an implausible year', () => {
    expect(latestCopyrightYear({ domain: 'x', html: '&copy; 1889 Acme' })).toBeNull();
  });
  it('returns null when there is no html', () => {
    expect(latestCopyrightYear({ domain: 'x' })).toBeNull();
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

  it('prices an accessibility overlay as a dollar finding', () => {
    const findings = buildFindings({
      domain: 'x',
      html: '<script src="//cdn.userway.org/widget.js">',
    });
    const overlay = findings.find((f) => f.code === 'ada_overlay_widget');
    expect(overlay?.monthlyWasteUsd).toBe(49);
    expect(overlay?.headline).toContain('FTC');
  });

  it('flags a copyright year two or more years behind the clock', () => {
    const probe: DomainProbe = { domain: 'x', html: '&copy; 2022 Acme' };
    const stale = buildFindings(probe, new Date('2026-07-26T00:00:00Z')).find(
      (f) => f.code === 'stale_site',
    );
    expect(stale?.headline).toContain('2022');
  });

  it('leaves a copyright year only one year behind alone', () => {
    const probe: DomainProbe = { domain: 'x', html: '&copy; 2022 Acme' };
    expect(
      buildFindings(probe, new Date('2023-01-01T00:00:00Z')).some(
        (f) => f.code === 'stale_site',
      ),
    ).toBe(false);
  });

  it('names the overlapping widgets, reading naturally for two or more', () => {
    const two = buildFindings({ domain: 'x', html: 'calendly.com tawk.to' });
    expect(two.find((f) => f.code === 'widget_overlap')?.headline).toContain(
      'Calendly and Tawk',
    );
    const three = buildFindings({
      domain: 'x',
      html: 'calendly.com tawk.to chimpstatic.com',
    });
    expect(three.find((f) => f.code === 'widget_overlap')?.headline).toContain(
      'Calendly, Tawk, and Mailchimp',
    );
  });

  it('does not call a single widget an overlap', () => {
    expect(
      buildFindings({ domain: 'x', html: 'calendly.com' }).some(
        (f) => f.code === 'widget_overlap',
      ),
    ).toBe(false);
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

  it('maps detected findings onto calculator options', () => {
    const findings = buildFindings({
      domain: 'acme.com',
      html: 'cdn.shopify.com brochure',
      mxRecords: ['aspmx.l.google.com'],
    });
    expect(calculatorSelection(findings)).toEqual(['shopify_no_store', 'email_1_3']);
  });

  it('maps a detected overlay onto its calculator option', () => {
    const findings = buildFindings({
      domain: 'acme.com',
      html: '<script src="//cdn.userway.org/widget.js">',
    });
    expect(calculatorSelection(findings)).toEqual(['ada_overlay']);
  });

  it('builds a prefilled calculator link with UTM tags', () => {
    const findings = buildFindings({ domain: 'acme.com', html: 'cdn.shopify.com brochure' });
    const url = calculatorUrl(findings);
    expect(url).toContain('/calculator?s=shopify_no_store');
    expect(url).toContain('utm_source=outreach');
  });

  it('returns no calculator link when nothing maps to a priced option', () => {
    // Missing email auth is a real finding but carries no dollar option.
    const findings = buildFindings({ domain: 'acme.com' });
    expect(findings.length).toBeGreaterThan(0);
    expect(calculatorUrl(findings)).toBe('');
  });

  it('includes the calculator link in the email when one exists', () => {
    const findings = buildFindings({ domain: 'acme.com', html: 'cdn.shopify.com brochure' });
    const email = composeEmail(base, findings);
    expect(email.body).toContain('Run your own numbers');
    expect(email.body).toContain('/calculator?s=');
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
    contactedAt: {},
    followedUpAt: {},
    outcomes: {},
    verticals: {},
  };

  it('parses an empty or blank ledger to empty lists', () => {
    expect(parseLedger('')).toEqual(EMPTY);
    expect(parseLedger('   ')).toEqual(EMPTY);
  });

  it('parses malformed JSON to an empty ledger instead of throwing', () => {
    expect(parseLedger('{not json')).toEqual(EMPTY);
  });

  // Read-only callers can live with an empty ledger, but a writer must not:
  // merging empty over a real ledger discards every suppression it holds. The
  // difference between "no key yet" and "unreadable" is what tells them apart.
  describe('parseLedgerResult', () => {
    it('does not call an absent or blank value corrupt', () => {
      expect(parseLedgerResult('')).toEqual({ ledger: EMPTY, corrupt: false });
      expect(parseLedgerResult('   ')).toEqual({ ledger: EMPTY, corrupt: false });
    });

    it('flags a value that exists but does not parse', () => {
      expect(parseLedgerResult('{not json')).toEqual({ ledger: EMPTY, corrupt: true });
    });

    it('reports a good value as intact', () => {
      const result = parseLedgerResult(JSON.stringify({ optedOut: ['a.com'] }));
      expect(result.corrupt).toBe(false);
      expect(result.ledger.optedOut).toEqual(['a.com']);
    });
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
      ...EMPTY,
      discovered: ['a.com'],
      contacted: ['b.com'],
      contactedEmails: ['owner@b.com'],
      contactedAt: { 'b.com': '2026-07-01T00:00:00.000Z' },
      outcomes: { 'b.com': { status: 'replied' as const, at: '2026-07-02T00:00:00.000Z' } },
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

  it('stamps first contact and never overwrites it', () => {
    const day1 = new Date('2026-07-01T10:00:00Z');
    const day2 = new Date('2026-07-09T10:00:00Z');
    const first = recordContacted(EMPTY, ['acme.com'], [], day1);
    const second = recordContacted(first, ['acme.com'], [], day2);
    expect(second.contactedAt['acme.com']).toBe(day1.toISOString());
  });

  it('ignores blank domains when stamping contact time', () => {
    const next = recordContacted(EMPTY, [''], [], new Date('2026-07-01T00:00:00Z'));
    expect(next.contactedAt).toEqual({});
  });

  it('records the vertical a contact was discovered under, keyed raw or normalized', () => {
    const next = recordContacted(EMPTY, ['www.acme.com', 'b.com'], [], new Date(), {
      'www.acme.com': 'Pest Control',
      'b.com': 'HVAC & Plumbing',
    });
    expect(next.verticals).toEqual({
      'acme.com': 'Pest Control',
      'b.com': 'HVAC & Plumbing',
    });
  });

  it('falls back to the normalized domain when the vertical map uses it', () => {
    const next = recordContacted(EMPTY, ['www.acme.com'], [], new Date(), {
      'acme.com': 'Pest Control',
    });
    expect(next.verticals['acme.com']).toBe('Pest Control');
  });

  it('never overwrites the original vertical and tolerates a missing one', () => {
    const first = recordContacted(EMPTY, ['acme.com'], [], new Date(), {
      'acme.com': 'Pest Control',
    });
    const second = recordContacted(first, ['acme.com', 'x.com'], [], new Date(), {
      'acme.com': 'Roofing & Landscaping',
    });
    expect(second.verticals['acme.com']).toBe('Pest Control');
    expect(second.verticals['x.com']).toBeUndefined();
  });

  it('records and overwrites follow-up timestamps, skipping blanks', () => {
    const at = new Date('2026-07-10T00:00:00Z');
    const next = recordFollowUp(EMPTY, ['acme.com', ''], at);
    expect(next.followedUpAt).toEqual({ 'acme.com': at.toISOString() });
  });

  it('records an outcome', () => {
    const at = new Date('2026-07-10T00:00:00Z');
    const next = recordOutcome(EMPTY, 'www.acme.com', 'replied', at);
    expect(next.outcomes['acme.com']).toEqual({ status: 'replied', at: at.toISOString() });
  });

  it('ignores an outcome for a blank domain', () => {
    expect(recordOutcome(EMPTY, '', 'replied').outcomes).toEqual({});
  });

  it('treats declined and bounced as opt-outs', () => {
    expect(recordOutcome(EMPTY, 'a.com', 'declined').optedOut).toContain('a.com');
    expect(recordOutcome(EMPTY, 'b.com', 'bounced').optedOut).toContain('b.com');
    expect(recordOutcome(EMPTY, 'c.com', 'booked').optedOut).toEqual([]);
  });

  it('validates outcome status strings', () => {
    expect(isOutcomeStatus('replied')).toBe(true);
    expect(isOutcomeStatus('maybe')).toBe(false);
  });

  it('parses timestamp and outcome maps, dropping malformed entries', () => {
    const ledger = parseLedger(
      JSON.stringify({
        contactedAt: { 'WWW.A.com': '2026-07-01T00:00:00Z', 'b.com': 42, 'c.com': '' },
        followedUpAt: 'not-an-object',
        outcomes: {
          'd.com': { status: 'replied', at: '2026-07-02T00:00:00Z' },
          'e.com': { status: 'nonsense', at: '2026-07-02T00:00:00Z' },
          'f.com': { status: 'replied' },
          'g.com': 'not-an-object',
        },
      }),
    );
    expect(ledger.contactedAt).toEqual({ 'a.com': '2026-07-01T00:00:00Z' });
    expect(ledger.followedUpAt).toEqual({});
    expect(Object.keys(ledger.outcomes)).toEqual(['d.com']);
  });

  it('parses the vertical map with normalized keys, dropping malformed entries', () => {
    const ledger = parseLedger(
      JSON.stringify({
        verticals: { 'WWW.A.com': 'Pest Control', 'b.com': 42, 'c.com': '' },
      }),
    );
    expect(ledger.verticals).toEqual({ 'a.com': 'Pest Control' });
  });

  it('ignores array values for the map fields', () => {
    const ledger = parseLedger(JSON.stringify({ contactedAt: [], outcomes: [] }));
    expect(ledger.contactedAt).toEqual({});
    expect(ledger.outcomes).toEqual({});
  });

  describe('dueForFollowUp', () => {
    const now = new Date('2026-07-20T00:00:00Z');
    const base = recordContacted(
      EMPTY,
      ['old.com', 'fresh.com', 'ancient.com'],
      [],
      now,
    );
    // Hand-set timestamps so each case lands in a known window.
    const ledger: typeof base = {
      ...base,
      contactedAt: {
        'old.com': '2026-07-13T00:00:00Z', // 7 days ago, due
        'fresh.com': '2026-07-19T00:00:00Z', // 1 day ago, too soon
        'ancient.com': '2026-05-01T00:00:00Z', // way past the window
      },
    };

    it('returns only prospects inside the window', () => {
      expect(dueForFollowUp(ledger, now).map((d) => d.domain)).toEqual(['old.com']);
    });

    it('reports how many days ago contact happened', () => {
      expect(dueForFollowUp(ledger, now)[0].daysAgo).toBe(7);
    });

    it('skips anyone who replied, was followed up, or opted out', () => {
      expect(dueForFollowUp(recordOutcome(ledger, 'old.com', 'replied', now), now)).toEqual([]);
      expect(dueForFollowUp(recordFollowUp(ledger, ['old.com'], now), now)).toEqual([]);
      expect(dueForFollowUp(recordOptedOut(ledger, ['old.com']), now)).toEqual([]);
    });

    it('skips unparseable timestamps', () => {
      const broken = { ...ledger, contactedAt: { 'x.com': 'not-a-date' } };
      expect(dueForFollowUp(broken, now)).toEqual([]);
    });

    it('sorts the longest wait first', () => {
      const two = {
        ...ledger,
        contactedAt: {
          'a.com': '2026-07-14T00:00:00Z', // 6 days
          'b.com': '2026-07-10T00:00:00Z', // 10 days
        },
      };
      expect(dueForFollowUp(two, now).map((d) => d.domain)).toEqual(['b.com', 'a.com']);
    });
  });

  describe('ledgerStats', () => {
    it('reports zeros for an empty ledger without dividing by zero', () => {
      const stats = ledgerStats(EMPTY);
      expect(stats.contacted).toBe(0);
      expect(stats.replyRate).toBe(0);
    });

    it('counts outcomes and computes a reply rate including bookings', () => {
      let ledger = recordContacted(
        EMPTY,
        ['a.com', 'b.com', 'c.com', 'd.com'],
        ['a@a.com'],
      );
      ledger = recordOutcome(ledger, 'a.com', 'replied');
      ledger = recordOutcome(ledger, 'b.com', 'booked');
      ledger = recordOutcome(ledger, 'c.com', 'bounced');
      const stats = ledgerStats(ledger);
      expect(stats.contacted).toBe(4);
      expect(stats.emailed).toBe(1);
      expect(stats.replied).toBe(1);
      expect(stats.booked).toBe(1);
      expect(stats.bounced).toBe(1);
      expect(stats.awaitingReply).toBe(1);
      // 2 of 4 produced a reply.
      expect(stats.replyRate).toBe(50);
    });
  });

  describe('verticalBreakdown', () => {
    it('is empty when nobody has been contacted', () => {
      expect(verticalBreakdown(EMPTY)).toEqual([]);
    });

    it('groups outcomes by vertical, most contacted first', () => {
      let ledger = recordContacted(
        EMPTY,
        ['a.com', 'b.com', 'c.com', 'd.com'],
        [],
        new Date(),
        {
          'a.com': 'Pest Control',
          'b.com': 'Pest Control',
          'c.com': 'Pest Control',
          'd.com': 'HVAC & Plumbing',
        },
      );
      ledger = recordOutcome(ledger, 'a.com', 'replied');
      ledger = recordOutcome(ledger, 'b.com', 'booked');
      ledger = recordOutcome(ledger, 'c.com', 'declined');
      expect(verticalBreakdown(ledger)).toEqual([
        { vertical: 'Pest Control', contacted: 3, replied: 1, booked: 1 },
        { vertical: 'HVAC & Plumbing', contacted: 1, replied: 0, booked: 0 },
      ]);
    });

    it('groups pre-tracking contacts as unknown and breaks ties alphabetically', () => {
      const ledger = recordContacted(EMPTY, ['old.com', 'new.com'], [], new Date(), {
        'new.com': 'Pest Control',
      });
      expect(verticalBreakdown(ledger)).toEqual([
        { vertical: '(unknown)', contacted: 1, replied: 0, booked: 0 },
        { vertical: 'Pest Control', contacted: 1, replied: 0, booked: 0 },
      ]);
    });
  });

  // KV has no compare-and-swap, so a hand-run optout landing mid-pipeline
  // used to be erased by the pipeline's later write. Writes merge now, and
  // every field has to converge rather than clobber.
  describe('mergeLedgers', () => {
    it('unions every list, losing nothing from either side', () => {
      const a = { ...EMPTY, discovered: ['a.com'], contacted: ['a.com'], contactedEmails: ['a@a.com'] };
      const b = { ...EMPTY, discovered: ['b.com'], optedOut: ['b.com'], contactedEmails: ['b@b.com'] };
      const merged = mergeLedgers(a, b);
      expect(merged.discovered.sort()).toEqual(['a.com', 'b.com']);
      expect(merged.contacted).toEqual(['a.com']);
      expect(merged.optedOut).toEqual(['b.com']);
      expect(merged.contactedEmails.sort()).toEqual(['a@a.com', 'b@b.com']);
    });

    // The opt-out that motivated the whole change.
    it('keeps a concurrent opt-out that the other snapshot never saw', () => {
      const pipeline = { ...EMPTY, discovered: ['x.com'], contacted: ['x.com'] };
      const manual = { ...EMPTY, optedOut: ['x.com'], discovered: ['x.com'] };
      expect(mergeLedgers(manual, pipeline).optedOut).toEqual(['x.com']);
      expect(mergeLedgers(pipeline, manual).optedOut).toEqual(['x.com']);
    });

    it('keeps the earliest first contact, since follow-up timing keys off it', () => {
      const early = { ...EMPTY, contactedAt: { 'a.com': '2026-07-01T00:00:00Z' } };
      const late = { ...EMPTY, contactedAt: { 'a.com': '2026-07-09T00:00:00Z' } };
      expect(mergeLedgers(early, late).contactedAt['a.com']).toBe('2026-07-01T00:00:00Z');
      expect(mergeLedgers(late, early).contactedAt['a.com']).toBe('2026-07-01T00:00:00Z');
    });

    it('keeps the latest follow-up and outcome, which correct an earlier state', () => {
      const old = {
        ...EMPTY,
        followedUpAt: { 'a.com': '2026-07-01T00:00:00Z' },
        outcomes: { 'a.com': { status: 'replied' as const, at: '2026-07-01T00:00:00Z' } },
      };
      const fresh = {
        ...EMPTY,
        followedUpAt: { 'a.com': '2026-07-08T00:00:00Z' },
        outcomes: { 'a.com': { status: 'booked' as const, at: '2026-07-08T00:00:00Z' } },
      };
      expect(mergeLedgers(old, fresh).followedUpAt['a.com']).toBe('2026-07-08T00:00:00Z');
      expect(mergeLedgers(fresh, old).followedUpAt['a.com']).toBe('2026-07-08T00:00:00Z');
      expect(mergeLedgers(old, fresh).outcomes['a.com'].status).toBe('booked');
      expect(mergeLedgers(fresh, old).outcomes['a.com'].status).toBe('booked');
    });

    it('takes an entry the other side does not have at all', () => {
      const empty = { ...EMPTY };
      const full = {
        ...EMPTY,
        contactedAt: { 'a.com': '2026-07-01T00:00:00Z' },
        outcomes: { 'a.com': { status: 'replied' as const, at: '2026-07-01T00:00:00Z' } },
      };
      expect(mergeLedgers(empty, full).contactedAt['a.com']).toBe('2026-07-01T00:00:00Z');
      expect(mergeLedgers(empty, full).outcomes['a.com'].status).toBe('replied');
    });

    it('lets a usable timestamp beat an unparseable one, either way round', () => {
      const good = {
        ...EMPTY,
        contactedAt: { 'a.com': '2026-07-01T00:00:00Z' },
        outcomes: { 'a.com': { status: 'replied' as const, at: '2026-07-01T00:00:00Z' } },
      };
      const junk = {
        ...EMPTY,
        contactedAt: { 'a.com': 'not-a-date' },
        outcomes: { 'a.com': { status: 'booked' as const, at: 'not-a-date' } },
      };
      // Incoming junk never displaces a usable value.
      expect(mergeLedgers(good, junk).contactedAt['a.com']).toBe('2026-07-01T00:00:00Z');
      expect(mergeLedgers(good, junk).outcomes['a.com'].status).toBe('replied');
      // A usable value replaces junk already on record.
      expect(mergeLedgers(junk, good).contactedAt['a.com']).toBe('2026-07-01T00:00:00Z');
      expect(mergeLedgers(junk, good).outcomes['a.com'].status).toBe('replied');
    });

    it('keeps the first recorded vertical and fills in missing ones', () => {
      const original = { ...EMPTY, verticals: { 'a.com': 'Pest Control' } };
      const later = {
        ...EMPTY,
        verticals: { 'a.com': 'Roofing & Landscaping', 'b.com': 'HVAC & Plumbing' },
      };
      const merged = mergeLedgers(original, later);
      expect(merged.verticals['a.com']).toBe('Pest Control');
      expect(merged.verticals['b.com']).toBe('HVAC & Plumbing');
    });

    it('merging a ledger with itself changes nothing', () => {
      const ledger = {
        ...EMPTY,
        discovered: ['a.com'],
        contactedAt: { 'a.com': '2026-07-01T00:00:00Z' },
        outcomes: { 'a.com': { status: 'replied' as const, at: '2026-07-01T00:00:00Z' } },
      };
      expect(mergeLedgers(ledger, ledger)).toEqual(ledger);
    });
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
