import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, MemoryKV } from 'cloudflare:workers';
import { POST } from '../src/pages/api/subscribe';

type PostContext = Parameters<typeof POST>[0];

function makeContext(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): PostContext {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const request = new Request('http://localhost/api/subscribe', {
    method: 'POST',
    body,
    headers,
  });
  const redirect = vi.fn(
    (path: string, status?: number) =>
      new Response(null, { status: status ?? 302, headers: { Location: path } }),
  );
  return { request, redirect } as unknown as PostContext;
}

beforeEach(() => {
  env.SUBSCRIBERS = new MemoryKV();
  delete env.TURNSTILE_SECRET_KEY;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/subscribe', () => {
  it('rejects a non-form body', async () => {
    const request = new Request('http://localhost/api/subscribe', {
      method: 'POST',
      body: 'x',
      headers: { 'Content-Type': 'text/plain' },
    });
    const res = await POST({ request, redirect: vi.fn() } as unknown as PostContext);
    expect(res.status).toBe(400);
  });

  it('silently succeeds and stores nothing when the honeypot is filled', async () => {
    const res = await POST(
      makeContext({ email: 'a@b.com', website: 'spam' }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/subscribed');
    expect(env.SUBSCRIBERS.store.size).toBe(0);
  });

  it('rejects an invalid email', async () => {
    const res = await POST(makeContext({ email: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('rejects when the email field is absent', async () => {
    const res = await POST(makeContext({}));
    expect(res.status).toBe(400);
  });

  it('rejects an overlong email', async () => {
    const res = await POST(makeContext({ email: `${'a'.repeat(250)}@x.com` }));
    expect(res.status).toBe(400);
  });

  it('stores a subscriber with an unsubscribe token and redirects', async () => {
    const res = await POST(makeContext({ email: 'New@Example.com' }));
    expect(res.status).toBe(303);
    const record = await env.SUBSCRIBERS.get('sub:new@example.com');
    expect(record).not.toBeNull();
    const parsed = JSON.parse(record as string);
    expect(parsed.email).toBe('new@example.com');
    expect(await env.SUBSCRIBERS.get(`tok:${parsed.token}`)).toBe('new@example.com');
  });

  it('is idempotent: a repeat subscribe keeps the original token', async () => {
    await POST(makeContext({ email: 'dup@example.com' }));
    const first = JSON.parse((await env.SUBSCRIBERS.get('sub:dup@example.com')) as string);
    await POST(makeContext({ email: 'dup@example.com' }));
    const second = JSON.parse((await env.SUBSCRIBERS.get('sub:dup@example.com')) as string);
    expect(second.token).toBe(first.token);
    expect(env.SUBSCRIBERS.store.size).toBe(2);
  });

  it('verifies Turnstile when a token and secret are present', async () => {
    env.TURNSTILE_SECRET_KEY = 'secret';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));
    const res = await POST(
      makeContext({ email: 'a@b.com', 'cf-turnstile-response': 'tok' }),
    );
    expect(res.status).toBe(403);
    expect(env.SUBSCRIBERS.store.size).toBe(0);
  });

  it('accepts when Turnstile passes, forwarding the client IP', async () => {
    env.TURNSTILE_SECRET_KEY = 'secret';
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(
      makeContext(
        { email: 'ok@example.com', 'cf-turnstile-response': 'tok' },
        { 'CF-Connecting-IP': '203.0.113.4' },
      ),
    );
    expect(res.status).toBe(303);
    const params = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams;
    expect(params.get('remoteip')).toBe('203.0.113.4');
  });

  it('skips Turnstile when the secret is set but no token is submitted', async () => {
    env.TURNSTILE_SECRET_KEY = 'secret';
    const fetchMock = vi.fn(async () => Response.json({ success: false }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(makeContext({ email: 'notoken@example.com' }));
    expect(res.status).toBe(303);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
