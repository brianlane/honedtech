import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { POST } from '../src/pages/api/internal/status';

type PostContext = Parameters<typeof POST>[0];

function makeContext(body: unknown, secret?: string, raw?: string): PostContext {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== undefined) headers['x-digest-secret'] = secret;
  const request = new Request('http://localhost/api/internal/status', {
    method: 'POST',
    headers,
    body: raw ?? JSON.stringify(body),
  });
  return { request } as unknown as PostContext;
}

const PAYLOAD = {
  changes: ['Contacted: 3 to 6 (+3)'],
  stats: { contacted: 6, replyRate: 16.7 },
  dueDomains: ['old.com'],
};

beforeEach(() => {
  env.EMAIL = { send: vi.fn(async () => {}) };
  env.DIGEST_SECRET = 'top-secret';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete env.DIGEST_SECRET;
  vi.restoreAllMocks();
});

describe('POST /api/internal/status', () => {
  it('returns 503 when the secret is not configured', async () => {
    delete env.DIGEST_SECRET;
    expect((await POST(makeContext(PAYLOAD, 'x'))).status).toBe(503);
  });

  it('rejects a missing or wrong secret', async () => {
    expect((await POST(makeContext(PAYLOAD))).status).toBe(403);
    expect((await POST(makeContext(PAYLOAD, 'wrong-secret'))).status).toBe(403);
  });

  it('rejects invalid JSON', async () => {
    expect((await POST(makeContext(null, 'top-secret', '{nope'))).status).toBe(400);
  });

  it('rejects a payload with nothing to report', async () => {
    expect((await POST(makeContext({}, 'top-secret'))).status).toBe(400);
    expect(
      (await POST(makeContext({ changes: [], stats: {} }, 'top-secret'))).status,
    ).toBe(400);
  });

  it('emails the changes, totals, and due list', async () => {
    const res = await POST(makeContext(PAYLOAD, 'top-secret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true, changes: 1 });

    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.subject).toBe('Outreach weekly status: 1 change(s)');
    expect(sent.text).toContain('Contacted: 3 to 6 (+3)');
    expect(sent.text).toContain('Contacted: 6');
    // Reply rate carries a percent sign, other counters do not.
    expect(sent.text).toContain('Reply rate: 16.7%');
    expect(sent.text).toContain('old.com');
    expect(sent.html).toContain('What changed this week');
  });

  it('says so plainly when no follow-ups are due', async () => {
    const res = await POST(
      makeContext({ ...PAYLOAD, dueDomains: [] }, 'top-secret'),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).toContain('No follow-ups due.');
    expect(sent.html).toContain('No follow-ups due.');
  });

  it('renders the per-vertical breakdown when provided, dropping malformed rows', async () => {
    const res = await POST(
      makeContext(
        {
          ...PAYLOAD,
          byVertical: [
            { vertical: 'Pest Control', contacted: 5, replied: 1, booked: 1 },
            null,
            'junk',
            { vertical: 42, contacted: 5, replied: 1, booked: 1 },
            { vertical: 'HVAC & Plumbing', contacted: 'five', replied: 1, booked: 1 },
            { vertical: 'HVAC & Plumbing', contacted: 5, replied: 'one', booked: 1 },
            { vertical: 'HVAC & Plumbing', contacted: 5, replied: 1, booked: 'one' },
          ],
        },
        'top-secret',
      ),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).toContain('By vertical:');
    expect(sent.text).toContain('Pest Control: 5 contacted, 1 replied, 1 booked');
    expect(sent.text).not.toContain('HVAC');
    expect(sent.html).toContain('<h3>By vertical</h3>');
  });

  it('omits the vertical section when the breakdown is absent or empty', async () => {
    const res = await POST(makeContext({ ...PAYLOAD, byVertical: [] }, 'top-secret'));
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).not.toContain('By vertical:');
    expect(sent.html).not.toContain('By vertical');
  });

  it('falls back to the raw key for an unlabeled stat and drops junk entries', async () => {
    const res = await POST(
      makeContext(
        { changes: ['x', 42], stats: { somethingNew: 3 }, dueDomains: ['a.com', 7] },
        'top-secret',
      ),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).toContain('somethingNew: 3');
    expect(sent.text).not.toContain('42');
    expect(sent.text).not.toContain('- 7');
  });

  it('reports stats even when the change list is empty, if forced', async () => {
    const res = await POST(
      makeContext({ changes: [], stats: { contacted: 6 } }, 'top-secret'),
    );
    expect(res.status).toBe(200);
  });

  it('returns 500 when the email send fails', async () => {
    env.EMAIL.send = vi.fn(async () => {
      throw new Error('nope');
    });
    expect((await POST(makeContext(PAYLOAD, 'top-secret'))).status).toBe(500);
  });
});
