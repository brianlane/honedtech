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
  changes: ['Sent: 3 to 6 (+3)'],
  stats: { drafted: 6, sent: 6, pendingDrafts: 0, replyRate: 16.7 },
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
    expect(sent.text).toContain('Sent: 3 to 6 (+3)');
    // Drafted and sent are labelled apart, so neither can be read as the other.
    expect(sent.text).toContain('Drafted (in your review inbox): 6');
    expect(sent.text).toContain('Sent by hand from Gmail: 6');
    // Reply rate carries a percent sign, other counters do not.
    expect(sent.text).toContain('Reply rate (of sent): 16.7%');
    expect(sent.text).toContain('old.com');
    expect(sent.html).toContain('What changed this week');
  });

  // The state that started all this: drafts delivered, nothing sent. Left to a
  // counter alone it reads as progress, so the email says it in words.
  it('says outright when drafts are still waiting to be sent', async () => {
    const res = await POST(
      makeContext(
        { ...PAYLOAD, stats: { ...PAYLOAD.stats, sent: 0, pendingDrafts: 6 } },
        'top-secret',
      ),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).toContain('6 draft(s) are still waiting in your digest emails.');
    expect(sent.text).toContain('npm run prospect:sent');
    expect(sent.html).toContain('<strong>6 draft(s) are still waiting');
  });

  it('omits the pending note when nothing is waiting or the count is absent', async () => {
    const res = await POST(makeContext(PAYLOAD, 'top-secret'));
    expect(res.status).toBe(200);
    const withZero = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(withZero.text).not.toContain('still waiting');
    expect(withZero.html).not.toContain('still waiting');

    vi.mocked(env.EMAIL.send).mockClear();
    await POST(makeContext({ ...PAYLOAD, stats: { sent: 6 } }, 'top-secret'));
    const withNone = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(withNone.text).not.toContain('still waiting');
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
            { vertical: 'Pest Control', drafted: 5, sent: 3, replied: 1, booked: 1 },
            null,
            'junk',
            { vertical: 42, drafted: 5, sent: 3, replied: 1, booked: 1 },
            { vertical: 'HVAC & Plumbing', drafted: 'five', sent: 3, replied: 1, booked: 1 },
            { vertical: 'HVAC & Plumbing', drafted: 5, sent: 'three', replied: 1, booked: 1 },
            { vertical: 'HVAC & Plumbing', drafted: 5, sent: 3, replied: 'one', booked: 1 },
            { vertical: 'HVAC & Plumbing', drafted: 5, sent: 3, replied: 1, booked: 'one' },
          ],
        },
        'top-secret',
      ),
    );
    expect(res.status).toBe(200);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).toContain('By vertical:');
    expect(sent.text).toContain('Pest Control: 5 drafted, 3 sent, 1 replied, 1 booked');
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
      makeContext({ changes: [], stats: { drafted: 6 } }, 'top-secret'),
    );
    expect(res.status).toBe(200);
    // A forced send is the only way here, and a heading with nothing under it
    // reads like the email is broken.
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.text).toContain('Nothing moved since the last report.');
    expect(sent.html).toContain('Nothing moved since the last report.');
  });

  it('returns 500 when the email send fails', async () => {
    env.EMAIL.send = vi.fn(async () => {
      throw new Error('nope');
    });
    expect((await POST(makeContext(PAYLOAD, 'top-secret'))).status).toBe(500);
  });
});
