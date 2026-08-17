# AGENTS.md

This file provides guidance to any agent working with code in this repository.

## What this is

Roll Call generates the `agent` block of an `opencode.json` config. See `README.md` and
`agent.md` (the tool's own machine-facing spec - not agent guidance for working in this
repo, despite the similar name) for what it does.

## Codebase

- **`cli.mjs`** - the actual generator. Self-contained (no imports from elsewhere in
  this repo, no npm deps beyond Node's own `fs`), so it can be copied anywhere and run
  standalone. Reads a `roles.json`-shaped input, validates role names and model IDs,
  defaults `mode` to `"primary"`, and emits the `opencode.json` `agent` block. Behavior
  is fully documented in `agent.md`, not repeated here.
- **`index.html`** - the human-facing form version of the same generator, in-browser.
  Fetches live model catalogs through the same-origin proxies below rather than calling
  opencode.ai directly (browser CORS).
- **`api/models/zen.js`**, **`api/models/go.js`** - Vercel serverless functions, one per
  catalog (Zen / Go). Pure server-to-server proxy: fetch the real opencode.ai endpoint,
  hand the JSON back with `Access-Control-Allow-Origin: *`. They exist only because
  opencode.ai's endpoints don't send CORS headers themselves; a CLI or agent hitting
  those URLs directly doesn't need them.
- **`agent.md`** - not code, but the spec both `cli.mjs` and `index.html` implement.
  It's the source of truth for output shape - if you change what either one produces,
  update `agent.md` too.

**Gotcha:** `cli.mjs` carries its own hardcoded fallback model-name lists
(`FALLBACK_ZEN_NAMES`, `FALLBACK_GO_NAMES`) for when the live catalog fetch fails, and
`index.html` carries a separate copy of the same lists for the same reason. They're not
shared code - `cli.mjs` is deliberately import-free - so if the real catalogs drift far
enough that the fallbacks go stale, both files need the edit, not just one.

## Task records

This repo is small enough that a commit message is the record. If a change needs more
explanation than that, put it in the commit body rather than inventing a new document
type.
