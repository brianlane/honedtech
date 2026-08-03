// prospect:pipeline - the scheduled end-to-end run: discover, probe, classify,
// compose, then email the drafts digest. State lives in Cloudflare KV so the
// ephemeral CI runner never rediscovers or re-contacts a domain.
//
// Nothing is sent to prospects. The digest goes to the verified inbox and a
// human sends from Gmail after reviewing each draft.
//
// Usage:
//   npm run prospect:pipeline            # default limit
//   npm run prospect:pipeline -- 8       # cap new prospects this run
//
// Env: GOOGLE_PLACES_API_KEY, CLOUDFLARE_API_TOKEN, OUTREACH_KV_NAMESPACE_ID,
//      DIGEST_URL, DIGEST_SECRET, optional GEMINI_API_KEY, optional DRY_RUN=1
import { buildFindings } from '../src/lib/prospect/findings';
import { extractContactEmail } from '../src/lib/prospect/contact';
import { composeEmail, type Prospect } from '../src/lib/prospect/compose';
import {
  dueForFollowUp,
  ledgerKnownDomains,
  ledgerKnownEmails,
  normalizeEmail,
  recordContacted,
  recordDiscovered,
} from '../src/lib/prospect/ledger';
import type { Finding } from '../src/lib/prospect/types';
import { discoverProspects } from './lib/places';
import { probeDomain } from './lib/probe';
import { LEDGER_KEY, readLedgerStrict, requiredEnv, saveLedgerMerged } from './lib/ledger-io';
import { parseRunLimit } from '../src/lib/prospect/limits';
import { polishWithGemini } from './lib/polish';

interface Draft {
  business: string;
  domain: string;
  to: string;
  subject: string;
  body: string;
  findingCount: number;
}

async function main() {
  const limit = parseRunLimit(process.argv[2] ?? process.env.PROSPECT_LIMIT, 12);
  const dryRun = process.env.DRY_RUN === '1';

  const placesKey = requiredEnv('GOOGLE_PLACES_API_KEY');
  const cfToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const namespaceId = requiredEnv('OUTREACH_KV_NAMESPACE_ID');

  console.log(`Pipeline start (limit ${limit}${dryRun ? ', dry run' : ''})`);

  const ledger = await readLedgerStrict(cfToken, namespaceId, LEDGER_KEY);
  const known = ledgerKnownDomains(ledger);
  const knownEmails = ledgerKnownEmails(ledger);
  console.log(
    `Ledger: ${known.size} known domain(s), ${knownEmails.size} address(es) already drafted to`,
  );

  // Owed follow-ups ride along in the same digest, so there is only ever one
  // email to read in the morning.
  const followUps = dueForFollowUp(ledger).map((f) => ({
    domain: f.domain,
    daysAgo: f.daysAgo,
  }));
  if (followUps.length > 0) {
    console.log(`Follow-ups due: ${followUps.length}`);
  }

  const prospects = await discoverProspects({ apiKey: placesKey, known, limit });
  if (prospects.length === 0 && followUps.length === 0) {
    console.log('No new prospects and no follow-ups due. Nothing to send.');
    return;
  }

  const drafts: Draft[] = [];
  // Which trade each drafted domain was discovered under, recorded so the
  // per-vertical outcome breakdown has something to group by.
  const verticalByDomain: Record<string, string> = {};
  for (const prospect of prospects) {
    process.stdout.write(`Probing ${prospect.domain} ... `);
    const probe = await probeDomain(prospect.domain);
    const findings: Finding[] = buildFindings(probe);
    // A prospect with nothing detectable has no honest pitch, so skip it.
    if (findings.length === 0) {
      console.log('no findings, skipped');
      continue;
    }
    // One address can front several businesses, so a domain we have never
    // seen can still resolve to somebody already emailed. Never email twice.
    const to = extractContactEmail(probe.html ?? '', probe.domain) ?? '';
    if (to && knownEmails.has(normalizeEmail(to))) {
      console.log(`${to} already emailed, skipped`);
      continue;
    }
    if (to) {
      // Guard against two prospects in this same batch sharing an address.
      knownEmails.add(normalizeEmail(to));
    }

    if (prospect.vertical) {
      verticalByDomain[prospect.domain] = prospect.vertical;
    }
    const email = composeEmail(prospect, findings);
    const body = await polishWithGemini(email.body);
    drafts.push({
      business: prospect.business,
      domain: prospect.domain,
      to,
      subject: email.subject,
      body,
      findingCount: findings.length,
    });
    console.log(`${findings.length} finding(s), draft ready`);
  }

  // Discovered domains are recorded even when skipped, so a dead end is never
  // probed twice on a later run.
  let updated = recordDiscovered(
    ledger,
    prospects.map((p: Prospect) => p.domain),
  );

  if (dryRun) {
    console.log(
      `\nDry run: ${drafts.length} draft(s), ${followUps.length} follow-up(s), ledger not written.`,
    );
    for (const d of drafts) console.log(`  ${d.business} <${d.to || 'no email found'}>`);
    for (const f of followUps) console.log(`  follow up: ${f.domain} (${f.daysAgo}d)`);
    return;
  }

  if (drafts.length > 0 || followUps.length > 0) {
    const digestUrl = requiredEnv('DIGEST_URL');
    const digestSecret = requiredEnv('DIGEST_SECRET');

    // Recorded as DRAFTED, not as sent: these are about to land in our own
    // review inbox, and only a human sending one from Gmail (logged with
    // prospect:sent) counts as outreach.
    //
    // Recorded BEFORE the digest goes out. Sending first and recording after
    // leaves a window where the digest is in the inbox but KV still shows the
    // domains undrafted, and the next run then drafts the same people again.
    // Recording first can cost a prospect if the send fails, which against
    // thousands of in-window candidates is cheap. Drafting someone twice and
    // emailing them twice is not.
    updated = recordContacted(
      updated,
      drafts.map((d) => d.domain),
      drafts.map((d) => d.to).filter((to) => to.length > 0),
      new Date(),
      verticalByDomain,
    );
    // Merged rather than overwritten: a hand-run optout or reply landing while
    // this pipeline was working must not be erased by our older snapshot.
    await saveLedgerMerged(cfToken, namespaceId, LEDGER_KEY, updated);

    const res = await fetch(digestUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-digest-secret': digestSecret,
      },
      body: JSON.stringify({ drafts, followUps }),
    });
    if (!res.ok) {
      throw new Error(
        `Digest send failed (${res.status}): ${(await res.text()).slice(0, 300)}. ` +
          'These prospects are already recorded as drafted and will not be surfaced again.',
      );
    }
    console.log(
      `\nDigest emailed: ${drafts.length} draft(s), ${followUps.length} follow-up(s).`,
    );
  } else {
    await saveLedgerMerged(cfToken, namespaceId, LEDGER_KEY, updated);
  }

  console.log(
    `Ledger updated: ${updated.discovered.length} discovered, ` +
      `${updated.contacted.length} drafted, ` +
      `${updated.contactedEmails.length} address(es) in drafts. ` +
      'None of these have been sent to a prospect.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
