#!/usr/bin/env node
// Roll Call - agent edition.
//
// Generates a valid opencode.json `agent` config block from a plain JSON
// description of roles, so an AI agent (or a human in a hurry) doesn't have to
// click through index.html's form. Full spec: agent.md in this same folder.
// Hosted free edition (unchanged on the public site): https://ohnoai.xyz/tools/roll-call/
//
// This file has no dependencies beyond Node's own `fs` module and no imports
// from elsewhere in this repo. Copy it anywhere - a totally unrelated project,
// a temp dir, wherever your agent is actually working - and `node cli.mjs ...`
// works with no checkout of this repo required.
//
// Usage:
//   node cli.mjs roles.json                  write result to stdout
//   node cli.mjs roles.json -o opencode.json  write result to a file
//   cat roles.json | node cli.mjs             read from stdin instead of a file
//   node cli.mjs roles.json --no-validate     skip live model-catalog checks
//
// Input shape (roles.json):
//   {
//     "default": "plan",
//     "agent": {
//       "plan":  { "mode": "primary",  "model": "opencode/claude-sonnet-5" },
//       "build": { "mode": "subagent", "model": "opencode-go/kimi-k3" }
//     }
//   }
//
// Every field inside a role entry (description, temperature, prompt,
// permission, variant, top_p, color, ...) is passed through as-is into the
// output - see https://opencode.ai/config.json (`$defs.AgentConfig`) for the
// full field list opencode itself understands. This script only adds: role
// name validation, model-ID validation against OpenCode's live Zen/Go
// catalogs, defaulting `mode` to "primary", and assembling the final
// $schema/model/agent wrapper. It does not restrict permission objects to a
// fixed key list the way the web form's checkboxes do - any permission key
// opencode supports (read, edit, bash, task, webfetch, websearch, ...) passes
// through untouched.
//
// Requires Node 18+ (global fetch).

import { readFile, writeFile } from 'node:fs/promises';

const ZEN_URL = 'https://opencode.ai/zen/v1/models';
const GO_URL = 'https://opencode.ai/zen/go/v1/models';
const FETCH_TIMEOUT_MS = 8000;

const VALID_ROLE_RE = /^[a-zA-Z_][a-zA-Z0-9_.\-\/]*$/;
const VALID_MODES = new Set(['primary', 'subagent', 'all']);

// Same fallback display-name lists tools/roll-call/index.html uses when the
// live fetch fails, reduced to ids via the same slugify() below (that's all
// this script needs them for). Keep in sync with FALLBACK_ZEN_NAMES /
// FALLBACK_GO_NAMES in index.html if those ever change.
const FALLBACK_ZEN_NAMES = [
  "Ling-3.0-flash Free", "Laguna S 2.1 Free", "North Mini Code Free", "Nemotron 3 Ultra Free",
  "DeepSeek V4 Flash Free", "MiMo V2.5 Free", "Big Pickle", "Gemini 3.5 Flash Lite", "Gemini 3.6 Flash",
  "GPT-5.6 Luna", "GPT-5.6 Sol", "GPT-5.6 Terra", "Grok 4.5", "Claude Sonnet 5", "GLM-5.2", "Kimi K2.7 Code",
  "Claude Fable 5", "MiniMax-M3", "Claude Opus 4.8", "Grok Build 0.1", "Gemini 3.5 Flash", "DeepSeek V4 Flash",
  "DeepSeek V4 Pro", "GPT-5.5 Pro", "GPT-5.5", "Kimi K2.6", "Claude Opus 4.7", "GLM-5.1", "Qwen3.6 Plus",
  "MiniMax-M2.7", "GPT-5.4 Mini", "GPT-5.4", "GPT-5.4 Pro", "GPT-5.3 Codex", "Gemini 3.1 Pro Preview",
  "Claude Sonnet 4.6", "Qwen3.5 Plus", "GPT-5.3 Codex Spark", "MiniMax-M2.5", "GLM-5", "Claude Opus 4.6",
  "Kimi K2.5", "GPT-5.2 Codex", "Gemini 3 Flash", "GPT-5.2", "Claude Opus 4.5", "GPT-5.1", "GPT-5.1 Codex",
  "GPT-5.1 Codex Max", "GPT-5.1 Codex Mini", "Claude Haiku 4.5", "Claude Sonnet 4.5", "GPT-5 Codex", "GPT-5",
  "Claude Opus 4.1", "Claude Sonnet 4"
];

const FALLBACK_GO_NAMES = [
  "Kimi K3 (2x usage)", "Grok 4.5", "Hy3", "GLM-5.2", "Kimi K2.7 Code", "Qwen3.7 Plus", "MiniMax-M3",
  "Qwen3.7 Max", "DeepSeek V4 Flash", "DeepSeek V4 Pro", "MiMo V2.5", "MiMo V2.5 Pro", "Kimi K2.6", "GLM-5.1",
  "Qwen3.6 Plus", "MiniMax-M2.7"
];

