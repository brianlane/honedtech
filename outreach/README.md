# Prospector: cold outreach engine

Turns a list of businesses into personalized, evidence-based audit-pitch
emails. The pitch writes itself from what we can detect about each
prospect's public website (overpriced platform, unused Shopify plan, paid
email that free routing would replace, missing email auth, slow pages).

Classification logic lives in [../src/lib/prospect/](../src/lib/prospect/)
and is unit-tested at 100% coverage. The scripts here only do network I/O.

## Automated mode (default)

The [Prospector workflow](../.github/workflows/prospector.yml) runs weekday
mornings and does the whole chain for you: discovers new prospects through
Google Places, probes each site, composes drafts, and emails a digest to the
verified inbox. Nothing is sent to a prospect.

Your job is the last mile: read the digest, sanity-check each draft, send from
Gmail with send-as `leads@honedtech.com`, and reply-log anyone who opts out.

State lives in Cloudflare KV (`OUTREACH` namespace, key `outreach-ledger`), not
in local CSVs, because the scheduled runner is ephemeral. The ledger tracks
discovered, contacted, and opted-out domains so nothing is ever surfaced twice.

### Nobody gets emailed twice

Suppression works on two axes, because one address can front several
businesses (a shared owner, or the agency running both sites):

- **By domain**: anything discovered, contacted, or opted out is never
  surfaced again.
- **By address**: every address a digest was built for is recorded, and a
  later prospect whose scraped email matches is skipped even if its domain is
  brand new. Duplicates inside a single batch are caught too.

The scheduled run records this automatically once the digest is delivered. If
you email someone by hand or from another list, log it so the pipeline knows:

```bash
npm run prospect:sent -- acme.com owner@acme.com
npm run prospect:sent -- owner@acme.com     # an address implies its domain
```

### Follow-ups and outcomes

The digest lists anyone contacted five or more days ago with no reply on
record, capped at three weeks so the list never fills with stale prospects.
One nudge each is the policy, so marking it removes them permanently:

```bash
npm run prospect:followup -- theirdomain.com
```

Record what comes back. This stops follow-ups and feeds the reply rate:

```bash
npm run prospect:reply -- theirdomain.com replied
npm run prospect:reply -- theirdomain.com booked
npm run prospect:reply -- theirdomain.com declined   # also suppresses them
npm run prospect:reply -- theirdomain.com bounced    # also suppresses them
```

Check the numbers any time:

```bash
npm run prospect:status
```

### Weekly status email

A separate job ([status.yml](../.github/workflows/status.yml)) runs Mondays at
8am Phoenix and emails the same numbers, **but only when something changed
since the previous report**. A week where nothing moved sends nothing, so the
email keeps meaning something when it arrives.

The email leads with what changed ("Contacted: 3 to 6 (+3)", "Newly due for
follow-up: acme.com") and then lists current totals. Comparison state lives in
KV under `status-snapshot`, separate from the ledger. Note that a prospect
simply ageing from 7 to 8 days does not count as a change; becoming newly due
does.

Force a send, or preview one, with:

```bash
FORCE_STATUS=1 npm run prospect:status:email
DRY_RUN=1 npm run prospect:status:email     # print the changes, send nothing
```

### Honoring an opt-out

When someone replies asking to stop, suppress them immediately:

```bash
npm run prospect:optout -- theirdomain.com
# accepts several at once, and full URLs are fine
npm run prospect:optout -- acme.com https://www.other.com/contact
```

That writes to the shared ledger, so the scheduled run will never surface or
contact them again. The command is idempotent and tells you whether each
domain was newly suppressed or already on the list.

Run it by hand any time from the Actions tab (`workflow_dispatch`) with a
custom `limit`, or with `dry_run` to compose without emailing or writing the
ledger. Locally:

```bash
npm run prospect:pipeline -- 8      # discover up to 8 and email the digest
DRY_RUN=1 npm run prospect:pipeline # compose only, nothing sent or saved
```

Volume is capped at 12 new prospects per run by default, matching the 10 to 25
per day sending guidance that protects domain reputation.

## Manual mode (ad-hoc)

1. Build your list at `outreach/prospects.csv`, either by hand (see
   `prospects.example.csv`) or automatically:

   ```bash
   npm run prospect:discover -- 15    # appends 15 new prospects via Places
   ```

   ```csv
   business,domain,vertical,city,contactName
   Acme HVAC,acmehvac.com,HVAC & Plumbing,Phoenix,
   ```

   `vertical` should match a value from the site's vertical list so the
   email links to the right `/audits/<slug>` landing page. Discovery sets it
   for you.

2. Probe the domains:

   ```bash
   npm run prospect:audit -- outreach/prospects.csv
   ```

   Writes `outreach/findings.jsonl` (one record per prospect).

3. Compose drafts:

   ```bash
   npm run prospect:compose
   ```

   Writes one `outreach/drafts/<domain>.txt` per sendable prospect and a
   `outreach/review.md` index. Nothing is sent.

4. Review each draft, then send from Gmail with send-as
   `leads@honedtech.com`. Keep it to 10-25 sends/day to protect domain
   reputation.

5. After sending, append the domain to `outreach/outreach-log.csv` so it is
   never contacted again. If someone asks to stop, add them to
   `outreach/optout.csv`. Both lists suppress future composes.

## The calculator link in every email

When the detected findings map to priced calculator options (Shopify with no
store, a page builder, paid email), the draft carries a second link to
`/calculator?s=...` with those options preselected. A prospect who is not
ready to reply lands on their own numbers instead of a generic page, which is
the lowest-friction path we have to a conversation.

## Discovery details

Queries come from `searchTerms` on each entry in
[../src/data/verticals.ts](../src/data/verticals.ts), crossed with the Phoenix
metro cities in [../src/lib/prospect/discover.ts](../src/lib/prospect/discover.ts).
The plan rotates by day so coverage spreads across every trade and city instead
of exhausting one first.

Results are filtered before they ever reach you: no website means nothing to
audit, permanently closed businesses are dropped, and platform-hosted sites
(Facebook, Yelp, `business.site`, and similar) are excluded because there is no
stack of their own to review.

Cost note: the field mask requests `places.websiteUri`, which puts calls in a
higher-priced Places SKU. It is required, but do not widen the mask in
`scripts/lib/places.ts` without checking current pricing.

## Optional AI polish

Set `GEMINI_API_KEY` in the environment before `prospect:compose` to have
each draft rewritten for tone (facts and call-to-action unchanged, em dashes
stripped). Without the key, the deterministic template is used.

## Files (all gitignored except the .example templates)

- `prospects.csv` your input list
- `findings.jsonl` probe output
- `drafts/` composed emails
- `review.md` index of drafts
- `outreach-log.csv` domains already contacted (suppression)
- `optout.csv` domains that asked to stop (suppression)
