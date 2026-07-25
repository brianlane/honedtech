import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { POST } from '../src/pages/api/internal/digest';

type PostContext = Parameters<typeof POST>[0];

const DRAFT = {
  business: 'Acme <HVAC>',
  domain: 'acme.com',
  to: 'owner@acme.com',
  subject: 'Acme: about $39/mo in likely tech waste',
  body: 'Hi there,\n\nOne finding.\n',
  findingCount: 1,
};

function makeContext(body: unknown, secret?: string, raw?: string): PostContext {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== undefined) headers['x-digest-secret'] = secret;
  const request = new Request('http://localhost/api/internal/digest', {
    method: 'POST',
    headers,
    body: raw ?? JSON.stringify(body),
  });
  return { request } as unknown as PostContext;
}

beforeEach(() => {
  env.EMAIL = { send: vi.fn(async () => {}) };
  env.DIGEST_SECRET = 'top-secret';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete env.DIGEST_SECRET;
  vi.restoreAllMocks();
});

describe('POST /api/internal/digest', () => {
  it('returns 503 when the secret is not configured', async () => {
    delete env.DIGEST_SECRET;
    const res = await POST(makeContext({ drafts: [DRAFT] }, 'anything'));
    expect(res.status).toBe(503);
  });

  it('rejects a missing secret header', async () => {
    const res = await POST(makeContext({ drafts: [DRAFT] }));
    expect(res.status).toBe(403);
  });

  it('rejects a wrong secret of the same length', async () => {
    const res = await POST(makeContext({ drafts: [DRAFT] }, 'top-secreT'));
    expect(res.status).toBe(403);
  });

  it('rejects a wrong secret of a different length', async () => {
    const res = await POST(makeContext({ drafts: [DRAFT] }, 'short'));
    expect(res.status).toBe(403);
  });

  it('rejects an invalid JSON body', async () => {
    const res = await POST(makeContext(null, 'top-secret', '{not json'));
    expect(res.status).toBe(400);
  });

  it('rejects an empty payload with neither drafts nor follow-ups', async () => {
    const res = await POST(makeContext({ drafts: [], followUps: [] }, 'top-secret'));
    expect(res.status).toBe(400);
  });

  it('rejects a missing drafts field', async () => {
    const res = await POST(makeContext({}, 'top-secret'));
    expect(res.status).toBe(400);
  });

  it('ignores drafts missing a subject or body', async () => {
    const res = await POST(
      makeContext({ drafts: [{ business: 'No subject' }, null] }, 'top-secret'),
    );
    expect(res.status).toBe(400);
  });

  it('sends a follow-up only digest when there are no new drafts', async () => {
    const res = await POST(
      makeContext(
        { drafts: [], followUps: [{ domain: 'old.com', daysAgo: 7 }] },
        'top-secret',
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, followUps: 1 });

    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.subject).toBe('Outreach digest: 1 follow-up(s) due');
    expect(sent.text).toContain('No new drafts this morning');
    expect(sent.text).toContain('old.com (contacted 7 days ago)');
    expect(sent.html).toContain('Follow-ups due (1)');
  });

  it('combines drafts and follow-ups in one digest', async () => {
    const res = await POST(
      makeContext(
        { drafts: [DRAFT], followUps: [{ domain: 'old.com', daysAgo: 9 }] },
        'top-secret',
      ),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.subject).toBe('Outreach digest: 1 draft(s) ready, 1 follow-up(s) due');
  });

  it('drops follow-up entries with no domain and omits the section', async () => {
    const res = await POST(
      makeContext({ drafts: [DRAFT], followUps: [{ daysAgo: 5 }, null] }, 'top-secret'),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.subject).toBe('Outreach digest: 1 draft(s) ready');
    expect(sent.html).not.toContain('Follow-ups due');
  });

  it('omits the day count when it is not provided', async () => {
    const res = await POST(
      makeContext({ drafts: [], followUps: [{ domain: 'old.com' }] }, 'top-secret'),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).toContain('- old.com\n');
    expect(sent.html).toContain('<li>old.com</li>');
  });

  it('emails the digest and reports how many were sent', async () => {
    const res = await POST(makeContext({ drafts: [DRAFT] }, 'top-secret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, followUps: 0 });

    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.to).toBe('brianlane2@gmail.com');
    expect(sent.subject).toContain('1 draft(s) ready');
    expect(sent.text).toContain('owner@acme.com');
    expect(sent.text).toContain(DRAFT.subject);
    // Business names are escaped in the HTML part.
    expect(sent.html).toContain('Acme &lt;HVAC&gt;');
  });

  it('flags a draft with no contact email so it is not missed', async () => {
    const res = await POST(
      makeContext({ drafts: [{ ...DRAFT, to: '' }] }, 'top-secret'),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).toContain('NO EMAIL FOUND');
    expect(sent.html).toContain('NO EMAIL FOUND');
  });

  it('falls back through business, domain, then unknown in the heading', async () => {
    const res = await POST(
      makeContext(
        {
          drafts: [
            { subject: 's', body: 'b', domain: 'only-domain.com' },
            { subject: 's', body: 'b' },
          ],
        },
        'top-secret',
      ),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).toContain('only-domain.com');
    expect(sent.text).toContain('unknown');
  });

  it('returns 500 when the email send fails', async () => {
    env.EMAIL.send = vi.fn(async () => {
      throw new Error('send failed');
    });
    const res = await POST(makeContext({ drafts: [DRAFT] }, 'top-secret'));
    expect(res.status).toBe(500);
  });
});
