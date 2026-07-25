import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyTurnstile } from '../../lib/turnstile';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, redirect }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Invalid form submission', { status: 400 });
  }

  // Honeypot: pretend success so bots get no signal.
  if ((form.get('website') as string)?.trim()) {
    return redirect('/subscribed', 303);
  }

  const email = ((form.get('email') as string) ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return new Response('Please enter a valid email address.', { status: 400 });
  }

  // Turnstile is verified only when a token is present and the secret is set
  // (the footer form has no widget, so this is defense in depth, not a gate).
  const secret = (env as { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY;
  const token = ((form.get('cf-turnstile-response') as string) ?? '').trim();
  if (secret && token) {
    const ok = await verifyTurnstile(
      secret,
      token,
      request.headers.get('CF-Connecting-IP'),
    );
    if (!ok) {
      return new Response('Verification failed. Please try again.', {
        status: 403,
      });
    }
  }

  // Idempotent: an existing subscriber keeps their original unsubscribe token.
  const existing = await env.SUBSCRIBERS.get(`sub:${email}`);
  if (!existing) {
    const unsubToken = crypto.randomUUID();
    await env.SUBSCRIBERS.put(
      `sub:${email}`,
      JSON.stringify({
        email,
        token: unsubToken,
        subscribedAt: new Date().toISOString(),
      }),
    );
    await env.SUBSCRIBERS.put(`tok:${unsubToken}`, email);
  }

  return redirect('/subscribed', 303);
};
