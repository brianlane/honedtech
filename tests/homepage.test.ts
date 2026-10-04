import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(root, 'src/pages/index.astro'), 'utf8');
const layout = readFileSync(resolve(root, 'src/layouts/Base.astro'), 'utf8');

describe('homepage rebuild', () => {
  it('keeps the approved section order and anchors', () => {
    const ids = [...page.matchAll(/<section[^>]*\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual([
      'consulting',
      'services',
      'audits',
      'pricing',
      'enterprise',
      'who',
      'about',
      'faq',
      'contact',
    ]);
  });

  it('publishes final consulting prices and keeps the existing price list', () => {
    expect(page).toContain('AI Efficiency Audit');
    expect(page).toContain("'$999'");
    expect(page).toContain("'$2,500-$15,000'");
    expect(page).toContain("'$750'");
    expect(page).toContain('The full fee is credited toward an implementation.');
    expect(page).toContain('Final scope is defined before work starts.');

    for (const price of [
      "'$299'",
      "'$599'",
      "'$2,499+'",
      "'$1,500-$3,500'",
      "'$4,000-$10,000'",
      "'$10,000+'",
      "'$499'",
      "'$1,800'",
      "'$4,800+'",
    ]) {
      expect(page).toContain(price);
    }

    expect(page).toContain('checked={tab.id === \'consulting\'}');
    expect(page).not.toMatch(/Proposed/);
  });

  it('uses the approved flagship, partner, and contact copy', () => {
    expect(page).toContain(
      'and<span class="accent"> make AI actually stick.</span>',
    );
    expect(page).toContain('AI efficiency consulting that ends in a working system.');
    expect(page).toContain(
      'Vendor products such as New Coworker may be selected when they fit the engagement.',
    );
    expect(page).toContain('trusted partners');
    expect(page).toContain('without presenting those');
    expect(page).toContain('controls as a direct product.');
    expect(page).toContain('hello@honedtech.com');
    expect(page).toContain('Get the sharp-stack note');
    expect(page).toContain('id="consulting"');
    expect(page).not.toContain('\u2014');
  });

  it('keeps the header, tagline, and booking paths the other pages use', () => {
    expect(layout).toContain('Sharp tech. Clean stack. No waste.');
    expect(layout).toContain('href="/#services">Services');
    expect(layout).toContain('href="/#pricing">Pricing');
    expect(layout).toContain('href="/#enterprise">Enterprise');
    expect(layout).toContain('href="/#audits">Audits');
    expect(layout).toContain('href="/#faq">FAQ');
    expect(layout).toContain('href="/#contact" class="nav-cta">Book an audit');
    expect(layout).toContain('action="/api/subscribe"');
    expect(layout).toContain('href="/calculator"');
    expect(layout).toContain('href="/enterprise"');
    expect(page).toContain('action="/api/contact"');
    expect(page).toContain('action="/api/subscribe"');
    expect(page).toContain('honed_calc_msg');
    expect(page).toContain('honed_enterprise_msg');
    expect(layout).not.toContain('\u2014');
  });

  it('applies the preview design system without an em dash', () => {
    const css = readFileSync(resolve(root, 'src/styles/global.css'), 'utf8');
    expect(css).toContain('Newsreader');
    expect(css).toContain('Public Sans');
    expect(css).toContain('#f7f9fb');
    expect(css).toContain('#08121b');
    expect(css).toContain('#12a681');
    expect(css).toContain('#41d6ad');
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(layout).toContain('family=Newsreader');
    expect(layout).toContain('Public+Sans');
    expect(page).toContain('class="hero home-hero"');
    expect(page).toContain('class="flagship"');
    expect(page).toContain('class="fit-band"');
    expect(page).toContain('brief-figure');
    expect(page).toContain('price-kicker');
    expect(css).not.toContain('\u2014');
  });
});
