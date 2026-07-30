// enterprise:pipeline - the weekly Enterprise run. Unlike the SMB prospector,
// which finds local businesses by trade and city, this one starts from a
// trigger event: a WARN Act layoff filing that has aged past the decency
// window. It then resolves the employer to a domain, reads their public job
// board for stack overlap, ranks what it found, and emails a digest.
//
// Nothing is sent to a prospect, and the digest deliberately carries no
// recipient address. Enterprise contact discovery stays manual, because free
// public signals cannot produce a verified executive address and guessing
// first.last@ patterns burns the sending domain.
//
// Usage:
//   npm run enterprise:pipeline           # default limit
//   npm run enterprise:pipeline -- 5      # cap accounts this run
//
// Env: CLOUDFLARE_API_TOKEN, OUTREACH_KV_NAMESPACE_ID, DIGEST_URL,
//      DIGEST_SECRET, GOOGLE_PLACES_API_KEY, optional WARN_API_URL,
//      WARN_API_KEY, WARN_STATES, DRY_RUN=1
import { composeEnterpriseEmail } from '../src/lib/enterprise/brief';
import { rankAccounts, totalMonthlyReclaim } from '../src/lib/enterprise/score';
import { stackSignals } from '../src/lib/enterprise/stack';
import { warnSignal } from '../src/lib/enterprise/warn';
import type {
  AccountSignal,
  EnterpriseAccount,
} from '../src/lib/enterprise/types';
import {
  ledgerKnownDomains,
  recordContacted,
  recordDiscovered,
} from '../src/lib/prospect/ledger';
import { fetchWarnRecords } from './lib/warn-source';
import { resolveCompanyDomain } from './lib/places';
import { fetchJobPostings } from './lib/ats-fetch';
import {
  ENTERPRISE_LEDGER_KEY,
  readLedgerStrict,
  requiredEnv,
  saveLedgerMerged,
} from './lib/ledger-io';
import { parseRunLimit } from '../src/lib/prospect/limits';
import { resolveWarnStates } from '../src/lib/enterprise/states';

// How many accounts to research per account contacted. Three keeps the extra
// Places spend modest while giving the score a real choice to make.
const POOL_MULTIPLIER = 3;

interface Draft {
  business: string;
  domain: string;
  to: string;
  subject: string;
  body: string;
  brief: string[];
  findingCount: number;
}

