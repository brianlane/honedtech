import { describe, expect, it } from 'vitest';
import {
  checkEmailAuth,
  countByStatus,
  isSendReady,
  parseDmarc,
  type DnsSnapshot,
} from '../src/lib/email-auth';

// A fully configured domain: Cloudflare inbound plus Resend outbound.
const GOOD: DnsSnapshot = {
  rootTxt: ['v=spf1 include:_spf.mx.cloudflare.net ~all'],
  rootMx: ['route1.mx.cloudflare.net', 'route2.mx.cloudflare.net'],
  dmarcTxt: ['v=DMARC1; p=none; rua=mailto:dmarc@honedtech.com; fo=1'],
  dkimTxt: ['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC5UN'],
  sendTxt: ['v=spf1 include:amazonses.com ~all'],
  sendMx: ['10 feedback-smtp.us-east-1.amazonses.com'],
};

const EMPTY: DnsSnapshot = {
  rootTxt: [],
  rootMx: [],
  dmarcTxt: [],
  dkimTxt: [],
  sendTxt: [],
  sendMx: [],
};

function byId(snap: DnsSnapshot, id: string) {
  return checkEmailAuth('honedtech.com', snap).find((r) => r.id === id);
}

describe('parseDmarc', () => {
  it('extracts tags, lowercasing names', () => {
    expect(parseDmarc('v=DMARC1; P=quarantine; rua=mailto:a@b.com')).toEqual({
      v: 'DMARC1',
      p: 'quarantine',
      rua: 'mailto:a@b.com',
    });
  });

  it('keeps values containing an equals sign and ignores empty parts', () => {
    expect(parseDmarc('v=DMARC1;;p=none; x=a=b')).toEqual({
      v: 'DMARC1',
      p: 'none',
      x: 'a=b',
    });
  });
});

describe('checkEmailAuth', () => {
  it('passes every check on a correctly configured domain', () => {
    const results = checkEmailAuth('honedtech.com', GOOD);
    expect(isSendReady(results)).toBe(true);
    expect(countByStatus(results)).toEqual({ pass: 6, warn: 0, fail: 0 });
  });

  it('fails everything important on an unconfigured domain', () => {
    const results = checkEmailAuth('honedtech.com', EMPTY);
    expect(isSendReady(results)).toBe(false);
    const ids = results.filter((r) => r.status === 'fail').map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining(['inbound_mx', 'resend_dkim', 'send_spf', 'dmarc']),
    );
  });

  it('flags missing Cloudflare MX as a broken inbound path', () => {
    const r = byId({ ...GOOD, rootMx: ['mail.example.com'] }, 'inbound_mx');
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('No Cloudflare MX');
  });

  it('treats a missing apex SPF as a warning, not a blocker', () => {
    const r = byId({ ...GOOD, rootTxt: [] }, 'apex_spf');
    expect(r?.status).toBe('warn');
    expect(isSendReady(checkEmailAuth('honedtech.com', { ...GOOD, rootTxt: [] }))).toBe(true);
  });

  it('fails when the Resend DKIM key is absent', () => {
    const r = byId({ ...GOOD, dkimTxt: [] }, 'resend_dkim');
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('DMARC alignment');
  });

  it('ignores a DKIM record with no key material', () => {
    expect(byId({ ...GOOD, dkimTxt: ['v=DKIM1; k=rsa'] }, 'resend_dkim')?.status).toBe('fail');
  });

  it('fails a send SPF that omits amazonses.com', () => {
    const r = byId({ ...GOOD, sendTxt: ['v=spf1 include:example.com ~all'] }, 'send_spf');
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('missing amazonses.com');
  });

  it('fails a missing send SPF outright', () => {
    expect(byId({ ...GOOD, sendTxt: [] }, 'send_spf')?.detail).toContain('Missing');
  });

  it('warns rather than fails on missing bounce MX', () => {
    const r = byId({ ...GOOD, sendMx: [] }, 'send_mx');
    expect(r?.status).toBe('warn');
    expect(r?.detail).toContain('bounce handling');
  });

  it('reports the DMARC policy in use', () => {
    expect(byId(GOOD, 'dmarc')?.detail).toBe('p=none');
    const strict = byId(
      { ...GOOD, dmarcTxt: ['v=DMARC1; p=quarantine; rua=mailto:dmarc@honedtech.com'] },
      'dmarc',
    );
    expect(strict?.detail).toBe('p=quarantine');
  });

  it('defaults the policy to none when the tag is absent', () => {
    expect(byId({ ...GOOD, dmarcTxt: ['v=DMARC1; rua=mailto:dmarc@honedtech.com'] }, 'dmarc')?.detail).toBe(
      'p=none',
    );
  });

  it('notes when DMARC has no reporting address', () => {
    expect(byId({ ...GOOD, dmarcTxt: ['v=DMARC1; p=none'] }, 'dmarc')?.detail).toContain(
      'no rua',
    );
  });

  it('warns when reports go to another domain, which needs authorization there', () => {
    const snap = {
      ...GOOD,
      dmarcTxt: ['v=DMARC1; p=none; rua=mailto:dmarc@elsewhere.com'],
    };
    const r = byId(snap, 'dmarc_external_rua');
    expect(r?.status).toBe('warn');
    expect(r?.detail).toContain('_report._dmarc');
  });

  it('does not warn about Cloudflare or same-domain report addresses', () => {
    const snap = {
      ...GOOD,
      dmarcTxt: [
        'v=DMARC1; p=none; rua=mailto:abc@dmarc-reports.cloudflare.net,mailto:dmarc@honedtech.com',
      ],
    };
    expect(byId(snap, 'dmarc_external_rua')).toBeUndefined();
  });

  it('ignores rua entries that are not addresses', () => {
    const snap = { ...GOOD, dmarcTxt: ['v=DMARC1; p=none; rua=notanaddress'] };
    expect(byId(snap, 'dmarc_external_rua')).toBeUndefined();
  });
});
