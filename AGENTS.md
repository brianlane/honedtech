# Agent rules for this repository

- **Never use the em dash character (U+2014), in any context.** Not in code,
  comments, docs, commit messages, UI copy, or generated text. Use a comma,
  colon, period, or plain hyphen instead. CI fails the build if one appears
  anywhere in a tracked file (see the "No em dashes" step in
  `.github/workflows/ci.yml`).
- **Work flow: branch -> PR -> babysit CI to green -> merge.** Never commit
  directly to main. Deploys happen from CI on pushes to main only.
- `.env` holds live secrets (`CLOUDFLARE_API_TOKEN`) and is never committed.
  `.env.example` documents the shape. Local Worker secrets (for `wrangler dev`)
  go in `.dev.vars`, documented by `.dev.vars.example`; production Worker
  secrets are set with `wrangler secret put`.
- Tests are coverage-gated at 100% for everything in scope (the `include`
  list in `vitest.config.ts`). New logic lands with the tests that keep it
  there.
