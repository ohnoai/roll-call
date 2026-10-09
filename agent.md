# Roll Call - agent edition

This is the machine-usable half of [Roll Call](https://ohnoai.xyz/tools/roll-call/), a small tool that generates the `agent` block of an `opencode.json` config. The human version is a form you click through. This page exists so an AI agent (or a script) can skip that and produce the same output directly.

Not an official OpenCode resource - independently built, documented here on a best-effort basis. Canonical schema: [opencode.ai/config.json](https://opencode.ai/config.json). Canonical docs: [opencode.ai/docs/agents](https://opencode.ai/docs/agents).

**Homes (both stay):** this repo is the isolated source for the tool. The free hosted UI stays at [ohnoai.xyz/tools/roll-call/](https://ohnoai.xyz/tools/roll-call/) - nothing was moved off the site.

## Two ways to use this

**1. Run the CLI** - it's one self-contained file with zero dependencies beyond Node's own `fs` module, so you do *not* need this repo checked out. Grab it and run it from wherever your agent already is:

```bash
curl -o roll-call-cli.mjs https://ohnoai.xyz/tools/roll-call/cli.mjs
node roll-call-cli.mjs roles.json > opencode.json
```

Already have this repo cloned for some other reason? Just run it in place instead:

```bash
node cli.mjs roles.json > opencode.json
# or
cat roles.json | node cli.mjs -o opencode.json
```

Either way, it validates role names and model IDs against OpenCode's live catalogs and prints (or writes) the finished JSON. `--help` for flags. Requires Node 18+.

**2. Or just write the JSON yourself**, if you'd rather not run a script at all. Everything you need is below.

## The live model catalogs

Two plain GET endpoints, no auth:

| Provider prefix | Endpoint |
|---|---|
| `opencode/` (Zen) | `https://opencode.ai/zen/v1/models` |
| `opencode-go/` (Go) | `https://opencode.ai/zen/go/v1/models` |

Both return `{ "data": [ { "id": "claude-sonnet-5", ... }, ... ] }`. A model string in the output config is `<provider-prefix><id>`, e.g. `opencode/claude-sonnet-5` or `opencode-go/kimi-k3`.

These endpoints send no CORS header, which blocks a *browser* from fetching them cross-origin - that's why the human tool talks to same-origin proxies (`/api/models/zen`, `/api/models/go`) instead. CORS is a browser-only restriction: a script, CLI, or agent calling these URLs directly (curl, `fetch`, etc.) is unaffected and doesn't need the proxy.

## Output shape

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/claude-sonnet-5",
  "agent": {
    "plan": {
      "description": "Reads code and proposes changes, doesn't touch files",
      "mode": "primary",
      "model": "opencode/claude-sonnet-5",
      "temperature": 0.2,
      "permission": {
        "edit": "deny",
        "bash": { "git log*": "allow", "*": "ask" }
      }
    },
    "build": {
      "mode": "subagent",
      "model": "opencode-go/kimi-k3",
      "permission": { "edit": "allow" }
    }
  }
}
```

- `model` (top level) is whichever role you're treating as the default - just copy that role's own `model` value up.
- `agent` is keyed by role name, same shape and same key name as the real `opencode.json`.

## Rules this generator enforces

- Role names must match `^[a-zA-Z_][a-zA-Z0-9_.\-\/]*$` (plain JSON-key-safe identifiers).
- Every role needs a `model` string, and it must resolve to a real id in the matching live catalog (`opencode/...` checked against Zen, `opencode-go/...` checked against Go). Skip this with `--no-validate` if you're deliberately targeting a brand-new model not in the catalog yet.
- `mode` defaults to `"primary"` if you omit it. Valid values: `primary`, `subagent`, `all`.
- Anything else - `description`, `temperature`, `prompt`, `permission`, `variant`, `top_p`, `color`, `steps`, etc. - is passed through exactly as given. This spec doesn't limit you to a fixed field list the way the web form's dropdowns and checkboxes do; if opencode's schema supports a field, you can set it.

### Permission objects

`permission` isn't restricted to `edit`/`task`/`bash` (that's just what the web form's UI happens to expose). Per OpenCode's real schema, valid keys include `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `todowrite`, `question`, `webfetch`, `websearch`, `lsp`, `doom_loop`, and `skill`. Each value is either a flat action (`"allow"` / `"ask"` / `"deny"`) or, for pattern-shaped ones like `bash` and `task`, an object mapping a pattern or role name to an action, with `"*"` as the default:

```json
"permission": {
  "edit": "ask",
  "bash": { "git commit*": "ask", "*": "allow" },
  "task": { "*": "deny", "explore": "allow" },
  "webfetch": "allow"
}
```

## Input format for the CLI

Same shape as the output, minus the `$schema` wrapper - just `default` and `agent`:

```json
{
  "default": "plan",
  "agent": {
    "plan":  { "mode": "primary",  "model": "opencode/claude-sonnet-5" },
    "build": { "mode": "subagent", "model": "opencode-go/kimi-k3" }
  }
}
```

`node cli.mjs roles.json` turns that into the output shape above.

## One deliberate difference from the web tool

The web form quietly omits a role's `temperature` from the JSON when it's left at the slider's default (0.3) - a UI convenience, not something opencode itself treats as special. The CLI does not do this: if you set `"temperature": 0.3`, it stays in the output. Omit the key entirely if you want opencode's own default to apply.

## Not covered here

Anything about OpenCode beyond this one config block. For everything else - providers, MCP servers, permissions at the top level, commands, skills - see [opencode.ai/docs](https://opencode.ai/docs/) and the full schema at [opencode.ai/config.json](https://opencode.ai/config.json).

---

If an actual human wound up on this page: you want [ohnoai.xyz/tools/roll-call/](https://ohnoai.xyz/tools/roll-call/) instead, and there's a [writeup](https://ohnoai.xyz/blog/post?slug=roll-call) explaining what any of this is. This page is deliberately not funny; that one is.
