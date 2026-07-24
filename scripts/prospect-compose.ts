// prospect:compose - turns outreach/findings.jsonl into per-prospect email
// drafts for manual review and sending. Applies the opt-out and already-sent
// suppression lists. Never sends anything.
//
// Usage:
//   npm run prospect:compose
//
// Optional AI polish: if GEMINI_API_KEY is set, each draft body is rewritten
// for tone (facts unchanged, em dashes banned in the prompt). Without it, the
// deterministic template from src/lib/prospect/compose is used as-is.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { composeEmail, type Prospect } from '../src/lib/prospect/compose';
import {
  buildSuppressionSet,
  partitionProspects,
} from '../src/lib/prospect/ledger';
import type { Finding } from '../src/lib/prospect/types';

interface Record {
  prospect: Prospect;
  findings: Finding[];
  contactEmail: string | null;
}

const GEMINI_MODEL = process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.6-flash';

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function polishWithGemini(body: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return body;
  const prompt = `Rewrite this cold outreach email to sound warm, concise, and professional. Keep every fact and the call to action identical. Do not invent claims. Never use an em dash. Return only the email body.\n\n${body}`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    // Guard the em dash ban even against the model.
    return text ? text.replace(/\u2014/g, ', ') : body;
  } catch (err) {
    console.warn(`  ! Gemini polish failed, using template: ${(err as Error).message}`);
    return body;
  }
}

async function main() {
  const raw = await readFile('outreach/findings.jsonl', 'utf8');
  const records: Record[] = raw
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record);

  const suppressed = buildSuppressionSet(
    await readOptional('outreach/optout.csv'),
    await readOptional('outreach/outreach-log.csv'),
  );
  const { sendable, skipped } = partitionProspects(
    records.map((r) => r.prospect),
    suppressed,
  );
  const sendableDomains = new Set(sendable.map((p) => p.domain));

  await mkdir('outreach/drafts', { recursive: true });
  const summary: string[] = ['# Outreach review pack', ''];
  let written = 0;

  for (const record of records) {
    if (!sendableDomains.has(record.prospect.domain)) continue;
    const email = composeEmail(record.prospect, record.findings);
    const body = await polishWithGemini(email.body);
    const to = record.contactEmail ?? '(no email found, look up manually)';
    const draft = `To: ${to}\nSubject: ${email.subject}\n\n${body}\n`;
    const file = `outreach/drafts/${record.prospect.domain}.txt`;
    await writeFile(file, draft, 'utf8');
    summary.push(`- ${record.prospect.business} (${record.prospect.domain}) -> ${to} :: ${file}`);
    written += 1;
  }

  summary.push('', `Drafts: ${written}. Suppressed: ${skipped.length}.`);
  await writeFile('outreach/review.md', `${summary.join('\n')}\n`, 'utf8');
  console.log(
    `Wrote ${written} draft(s) to outreach/drafts/. Suppressed ${skipped.length}. See outreach/review.md`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
