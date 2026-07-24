# Prospector: cold outreach engine

Turns a list of businesses into personalized, evidence-based audit-pitch
emails. The pitch writes itself from what we can detect about each
prospect's public website (overpriced platform, unused Shopify plan, paid
email that free routing would replace, missing email auth, slow pages).

Classification logic lives in [../src/lib/prospect/](../src/lib/prospect/)
and is unit-tested at 100% coverage. The scripts here only do network I/O.

## Workflow

1. Build your list at `outreach/prospects.csv` (see `prospects.example.csv`):

   ```csv
   business,domain,vertical,city,contactName
   Acme HVAC,acmehvac.com,HVAC & Plumbing,Phoenix,
   ```

   `vertical` should match a value from the site's vertical list so the
   email links to the right `/audits/<slug>` landing page.

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