function slugify(name) {
  return name
    .replace(/\s*\([^)]*\)\s*/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function fallbackIds(names) {
  return new Set(names.map(slugify));
}

function usage() {
  return `Roll Call CLI - generate opencode.json from a role description, no clicking required.

Usage:
  node cli.mjs <roles.json> [-o out.json] [--no-validate]
  cat roles.json | node cli.mjs [-o out.json] [--no-validate]

  -o, --out <path>   write the result to a file instead of stdout
      --no-validate  skip checking model IDs against OpenCode's live catalogs
  -h, --help         show this message

Full input/output spec: agent.md in this same folder.`;
}

function parseArgs(argv) {
  const args = { file: null, out: null, validate: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') {
      const val = argv[++i];
      if (!val || val.startsWith('-')) {
        throw new Error(`${a} needs a file path argument`);
      }
      args.out = val;
    } else if (a === '--no-validate') {
      args.validate = false;
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (a.startsWith('-')) {
      throw new Error(`unrecognized flag "${a}"`);
    } else if (!args.file) {
      args.file = a;
    } else {
      throw new Error(`unexpected extra argument "${a}"`);
    }
  }
  return args;
}

async function readInput(file) {
  if (file && file !== '-') {
    return readFile(file, 'utf8');
  }
  if (process.stdin.isTTY) {
    throw new Error('no input file given and no piped input detected - pass a file path or pipe JSON in');
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map(c => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString('utf8');
}

async function fetchModelIds(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.data)) throw new Error('unexpected response shape');
    return new Set(json.data.map(m => m.id));
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCatalogs() {
  const [zenResult, goResult] = await Promise.allSettled([fetchModelIds(ZEN_URL), fetchModelIds(GO_URL)]);

  let zenIds, goIds;

  if (zenResult.status === 'fulfilled') {
    zenIds = zenResult.value;
  } else {
    console.error(`roll-call: couldn't reach OpenCode Zen's live catalog (${zenResult.reason.message}) - validating against the bundled fallback list instead`);
    zenIds = fallbackIds(FALLBACK_ZEN_NAMES);
  }

  if (goResult.status === 'fulfilled') {
    goIds = goResult.value;
  } else {
    console.error(`roll-call: couldn't reach OpenCode Go's live catalog (${goResult.reason.message}) - validating against the bundled fallback list instead`);
    goIds = fallbackIds(FALLBACK_GO_NAMES);
  }

  return { zenIds, goIds };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`roll-call: ${err.message}`);
    console.error();
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  let raw;
  try {
    raw = await readInput(args.file);
  } catch (err) {
    console.error(`roll-call: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    console.error(`roll-call: input isn't valid JSON (${err.message})`);
    process.exitCode = 1;
    return;
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    console.error('roll-call: input must be a JSON object with "default" and "agent" keys');
    process.exitCode = 1;
    return;
  }

  const { default: defaultRole, agent } = input;
  const errors = [];

  if (!agent || typeof agent !== 'object' || Array.isArray(agent) || Object.keys(agent).length === 0) {
    console.error('roll-call: input needs a non-empty "agent" object keyed by role name');
    process.exitCode = 1;
    return;
  }

  const roleNames = Object.keys(agent);

  for (const name of roleNames) {
    if (!VALID_ROLE_RE.test(name)) {
      errors.push(`role "${name}" is an invalid JSON key - use letters, digits, hyphens, underscores, dots, slashes`);
    }
  }

  if (!defaultRole || !roleNames.includes(defaultRole)) {
    errors.push(`"default" must name one of the roles in "agent" (got ${JSON.stringify(defaultRole)}; roles are ${roleNames.join(', ')})`);
  }

  let zenIds = null;
  let goIds = null;
  if (args.validate) {
    ({ zenIds, goIds } = await loadCatalogs());
  }

  const outAgent = {};

  for (const name of roleNames) {
    const roleInput = agent[name];

    if (!roleInput || typeof roleInput !== 'object' || Array.isArray(roleInput)) {
      errors.push(`role "${name}" must be an object`);
      continue;
    }
    if (!roleInput.model || typeof roleInput.model !== 'string') {
      errors.push(`role "${name}" needs a "model" string (e.g. "opencode/claude-sonnet-5")`);
      continue;
    }

    const mode = roleInput.mode || 'primary';
    if (!VALID_MODES.has(mode)) {
      errors.push(`role "${name}" has mode "${mode}" - must be one of ${[...VALID_MODES].join(', ')}`);
      continue;
    }

    if (args.validate) {
      const slash = roleInput.model.indexOf('/');
      const provider = slash === -1 ? '' : roleInput.model.slice(0, slash);
      const id = slash === -1 ? '' : roleInput.model.slice(slash + 1);
      const catalog = provider === 'opencode' ? zenIds : provider === 'opencode-go' ? goIds : null;

      if (!catalog) {
        errors.push(`role "${name}" has model "${roleInput.model}" - expected it to start with "opencode/" (Zen) or "opencode-go/" (Go)`);
        continue;
      }
      if (!catalog.has(id)) {
        errors.push(`role "${name}" has model "${roleInput.model}", which isn't in ${provider === 'opencode' ? "Zen's" : "Go's"} current catalog - pass --no-validate to skip this check if you're sure it's right`);
        continue;
      }
    }

    outAgent[name] = { ...roleInput, mode };
  }

  if (errors.length) {
    for (const e of errors) console.error(`roll-call: ${e}`);
    process.exitCode = 1;
    return;
  }

  const result = {
    '$schema': 'https://opencode.ai/config.json',
    model: agent[defaultRole].model,
    agent: outAgent
  };

  const text = JSON.stringify(result, null, 2) + '\n';

  if (args.out) {
    await writeFile(args.out, text, 'utf8');
    console.error(`roll-call: wrote ${args.out}`);
  } else {
    process.stdout.write(text);
  }
}

main().catch(err => {
  console.error(`roll-call: unexpected error - ${err.stack || err.message}`);
  process.exitCode = 1;
});
