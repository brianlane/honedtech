import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { POST, headerSafe } from '../src/pages/api/contact';

type PostContext = Parameters<typeof POST>[0];

const VALID_FIELDS = {
  name: 'Jane Doe',
  business: 'Acme <Co> & "Sons"',
  email: 'jane@acme.com',
  message: 'Audit my stack, please.\nSecond line.',
};

function makeContext(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): PostContext {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.set(key, value);
  }
  const request = new Request('http://localhost/api/contact', {
    method: 'POST',
    body,
    headers,
  });
  const redirect = vi.fn(
    (path: string, status?: number) =>
      new Response(null, {
        status: status ?? 302,
        headers: { Location: path },
      }),
  );
  return { request, redirect } as unknown as PostContext;
}

function turnstileFetch(response: () => Promise<Response>) {
  const mock = vi.fn(response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  env.EMAIL = { send: vi.fn(async () => {}) };
  delete env.TURNSTILE_SECRET_KEY;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('headerSafe', () => {
  it('strips the line breaks that would end the header', () => {
    expect(headerSafe('Acme\r\nBcc: victim@example.com')).toBe(
      'Acme Bcc: victim@example.com',
    );
    expect(headerSafe('a\nb')).toBe('a b');
  });

  it('removes other control characters and collapses whitespace', () => {
    expect(headerSafe('Acme\u0000\u0007  \t Co')).toBe('Acme Co');
  });

  it('trims and caps the length', () => {
    expect(headerSafe('  padded  ')).toBe('padded');
    expect(headerSafe('x'.repeat(200))).toHaveLength(120);
    expect(headerSafe('abcdef', 3)).toBe('abc');
  });

  it('leaves an ordinary subject alone', () => {
    expect(headerSafe('Audit request: Acme (Jane)')).toBe('Audit request: Acme (Jane)');
  });
});

describe('POST /api/contact', () => {
  it('cannot be used to inject extra email headers', async () => {
    const res = await POST(
      makeContext({
        ...VALID_FIELDS,
        name: 'Jane\r\nBcc: attacker@evil.com',
        business: 'Acme\nX-Spoof: yes',
      }),
    );
    expect(res.status).toBe(303);
    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<string, unknown>;
    expect(sent.subject).not.toContain('\n');
    expect(sent.subject).not.toContain('\r');
    expect(sent.subject).toBe(
      'Audit request: Acme X-Spoof: yes (Jane Bcc: attacker@evil.com)',
    );
  });

  it('rejects a body that is not form data', async () => {
    const request = new Request('http://localhost/api/contact', {
      method: 'POST',
      body: 'not a form',
      headers: { 'Content-Type': 'text/plain' },
    });
    const res = await POST({
      request,
      redirect: vi.fn(),
    } as unknown as PostContext);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid form submission');
  });

  it('silently redirects when the honeypot field is filled', async () => {
    const ctx = makeContext({ ...VALID_FIELDS, website: 'http://spam.example' });
    const res = await POST(ctx);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/thanks');
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });

  it('rejects when every field is missing', async () => {
    const res = await POST(makeContext({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Missing required fields');
  });

  it('rejects when business is missing', async () => {
    const { business: _business, ...rest } = VALID_FIELDS;
    const res = await POST(makeContext(rest));
    expect(res.status).toBe(400);
  });

  it('rejects when email is missing', async () => {
    const { email: _email, ...rest } = VALID_FIELDS;
    const res = await POST(makeContext(rest));
    expect(res.status).toBe(400);
  });

  it('rejects when message is missing', async () => {
    const { message: _message, ...rest } = VALID_FIELDS;
    const res = await POST(makeContext(rest));
    expect(res.status).toBe(400);
  });

  it('rejects a malformed email address', async () => {
    const res = await POST(
      makeContext({ ...VALID_FIELDS, email: 'not-an-email' }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid email address');
  });

  it('rejects an overlong email address', async () => {
    const email = `${'a'.repeat(250)}@example.com`;
    const res = await POST(makeContext({ ...VALID_FIELDS, email }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid email address');
  });

  it('rejects an overlong name', async () => {
    const res = await POST(
      makeContext({ ...VALID_FIELDS, name: 'x'.repeat(201) }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Submission too long');
  });

  it('rejects an overlong business', async () => {
    const res = await POST(
      makeContext({ ...VALID_FIELDS, business: 'x'.repeat(201) }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an overlong message', async () => {
    const res = await POST(
      makeContext({ ...VALID_FIELDS, message: 'x'.repeat(5001) }),
    );
    expect(res.status).toBe(400);
  });

  it('sends the lead email and redirects on success', async () => {
    const ctx = makeContext({
      ...VALID_FIELDS,
      phone: '555-0100',
      spend: '$750+/mo',
    });
    const res = await POST(ctx);

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/thanks');
    expect(env.EMAIL.send).toHaveBeenCalledTimes(1);

    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(sent.to).toBe('honedtechcontact@gmail.com');
    expect(sent.replyTo).toBe(VALID_FIELDS.email);
    expect(sent.subject).toBe('Audit request: Acme <Co> & "Sons" (Jane Doe)');
    expect(sent.text).toContain('Phone: 555-0100');
    expect(sent.text).toContain('Monthly tech spend: $750+/mo');
    // HTML escaping and newline conversion (multipart encoding turns \n
    // into \r\n, so a stray \r may precede the <br>).
    expect(sent.html).toContain('Acme &lt;Co&gt; &amp; &quot;Sons&quot;');
    expect(sent.html).toMatch(/Audit my stack, please\.\r?<br>Second line\./);
  });

  it('falls back to placeholders when phone and spend are omitted', async () => {
    const res = await POST(makeContext(VALID_FIELDS));
    expect(res.status).toBe(303);

    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(sent.text).toContain('Phone: Not provided');
    expect(sent.text).toContain('Monthly tech spend: Not sure');
    expect(sent.html).toContain('Not provided');
    expect(sent.html).toContain('Not sure');
  });

  it('includes the interest field in subject, text, and html when set', async () => {
    const res = await POST(
      makeContext({ ...VALID_FIELDS, interest: 'Enterprise' }),
    );
    expect(res.status).toBe(303);

    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(sent.subject).toBe(
      'Enterprise audit request: Acme <Co> & "Sons" (Jane Doe)',
    );
    expect(sent.text).toContain('Interest: Enterprise');
    expect(sent.html).toContain(
      '<tr><td><strong>Interest</strong></td><td>Enterprise</td></tr>',
    );
  });

  it('omits the interest row and keeps the default subject when unset', async () => {
    const res = await POST(makeContext(VALID_FIELDS));
    expect(res.status).toBe(303);

    const sent = vi.mocked(env.EMAIL.send).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(sent.subject).toBe('Audit request: Acme <Co> & "Sons" (Jane Doe)');
    expect(sent.text).not.toContain('Interest:');
    expect(sent.html).not.toContain('<strong>Interest</strong>');
  });

  it('returns 500 when the email send fails', async () => {
    env.EMAIL.send = vi.fn(async () => {
      throw new Error('send blew up');
    });
    const res = await POST(makeContext(VALID_FIELDS));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('hello@honedtech.com');
  });
});

describe('Turnstile verification', () => {
  beforeEach(() => {
    env.TURNSTILE_SECRET_KEY = 'test-secret';
  });

  it('accepts a submission when siteverify succeeds, forwarding the client IP', async () => {
    const fetchMock = turnstileFetch(async () =>
      Response.json({ success: true }),
    );
    const ctx = makeContext(
      { ...VALID_FIELDS, 'cf-turnstile-response': 'tok-123' },
      { 'CF-Connecting-IP': '203.0.113.9' },
    );

    const res = await POST(ctx);
    expect(res.status).toBe(303);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const params = init.body as URLSearchParams;
    expect(params.get('secret')).toBe('test-secret');
    expect(params.get('response')).toBe('tok-123');
    expect(params.get('remoteip')).toBe('203.0.113.9');
  });

  it('omits remoteip when the header is absent', async () => {
    const fetchMock = turnstileFetch(async () =>
      Response.json({ success: true }),
    );
    const res = await POST(
      makeContext({ ...VALID_FIELDS, 'cf-turnstile-response': 'tok-123' }),
    );
    expect(res.status).toBe(303);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as URLSearchParams).has('remoteip')).toBe(false);
  });

  it('rejects when siteverify reports failure', async () => {
    turnstileFetch(async () => Response.json({ success: false }));
    const res = await POST(
      makeContext({ ...VALID_FIELDS, 'cf-turnstile-response': 'bad-token' }),
    );
    expect(res.status).toBe(403);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });

  it('rejects when the token is missing entirely', async () => {
    const fetchMock = turnstileFetch(async () =>
      Response.json({ success: false }),
    );
    const res = await POST(makeContext(VALID_FIELDS));
    expect(res.status).toBe(403);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as URLSearchParams).get('response')).toBe('');
  });

  it('rejects when siteverify returns a non-OK response', async () => {
    turnstileFetch(async () => new Response('oops', { status: 500 }));
    const res = await POST(
      makeContext({ ...VALID_FIELDS, 'cf-turnstile-response': 'tok' }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects when the siteverify request throws', async () => {
    turnstileFetch(async () => {
      throw new Error('network down');
    });
    const res = await POST(
      makeContext({ ...VALID_FIELDS, 'cf-turnstile-response': 'tok' }),
    );
    expect(res.status).toBe(403);
  });

  it('skips verification when no secret is configured', async () => {
    delete env.TURNSTILE_SECRET_KEY;
    const fetchMock = turnstileFetch(async () =>
      Response.json({ success: false }),
    );
    const res = await POST(makeContext(VALID_FIELDS));
    expect(res.status).toBe(303);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
