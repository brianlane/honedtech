import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Honed Tech</title><meta name="robots" content="noindex"></head><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#06121f;color:#e8eef4;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><div style="max-width:440px;padding:32px;text-align:center"><h1 style="color:#2dd4bf">${title}</h1><p style="color:#9fb3c4">${body}</p><a href="/" style="color:#2dd4bf">Back to honedtech.com</a></div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// Removes a subscriber by their unsubscribe token. Supports GET (link in an
// email) and POST (RFC 8058 one-click). Always reports success to avoid
// leaking whether a token was valid.
async function unsubscribe(token: string): Promise<Response> {
  const trimmed = token.trim();
  if (trimmed) {
    const email = await env.SUBSCRIBERS.get(`tok:${trimmed}`);
    if (email) {
      await env.SUBSCRIBERS.delete(`sub:${email}`);
      await env.SUBSCRIBERS.delete(`tok:${trimmed}`);
    }
  }
  return page(
    'You are unsubscribed',
    'You will no longer receive emails from Honed Tech. Sorry to see you go.',
  );
}

export const GET: APIRoute = ({ url }) =>
  unsubscribe(url.searchParams.get('token') ?? '');

export const POST: APIRoute = ({ url }) =>
  unsubscribe(url.searchParams.get('token') ?? '');
