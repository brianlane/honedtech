// email:check - verify a domain is set up to receive through Cloudflare and
// send authenticated mail through Resend. Run it after changing DNS, and
// before sending outreach from a new address.
//
// Usage:
//   npm run email:check
//   npm run email:check -- knownapex.com
import { promises as dns } from 'node:dns';
import {
  checkEmailAuth,
  countByStatus,
  isSendReady,
  type DnsSnapshot,
} from '../src/lib/email-auth';

// Every lookup is optional: an absent record is a finding, not a crash.
async function txt(name: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(name)).map((parts) => parts.join(''));
  } catch {
    return [];
  }
}

async function mx(name: string): Promise<string[]> {
  try {
    return (await dns.resolveMx(name)).map((r) => `${r.priority} ${r.exchange}`);
  } catch {
    return [];
  }
}

async function snapshot(domain: string): Promise<DnsSnapshot> {
  const [rootTxt, rootMx, dmarcTxt, dkimTxt, sendTxt, sendMx] = await Promise.all([
    txt(domain),
    mx(domain),
    txt(`_dmarc.${domain}`),
    txt(`resend._domainkey.${domain}`),
    txt(`send.${domain}`),
    mx(`send.${domain}`),
  ]);
  return { rootTxt, rootMx, dmarcTxt, dkimTxt, sendTxt, sendMx };
}

const ICON = { pass: 'ok  ', warn: 'warn', fail: 'FAIL' } as const;

async function main() {
  const domain = (process.argv[2] ?? 'honedtech.com').trim().toLowerCase();
  console.log(`\nEmail authentication for ${domain}\n`);

  const results = checkEmailAuth(domain, await snapshot(domain));
  for (const r of results) {
    console.log(`  [${ICON[r.status]}] ${r.label}`);
    console.log(`         ${r.detail}`);
  }

  const counts = countByStatus(results);
  console.log(
    `\n${counts.pass} passing, ${counts.warn} warning(s), ${counts.fail} failing.`,
  );

  if (isSendReady(results)) {
    console.log('Ready to send authenticated mail as this domain.\n');
    return;
  }
  console.log(
    'Not ready. Mail sent as this domain will fail DMARC alignment and is\n' +
      'likely to land in spam. Fix the failing rows first.\n',
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
