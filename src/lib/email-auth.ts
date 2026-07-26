// Email authentication posture for a domain that receives through Cloudflare
// Email Routing and sends through Resend. Pure evaluation only, so it is
// coverage-gated; the DNS lookups live in scripts/email-check.ts.
//
// Why this exists: a cold email whose From domain fails DMARC alignment is
// materially likelier to land in spam, and the failure is invisible unless you
// go looking. This turns "did I set the DNS up right" into one command.

export interface DnsSnapshot {
  /** TXT at the apex. */
  rootTxt: string[];
  /** MX at the apex, which is what makes inbound routing work. */
  rootMx: string[];
  /** TXT at _dmarc. */
  dmarcTxt: string[];
  /** TXT at resend._domainkey, the signing key Resend publishes. */
  dkimTxt: string[];
  /** TXT at the send subdomain, the Return-Path domain Resend uses. */
  sendTxt: string[];
  /** MX at the send subdomain, for bounce feedback. */
  sendMx: string[];
}

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

function findSpf(records: string[]): string | undefined {
  return records.find((r) => r.toLowerCase().includes('v=spf1'));
}

function findDmarc(records: string[]): string | undefined {
  return records.find((r) => r.toLowerCase().includes('v=dmarc1'));
}

// DMARC tag values, lowercased, e.g. { p: 'none', rua: 'mailto:...' }.
export function parseDmarc(record: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of record.split(';')) {
    const [key, ...rest] = part.split('=');
    const name = key?.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (name && value) {
      out[name] = value;
    }
  }
  return out;
}

export function checkEmailAuth(domain: string, snap: DnsSnapshot): CheckResult[] {
  const results: CheckResult[] = [];

  // Inbound: Cloudflare Email Routing needs the apex MX pointing at it.
  const cloudflareMx = snap.rootMx.filter((mx) => mx.includes('mx.cloudflare.net'));
  results.push({
    id: 'inbound_mx',
    label: 'Inbound routing (Cloudflare MX on the apex)',
    status: cloudflareMx.length > 0 ? 'pass' : 'fail',
    detail:
      cloudflareMx.length > 0
        ? `${cloudflareMx.length} Cloudflare MX record(s)`
        : 'No Cloudflare MX found, so forwarding to your inbox will not work',
  });

  // Apex SPF. Note this authorizes forwarding, not Resend sending: Resend
  // sends with a Return-Path on the send subdomain, so its SPF lives there.
  const rootSpf = findSpf(snap.rootTxt);
  results.push({
    id: 'apex_spf',
    label: 'Apex SPF record',
    status: rootSpf ? 'pass' : 'warn',
    detail: rootSpf ?? 'Missing. Not fatal for Resend, but expected for the routing setup',
  });

  // Outbound signing. This is the record that makes DMARC align, because
  // Resend signs as d=<domain> even though the envelope is a subdomain.
  const dkim = snap.dkimTxt.find((r) => r.includes('p='));
  results.push({
    id: 'resend_dkim',
    label: `Resend DKIM key (resend._domainkey.${domain})`,
    status: dkim ? 'pass' : 'fail',
    detail: dkim
      ? `Published, ${dkim.length} chars`
      : 'Missing. Without it, mail sent as this domain fails DMARC alignment',
  });

  const sendSpf = findSpf(snap.sendTxt);
  const sendSpfOk = Boolean(sendSpf && sendSpf.includes('amazonses.com'));
  results.push({
    id: 'send_spf',
    label: `Return-Path SPF (send.${domain})`,
    status: sendSpfOk ? 'pass' : 'fail',
    detail: sendSpf
      ? sendSpfOk
        ? sendSpf
        : `Present but missing amazonses.com: ${sendSpf}`
      : 'Missing. Resend needs this on the send subdomain',
  });

  const sendMxOk = snap.sendMx.some((mx) => mx.includes('feedback-smtp'));
  results.push({
    id: 'send_mx',
    label: `Bounce feedback MX (send.${domain})`,
    status: sendMxOk ? 'pass' : 'warn',
    detail: sendMxOk
      ? snap.sendMx.join(', ')
      : 'Missing. Sending still works, but bounce handling degrades',
  });

  // Policy. p=none is correct while you are still reading reports.
  const dmarcRecord = findDmarc(snap.dmarcTxt);
  if (!dmarcRecord) {
    results.push({
      id: 'dmarc',
      label: 'DMARC policy',
      status: 'fail',
      detail: 'Missing. Publish at least v=DMARC1; p=none with a rua address',
    });
  } else {
    const tags = parseDmarc(dmarcRecord);
    const policy = tags.p ?? 'none';
    results.push({
      id: 'dmarc',
      label: 'DMARC policy',
      status: 'pass',
      detail: `p=${policy}${tags.rua ? '' : ' (no rua, so you get no reports)'}`,
    });
    // Reporting to another domain needs an authorization record there, which
    // is easy to get wrong and silently yields no reports.
    const external = (tags.rua ?? '')
      .split(',')
      .map((a) => a.trim().replace(/^mailto:/i, ''))
      .filter((a) => a.includes('@'))
      .filter((a) => {
        // slice rather than split: the filter above guarantees an '@', so
        // there is no missing-host case to defend against.
        const host = a.slice(a.indexOf('@') + 1).toLowerCase();
        return host !== domain.toLowerCase() && !host.endsWith('.cloudflare.net');
      });
    if (external.length > 0) {
      results.push({
        id: 'dmarc_external_rua',
        label: 'DMARC report destination',
        status: 'warn',
        detail: `${external.join(', ')} is on another domain, which needs a _report._dmarc authorization record there or reports are silently dropped`,
      });
    }
  }

  return results;
}

// Sending is only safe once nothing is failing. Warnings are informational.
export function isSendReady(results: CheckResult[]): boolean {
  return !results.some((r) => r.status === 'fail');
}

export function countByStatus(results: CheckResult[]): Record<CheckStatus, number> {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0 };
  for (const r of results) {
    counts[r.status] += 1;
  }
  return counts;
}
