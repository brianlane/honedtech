# Honed Tech - honedtech.com

Marketing site for Honed Tech: tech stack audits, lean web builds, and managed retainers.

Built the way we build for clients - a static [Astro](https://astro.build) site on
[Cloudflare Workers](https://developers.cloudflare.com/workers/), zero client-side
JavaScript, with one server endpoint for the contact form.

## Stack

- **Astro** (static output) with `@astrojs/cloudflare` for the single on-demand route
- **Cloudflare Workers + static assets** for hosting
- **Cloudflare Email Service** (`send_email` binding) - the contact form at
  `POST /api/contact` emails leads from `leads@honedtech.com`

### Branded addresses

All forward to the verified destination inbox, and a catch-all forwards
anything else so a typo never disappears silently.

| Address | Role |
|---|---|
| `brian@honedtech.com` | The human address. Outreach signature and Gmail send-as. |
| `hello@honedtech.com` | Public contact on the site and the Business Profile. |
| `support@honedtech.com` | Retainer and client support. |
| `leads@honedtech.com` | Machine sender only: form notifications and internal digests. Not shown publicly. |

Manage them with `wrangler email routing rules list honedtech.com`. Note that
wrangler auto-loads `.env`, and the `CLOUDFLARE_API_TOKEN` there lacks Email
Routing scope, so prefix these commands with
`env -u CLOUDFLARE_API_TOKEN` and `--env-file /dev/null` to use your OAuth
login instead.

### Sending as a human (outreach)

Inbound and outbound are deliberately different systems:

- **Inbound** is Cloudflare Email Routing, which forwards to the verified
  inbox. It has no SMTP server, so it cannot send.
- **Outbound** for anything a person signs is Resend, used as the SMTP server
  behind Gmail's "Send mail as". Gmail stays the interface.

Do not point Gmail's send-as at `smtp.gmail.com`. It works, but Google signs
DKIM as `gmail.com` and keeps a `gmail.com` Return-Path, so `honedtech.com`
gets neither aligned SPF nor aligned DKIM. DMARC then fails, some clients
append a visible "via gmail.com" tag, and cold mail is likelier to land in
spam. Resend signs as `honedtech.com`, which is the entire point.

Gmail settings: server `smtp.resend.com`, port `587`, username `resend`,
password is a Resend API key.

Keep honedtech in its **own Resend account**, separate from other projects.
Transactional providers prohibit unsolicited email, so if outreach ever draws
a complaint the suspension should not reach anything else.

Verify the DNS side any time, and always before sending from a new address:

```bash
npm run email:check                  # honedtech.com
npm run email:check -- knownapex.com # any domain
```

It checks inbound MX, apex SPF, the Resend DKIM key, the Return-Path SPF and
bounce MX on the `send` subdomain, and the DMARC policy, then exits non-zero
if mail sent as that domain would fail alignment.
- **Cloudflare Turnstile** (optional, config-gated) - bot protection on the
  contact form, on top of the honeypot field
- **Cloudflare Web Analytics** (optional, config-gated) - privacy-first beacon

## Development

```bash
npm install
npm run dev        # local dev server (workerd runtime)
npm run preview    # build + preview the production bundle locally
npm run check      # wrangler types + astro check (typecheck)
npm test           # vitest + coverage (100% gate, see below)
```

### Test coverage (100%, CI-gated)

Coverage is enforced at **100%** (statements, branches, functions, lines) and
is a hard CI gate: `npm test` runs vitest with coverage, and the v8
`thresholds` in [vitest.config.ts](vitest.config.ts) fail the run if anything
in scope drops below 100%. New logic must land with the tests that keep it
there.

Coverage scope is the `include` list in the vitest config:

- [x] `src/pages/api/**` (the contact endpoint; `cloudflare:workers` is
      stubbed via a resolve alias, siteverify `fetch` is mocked)

## Writing style: banned characters

The em dash (U+2014) is banned in any context: code, comments, docs, commit
messages, UI copy. Use a comma, colon, period, or plain hyphen instead. CI
fails if one appears in any tracked file. See [AGENTS.md](AGENTS.md).

## Workflow

Branch -> PR -> babysit CI to green -> merge. Never commit directly to main.
Production deploys run from CI on pushes to main.

## CI/CD ([.github/workflows/ci.yml](.github/workflows/ci.yml))

- **quality**: em dash guard, `astro check` typecheck, build
- **test**: vitest with the 100% coverage gate (coverage report uploaded as
  an artifact)
- **security**: `npm audit --omit=dev --audit-level=high` (non-blocking)
- **deploy-dry-run** (PR only): `wrangler deploy --dry-run` bundles the
  Worker exactly as a real deploy would, no API token needed
- **deploy** (push to main): `astro build && wrangler deploy`, using the
  `CLOUDFLARE_API_TOKEN` repository secret
- **CodeQL** ([codeql.yml](.github/workflows/codeql.yml)) on PRs, main, and a
  weekly schedule; **Dependabot** keeps npm and GitHub Actions current

## Deploy

```bash
npm run deploy     # astro build && wrangler deploy
```

Requires `wrangler login` (or `CLOUDFLARE_API_TOKEN` in `.env`) with access
to the Cloudflare account that owns the `honedtech.com` zone. Normally you
never do this by hand: merging to main deploys via CI.

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

## One-time Turnstile setup

Turnstile is fully wired but dormant until configured (the form keeps its
honeypot either way). To activate, in this order:

1. Create a **managed** Turnstile widget in the Cloudflare dashboard
   (Turnstile > Add widget) for `honedtech.com`, `www.honedtech.com`,
   `localhost`, and `127.0.0.1`.
2. Set the sitekey as the `PUBLIC_TURNSTILE_SITE_KEY` **repository variable**
   on GitHub (Settings > Secrets and variables > Actions > Variables) and
   deploy (merge or re-run the deploy job). The widget now renders on the
   form.
3. Set the widget secret on the Worker:
   `npx wrangler secret put TURNSTILE_SECRET_KEY`. From the next request on,
   `/api/contact` rejects submissions that fail siteverify.

Order matters: setting the secret before the sitekey is deployed would
reject every submission (no token in the form). The server skips
verification while the secret is unset, so steps 1-2 are safe on their own.

For local dev, Cloudflare's always-passing test keys work:
sitekey `1x00000000000000000000AA` in `.env`, secret
`1x0000000000000000000000000000000AA` in `.dev.vars` (see the `.example`
files).

## One-time Web Analytics setup

1. Cloudflare dashboard > Analytics & Logs > Web Analytics > add
   `honedtech.com` and copy the site token.
2. Set it as the `PUBLIC_CF_BEACON_TOKEN` repository variable on GitHub and
   deploy. Every page then renders the beacon script.

## Marketing

- **Cold outreach engine**: [outreach/README.md](outreach/README.md). Runs
  automatically on a weekday schedule
  ([prospector.yml](.github/workflows/prospector.yml)): discovers prospects via
  Google Places, probes their sites for detectable waste, composes
  evidence-based drafts, and emails a digest for manual review. Nothing is sent
  to a prospect without a human.
- **Google Business Profile copy**: [docs/gbp-content.md](docs/gbp-content.md),
  finished text for every profile field.
- **Outreach commands**: `prospect:status` (dashboard and follow-ups due),
  `prospect:sent`, `prospect:followup`, `prospect:reply`, `prospect:optout`.
  All read and write one shared ledger in Cloudflare KV.
- **Launch kit**: [docs/launch-kit.md](docs/launch-kit.md). Daily outreach
  rhythm, sending rules and CAN-SPAM baseline, reply FAQ, LinkedIn copy,
  Google Business Profile checklist, UTM conventions, and what to measure.
- **Vertical landing pages**: nine `/audits/<slug>` pages (see
  [src/data/verticals.ts](src/data/verticals.ts)) are both the SEO surface
  and the link targets for outreach.
- **Lead magnet**: `/calculator` estimates monthly tech waste and hands the
  itemized result to the contact form.

## Newsletter capture

The footer signup posts to `POST /api/subscribe`, which stores subscribers in
the `SUBSCRIBERS` Cloudflare KV namespace (honeypot protected, with optional
Turnstile verification when a token is present). `GET/POST /api/unsubscribe?token=`
removes a subscriber via their one-click token. This is capture-only: sending
a newsletter is manual or via a verified provider, since the free email plan
only sends to verified destinations. The KV namespace id is in
[wrangler.jsonc](wrangler.jsonc).

## SEO

- `robots.txt` and `sitemap-index.xml` (via `@astrojs/sitemap`; the thanks
  page is excluded)
- Open Graph + Twitter card tags with a static social card
  ([public/og.png](public/og.png))
- JSON-LD `ProfessionalService` schema on the homepage
