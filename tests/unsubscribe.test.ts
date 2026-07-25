import { beforeEach, describe, expect, it } from 'vitest';
import { env, MemoryKV } from 'cloudflare:workers';
import { GET, POST } from '../src/pages/api/unsubscribe';

type GetContext = Parameters<typeof GET>[0];

function ctx(token: string | null): GetContext {
  const url = new URL('http://localhost/api/unsubscribe');
  if (token !== null) url.searchParams.set('token', token);
  return { url } as unknown as GetContext;
}

beforeEach(() => {
  env.SUBSCRIBERS = new MemoryKV();
});

async function seed(email: string, token: string) {
  await env.SUBSCRIBERS.put(`sub:${email}`, JSON.stringify({ email, token }));
  await env.SUBSCRIBERS.put(`tok:${token}`, email);
}

describe('unsubscribe', () => {
  it('removes both keys for a valid token via GET', async () => {
    await seed('gone@example.com', 'tok-1');
    const res = await GET(ctx('tok-1'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('unsubscribed');
    expect(await env.SUBSCRIBERS.get('sub:gone@example.com')).toBeNull();
    expect(await env.SUBSCRIBERS.get('tok:tok-1')).toBeNull();
  });

  it('supports one-click POST', async () => {
    await seed('gone@example.com', 'tok-2');
    const res = await POST(ctx('tok-2'));
    expect(res.status).toBe(200);
    expect(await env.SUBSCRIBERS.get('tok:tok-2')).toBeNull();
  });

  it('reports success for an unknown token without touching storage', async () => {
    await seed('stay@example.com', 'real');
    const res = await GET(ctx('bogus'));
    expect(res.status).toBe(200);
    expect(await env.SUBSCRIBERS.get('sub:stay@example.com')).not.toBeNull();
  });

  it('reports success for a missing token', async () => {
    const res = await GET(ctx(null));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('unsubscribed');
  });

  it('handles a missing token on POST too', async () => {
    const res = await POST(ctx(null));
    expect(res.status).toBe(200);
  });
});
