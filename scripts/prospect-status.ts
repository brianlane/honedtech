// prospect:status - the morning dashboard. Shows pipeline totals, the reply
// rate the launch kit tells you to watch, and who is owed a follow-up.
//
// Usage:
//   npm run prospect:status
import {
  dueForFollowUp,
  ledgerStats,
  verticalBreakdown,
} from '../src/lib/prospect/ledger';
import { loadLedger } from './lib/ledger-io';

async function main() {
  const { ledger } = await loadLedger();
  const stats = ledgerStats(ledger);
  const due = dueForFollowUp(ledger);
  const byVertical = verticalBreakdown(ledger);

  console.log('\nOutreach status');
  console.log('---------------');
  console.log(`  Discovered:      ${stats.discovered}`);
  console.log(`  Drafted:         ${stats.drafted}`);
  console.log(`  Sent:            ${stats.sent}`);
  console.log(`  Drafts pending:  ${stats.pendingDrafts}`);
  console.log(`  Skipped:         ${stats.skipped}`);
  console.log(`  Addresses used:  ${stats.emailed}`);
  console.log(`  Awaiting reply:  ${stats.awaitingReply}`);
  console.log(`  Replied:         ${stats.replied}`);
  console.log(`  Booked:          ${stats.booked}`);
  console.log(`  Declined:        ${stats.declined}`);
  console.log(`  Bounced:         ${stats.bounced}`);
  console.log(`  Opted out:       ${stats.optedOut}`);
  console.log(`  Reply rate:      ${stats.replyRate}% of sent`);

  if (byVertical.length > 0) {
    console.log('\nBy vertical (drafted / sent / replied / booked):');
    for (const v of byVertical) {
      console.log(
        `  ${v.vertical}: ${v.drafted} / ${v.sent} / ${v.replied} / ${v.booked}`,
      );
    }
  }

  if (stats.pendingDrafts > 0) {
    console.log(
      `\n  ${stats.pendingDrafts} draft(s) are waiting on you in the digest emails.\n` +
        '  After sending one: npm run prospect:sent -- <domain> <address>\n' +
        '  Passing on one:    npm run prospect:skip -- <domain>',
    );
  }

  // Gated on sent, not drafted: an unsent draft says nothing about the pitch.
  if (stats.sent >= 20 && stats.replyRate < 3) {
    console.log(
      '\n  Reply rate is under 3%. Per the launch kit, tighten the specificity\n' +
        '  of the findings before increasing volume.',
    );
  }

  if (due.length === 0) {
    console.log('\nNo follow-ups due.\n');
    return;
  }

  console.log(`\nFollow-ups due (${due.length}), one nudge each, then stop:`);
  for (const item of due) {
    console.log(`  ${item.domain} (sent ${item.daysAgo} days ago)`);
  }
  console.log('\nAfter sending, mark it: npm run prospect:followup -- <domain>\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