async function main() {
  const limit = parseRunLimit(process.argv[2] ?? process.env.ENTERPRISE_LIMIT, 6);
  const dryRun = process.env.DRY_RUN === '1';

  const cfToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const namespaceId = requiredEnv('OUTREACH_KV_NAMESPACE_ID');
  const placesKey = requiredEnv('GOOGLE_PLACES_API_KEY');
  const states = resolveWarnStates(
    process.env.GITHUB_EVENT_NAME,
    process.env.WARN_STATES,
    process.env.WARN_STATES_DEFAULT,
  );

  console.log(`Enterprise pipeline start (limit ${limit}${dryRun ? ', dry run' : ''})`);

  const ledger = await readLedgerStrict(cfToken, namespaceId, ENTERPRISE_LEDGER_KEY);
  const known = ledgerKnownDomains(ledger);
  console.log(`Ledger: ${known.size} known domain(s)`);

  const records = await fetchWarnRecords({ states });
  console.log(
    `WARN: ${records.length} filing(s) inside the contact window${
      states.length ? ` for ${states.join(', ')}` : ''
    }`,
  );
  if (records.length === 0) {
    console.log('Nothing to work with this week.');
    return;
  }

  const accounts: EnterpriseAccount[] = [];

  // Research more accounts than we will contact, then let the score choose.
  //
  // Stopping at the first `limit` that resolved meant ranking only reordered
  // a set already fixed by WARN freshness, so a stronger account further down
  // the list was never researched at all. Researching a wider pool and taking
  // the best costs a few more Places lookups per run, which is the right
  // trade when the alternative is mailing the merely-earliest.
  const researchPool = limit * POOL_MULTIPLIER;

  for (const record of records) {
    if (accounts.length >= researchPool) {
      break;
    }
    const layoff = warnSignal(record);
    // Outside the window, or no headcount published to reason about.
    if (!layoff) {
      continue;
    }

    process.stdout.write(`Resolving ${record.employer} ... `);
    const domain = await resolveCompanyDomain(placesKey, record.employer, record.city);
    if (!domain) {
      console.log('no domain found, skipped');
      continue;
    }
    if (known.has(domain)) {
      console.log(`${domain} already known, skipped`);
      continue;
    }
    // Guard against two filings in this same batch resolving to one company.
    known.add(domain);

    const signals: AccountSignal[] = [layoff];
    const postings = await fetchJobPostings(domain);
    if (postings.length > 0) {
      signals.push(...stackSignals(postings));
    }

    accounts.push({
      company: record.employer,
      domain,
      city: record.city,
      state: record.state,
      signals,
    });
    console.log(
      `${domain}, ${signals.length} signal(s), ${postings.length} posting(s)`,
    );
  }

  if (accounts.length === 0) {
    console.log('No contactable accounts this week.');
    return;
  }

  // Rank the whole researched pool, then keep the strongest `limit`. The cap
  // applies here rather than to research, so the score decides who gets
  // contacted instead of whoever WARN happened to list first.
  const chosen = rankAccounts(accounts).slice(0, limit);
  console.log(
    `\nResearched ${accounts.length} account(s), contacting the top ${chosen.length}.`,
  );

  const drafts: Draft[] = chosen.map((account) => {
    const composed = composeEnterpriseEmail(account);
    return {
      business: account.company,
      domain: account.domain,
      // Always empty: the named executive is looked up by hand.
      to: '',
      subject: composed.subject,
      body: composed.body,
      brief: composed.brief,
      findingCount: account.signals.length,
    };
  });

  // Every resolved domain is recorded even when it does not become a draft, so
  // a dead end is never paid for at the Places API twice.
  // Only the accounts we are actually drafting get recorded.
  //
  // Marking the whole research pool discovered would suppress it forever,
  // because ledgerKnownDomains treats discovered as ineligible. Researching
  // three times the cap and then permanently burning the two thirds that
  // scored lower is exactly backwards: those are strong accounts we chose not
  // to mail yet. They cost another Places lookup when they resurface, which
  // is far cheaper than never contacting them, and their filing ages out of
  // the window on its own.
  let updated = recordDiscovered(
    ledger,
    chosen.map((account) => account.domain),
  );

  if (dryRun) {
    console.log(`\nDry run: ${drafts.length} draft(s), ledger not written.`);
    for (const d of drafts) {
      console.log(`\n=== ${d.business} (${d.domain}) ===`);
      for (const line of d.brief) console.log(`  ${line}`);
    }
    return;
  }

  const digestUrl = required('DIGEST_URL');
  const digestSecret = required('DIGEST_SECRET');

  // Recorded as DRAFTED before the digest goes out, same reasoning as the SMB
  // pipeline: sending first leaves a window where the digest exists but KV
  // still shows these accounts undrafted, and next week researches and mails
  // them again. Enterprise drafts carry no address at all, so the send is
  // always a manual step logged with prospect:sent.
  updated = recordContacted(
    updated,
    drafts.map((d) => d.domain),
  );
  await saveLedgerMerged(cfToken, namespaceId, ENTERPRISE_LEDGER_KEY, updated);

  const res = await fetch(digestUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-digest-secret': digestSecret,
    },
    body: JSON.stringify({ drafts, kind: 'enterprise' }),
  });
  if (!res.ok) {
    throw new Error(
      `Digest send failed (${res.status}): ${(await res.text()).slice(0, 300)}. ` +
        'These accounts are already recorded as drafted and will not be surfaced again.',
    );
  }
  console.log(`\nDigest emailed: ${drafts.length} account(s).`);

  const totalReclaim = drafts.reduce(
    (sum, d) => sum + totalMonthlyReclaim(accounts.find((a) => a.domain === d.domain)?.signals ?? []),
    0,
  );
  console.log(`Estimated combined reclaim: $${totalReclaim.toLocaleString('en-US')}/mo`);

  console.log(
    `Ledger updated: ${updated.discovered.length} discovered, ${updated.contacted.length} drafted.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
