import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Must be a verified Email Routing destination address (free-plan sends
// are only allowed to verified destinations).
const LEAD_TO = 'brianlane2@gmail.com';
const LEAD_FROM = { email: 'leads@honedtech.com', name: 'Honed Tech Website' };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const POST: APIRoute = async ({ request, redirect }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Invalid form submission', { status: 400 });
  }

  // Honeypot: real users never fill this hidden field.
  if ((form.get('website') as string)?.trim()) {
    return redirect('/thanks', 303);
  }

  const name = ((form.get('name') as string) ?? '').trim();
  const business = ((form.get('business') as string) ?? '').trim();
  const email = ((form.get('email') as string) ?? '').trim();
  const phone = ((form.get('phone') as string) ?? '').trim();
  const spend = ((form.get('spend') as string) ?? '').trim();
  const message = ((form.get('message') as string) ?? '').trim();

  if (!name || !business || !email || !message) {
    return new Response('Missing required fields', { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return new Response('Invalid email address', { status: 400 });
  }
  if (name.length > 200 || business.length > 200 || message.length > 5000) {
    return new Response('Submission too long', { status: 400 });
  }

  const lines = [
    `Name: ${name}`,
    `Business: ${business}`,
    `Email: ${email}`,
    `Phone: ${phone || 'Not provided'}`,
    `Monthly tech spend: ${spend || 'Not sure'}`,
    '',
    'Message:',
    message,
  ];

  const html = `
    <h2>New audit request from honedtech.com</h2>
    <table cellpadding="6" style="border-collapse:collapse">
      <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
      <tr><td><strong>Business</strong></td><td>${escapeHtml(business)}</td></tr>
      <tr><td><strong>Email</strong></td><td>${escapeHtml(email)}</td></tr>
      <tr><td><strong>Phone</strong></td><td>${escapeHtml(phone) || 'Not provided'}</td></tr>
      <tr><td><strong>Monthly tech spend</strong></td><td>${escapeHtml(spend) || 'Not sure'}</td></tr>
    </table>
    <h3>Message</h3>
    <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
  `;

  try {
    await env.EMAIL.send({
      to: LEAD_TO,
      from: LEAD_FROM,
      replyTo: email,
      subject: `Audit request: ${business} (${name})`,
      text: lines.join('\n'),
      html,
    });
  } catch (error) {
    console.error('Lead email failed:', error);
    return new Response(
      'Something went wrong sending your request. Please email leads@honedtech.com directly.',
      { status: 500 },
    );
  }

  return redirect('/thanks', 303);
};
