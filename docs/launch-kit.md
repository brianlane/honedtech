# Honed Tech launch kit

Everything needed to start generating leads. Content only, no code. Pair
this with the outreach engine in [../outreach/README.md](../outreach/README.md).

## The three lead sources, in priority order

1. **Cold outreach** (highest intent, fully in your control). Run
   `npm run prospect:audit` then `npm run prospect:compose`, review the
   drafts, send 10 to 25 per day from Gmail. This is the engine; everything
   else supports it.
2. **Vertical landing pages** (compounding, zero ongoing effort). The nine
   `/audits/<slug>` pages are the link targets for outreach and the SEO
   surface for "tech audit for <industry>" searches.
3. **Local presence** (Google Business Profile, referrals, LinkedIn). Slow
   burn, but it is what makes a cold prospect trust you when they search
   your name after reading the email.

## Daily rhythm (30 to 45 minutes)

- Add 10 to 20 new prospects to `outreach/prospects.csv`
- Run the audit and compose scripts
- Review every draft, fix anything the detector got wrong, send
- Log sent domains in `outreach/outreach-log.csv`
- Reply to responses same day; add opt-outs to `outreach/optout.csv`

Consistency beats volume. Twenty honest, specific emails a day is a real
pipeline. Two hundred generic ones gets your domain burned.

## Outreach rules (protect the domain and stay legal)

- **Never bulk-send.** Gmail send-as `leads@honedtech.com`, 10 to 25/day.
- **Every finding must be real.** The scripts only report what they detect.
  If a finding looks wrong when you review the draft, delete that line. One
  false claim costs more than ten sends gain.
- **Always include** the mailing address and the opt-out line (both are in
  the template already). That is CAN-SPAM baseline compliance.
- **Honor opt-outs immediately**, same day, no exceptions.
- **One follow-up maximum.** If no reply after 5 to 7 days, send a two-line
  nudge, then stop and move on.

### Follow-up template (send once, 5 to 7 days later)

> Subject: Re: [original subject]
>
> Hi [name], following up once on the note below. If cutting
> [$X]/month off your tech spend is not a priority right now, no problem at
> all and I will not chase it further.
>
> If it is, the audit is a flat $299 and takes a few days: [link]

## Outreach FAQ (answers for replies you will get)

**"How did you find me / where did you get my information?"**
Your business has a public website. I looked at what it runs on the same way
any visitor could, and reached out because I spotted something specific.
Nothing was purchased and nothing private was accessed.

**"Is this a scam / are you selling SEO?"**
No. Honed Tech is a Phoenix tech-stack audit practice. I get paid a flat
$299 to tell you exactly what you are overpaying for. Everything after that
is optional.

**"How do you know what we pay?"**
I do not, exactly, which is the point of the audit. What is publicly
detectable is what platforms you run. The dollar figures in my email are
that vendor's published pricing, so they are estimates until we look at your
actual invoices.

**"We are happy with our setup."**
Great, that is a legitimate answer. The audit is for people who suspect they
are paying for things they do not use. If that changes, I am here.

**"Can you just tell me for free?"**
The one or two things I already spotted are in the email, yours to keep. The
full review across every subscription, license, and tool is the paid part.

## LinkedIn launch post

> After years of building software, one thing kept surprising me about small
> businesses: how much they pay for tech they do not use.
>
> A Shopify subscription for a company that has never sold anything online.
> Paid email licenses when free routing does the same job. A page-builder
> website costing a monthly fee to load slowly.
>
> It is rarely anybody's fault. A vendor sold it, it got set up once, and
> nobody revisited it. The waste just compounds quietly.
>
> So I started Honed Tech. It works in three steps: I audit your stack and
> tell you exactly what is wasted, I cut or rebuild what needs it, and I keep
> it lean going forward. The audit is a flat $299 and usually pays for itself
> in the first month.
>
> If you have ever looked at a subscription and thought "what is this even
> for," that is the whole business.
>
> honedtech.com

### Follow-up post ideas (one a week, no calendar pressure)

- A specific anonymized finding: "Found a client paying $39/month for
  Shopify with no store attached. Here is how that happens."
- The AI angle: software bought, rolled out, never adopted, still billing.
  Ties to the Enterprise offering.
- A teardown of what a small business actually needs to pay for (domain,
  hosting, and not much else).

## Google Business Profile checklist

1. Create the profile at [google.com/business](https://www.google.com/business/)
   as a **service-area business** (Phoenix / Scottsdale metro), not a
   storefront, so no address is published.
2. Category: primary **Business management consultant**; secondary
   **Website designer** and **Computer consultant**.
3. Add: `honedtech.com` as the website, `leads@honedtech.com`, service area,
   and hours.
4. Services: list them with prices matching the site (Snapshot Audit $299,
   Deep Dive $599, Enterprise Audit $2,499+, Web Builds, Retainers).
5. Upload the logo and the social card from `public/og.png`.
6. Write the description using the homepage copy, keeping "tech stack audit"
   and "Phoenix" in the first sentence.
7. **Ask every completed client for a review.** This is the single highest
   leverage local SEO action available.

## UTM conventions

Keep these exact values so analytics stays readable:

| Source | `utm_source` | `utm_medium` | `utm_campaign` |
|---|---|---|---|
| Cold outreach email | `outreach` | `email` | `prospector` |
| LinkedIn post | `linkedin` | `social` | `launch` |
| Google Business Profile | `gbp` | `local` | `profile` |
| Business card / QR | `print` | `offline` | `card` |

The outreach scripts already apply the first row automatically. Traffic
shows up in Cloudflare Web Analytics (Analytics and Logs, Web Analytics).

## What to measure in the first 90 days

- Emails sent per week (input you control)
- Reply rate (aim for 5 to 10% on genuinely specific emails)
- Calls booked, then audits sold
- Audit to fix-work conversion, the number that actually determines revenue

If reply rate is under 3%, the findings are too generic before the volume is
too low. Fix specificity first.
