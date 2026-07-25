// Optional AI tone pass over a composed draft. Facts and the call to action
// must survive unchanged; without GEMINI_API_KEY the deterministic template is
// returned untouched.
const MODEL = process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.6-flash';

export async function polishWithGemini(body: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return body;

  const prompt = `Rewrite this cold outreach email to sound warm, concise, and professional. Keep every fact and the call to action identical. Do not invent claims. Never use an em dash. Return only the email body.\n\n${body}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
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
    // Enforce the em dash ban even against the model.
    return text ? text.replace(/\u2014/g, ', ') : body;
  } catch (err) {
    console.warn(`  ! Gemini polish failed, using template: ${(err as Error).message}`);
    return body;
  }
}
