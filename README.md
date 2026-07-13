# Honed Tech — honedtech.com

Marketing site for Honed Tech: tech stack audits, lean web builds, and managed retainers.

Built the way we build for clients — a static [Astro](https://astro.build) site on
[Cloudflare Workers](https://developers.cloudflare.com/workers/), zero client-side
JavaScript, with one server endpoint for the contact form.

## Stack

- **Astro** (static output) with `@astrojs/cloudflare` for the single on-demand route
- **Cloudflare Workers + static assets** for hosting
- **Cloudflare Email Service** (`send_email` binding) — the contact form at
  `POST /api/contact` emails leads from `leads@honedtech.com`

## Development

```bash
npm install
npm run dev        # local dev server (workerd runtime)
npm run preview    # build + preview the production bundle locally
```

## Deploy

```bash
npm run deploy     # astro build && wrangler deploy
```

Requires `wrangler login` with access to the Cloudflare account that owns the
`honedtech.com` zone.

## One-time domain setup (Cloudflare)

1. Add `honedtech.com` as a zone in the Cloudflare dashboard and point the
   nameservers at Cloudflare from the registrar.
2. Uncomment the `routes` block in `wrangler.jsonc` and redeploy to attach
   `honedtech.com` and `www.honedtech.com` to the Worker.
3. Enable email:
   - `npx wrangler email sending enable honedtech.com` (lets the form send from
     `leads@honedtech.com`)
   - Enable Email Routing on the zone and forward `leads@honedtech.com` to the
     destination inbox so replies/direct mail arrive too.

The lead destination address lives in `src/pages/api/contact.ts` (`LEAD_TO`).
