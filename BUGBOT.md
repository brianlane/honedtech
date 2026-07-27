# Review notes for this repository

Conventions and already-investigated behaviour, so review effort goes to real
defects rather than re-litigating settled ones.

## Verified non-issues

**The 404 page is served by the Worker, not by static assets.** `wrangler.jsonc`
deliberately leaves `not_found_handling` unset. The Astro Cloudflare adapter
falls unmatched paths through to the Worker, which renders `src/pages/404.astro`.
Verified against production: a request to a nonexistent path returns HTTP 404
with the custom page. Setting `not_found_handling: "404-page"` would bypass the
Worker instead of helping.

**`jq` reads a stream of JSON values, not a single one.** Several workflows pipe
`gh api --paginate --jq '...'` output, which is one JSON object per line, into a
further `jq` filter. That is correct: `jq` processes each value in the stream in
turn. It is not a parse error and later lines are not dropped.

## Conventions

**Host matching uses escaped-dot regex or an explicit label boundary,** never a
bare `endsWith` on a hostname, so `evilexample.com` cannot match `example.com`.
See `src/lib/prospect/detect.ts` and `src/lib/enterprise/match.ts`.

**Estimates undershoot on purpose.** Every figure in `src/lib/calculator.ts` and
`src/lib/enterprise/seats.ts` takes the low end of a published range. An
estimate that survives contact with a real invoice keeps the meeting; one that
overshoots ends it. Flagging a number as too conservative is not a defect.

**Silent success is the failure mode we care about most.** Scheduled jobs throw
rather than logging and returning empty, because a green run nobody looks at is
worse than a red one. Prefer failing loudly over degrading quietly.

**Coverage is gated at 100%** for everything in the `include` list in
`vitest.config.ts`. New logic in that scope lands with its tests.

**No em dashes anywhere,** in code, comments, docs, or copy. CI fails on the
character.
