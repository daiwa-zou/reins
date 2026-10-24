/**
 * Generates demo/sample-run.jsonl: a scripted (synthetic) recording of a
 * complete run so the UI can be explored without an API key. The shape of
 * every event is identical to what the live engine emits.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ContractCriterion, ContextSnapshot, FeatureItem, RoleId, RunEvent, Usage } from "../../shared/types.js";
import { defaultRunConfig } from "../../shared/components.js";
import { narrateToolCall } from "../../shared/narrate.js";
import type { Payload } from "../src/engine/bus.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../demo/sample-run.jsonl");

const WORKSPACE = "/Users/you/Developer/sample-api";
const config = defaultRunConfig({
  id: "demo",
  title: "Add a /health endpoint with uptime and tests",
  task: "Add a GET /health endpoint to this Express API that returns JSON with status, uptime in seconds and the git sha. Cover it with a supertest test and document it in the README.",
  workspace: WORKSPACE,
  engine: "replay",
  createdAt: "2026-10-24T09:00:00.000Z",
});

const events: RunEvent[] = [];
let seq = 0;
let clock = Date.parse(config.createdAt);
let turnNo: Record<string, number> = {};
let promptTokens: Record<string, number> = {};
let toolUse = 0;

function emit(payload: Payload, gapMs = 1200): RunEvent {
  clock += gapMs;
  const ev = { ...payload, seq: seq++, ts: new Date(clock).toISOString(), runId: config.id } as RunEvent;
  events.push(ev);
  return ev;
}

const price = { in: 4, out: 20, cr: 0.2 };
function usage(input: number, output: number, cacheRead: number): { u: Usage; cost: number } {
  const u = { input, output, cacheRead, cacheWrite: 0 };
  return { u, cost: (input * price.in + output * price.out + cacheRead * price.cr) / 1e6 };
}

function snapshot(role: RoleId, prompt: number, turn: number): ContextSnapshot {
  const system = 1400;
  const tools = 3100;
  const rest = Math.max(0, prompt - system - tools);
  return {
    role,
    promptTokens: prompt,
    limit: 1_000_000,
    composition: { system, tools, history: Math.round(rest * 0.42), toolResults: Math.round(rest * 0.5), thinking: Math.round(rest * 0.08) },
    turn,
  };
}

type Call = { name: string; input: any; output: string; ok?: boolean; ms?: number; guard?: { verdict: "allow" | "ask" | "deny"; source: "rule" | "classifier" | "policy" | "user"; rule: string; rationale: string }; ask?: { title: string; detail: string } };

function turn(role: Exclude<RoleId, "classifier">, opts: { thinking?: string; text?: string; calls?: Call[]; output?: number; growth?: number; stop?: string }) {
  turnNo[role] = (turnNo[role] ?? 0) + 1;
  const t = turnNo[role];
  promptTokens[role] = (promptTokens[role] ?? 5200) + (opts.growth ?? 1800);
  emit({ type: "turn.started", role, turn: t }, 400);
  const prompt = promptTokens[role];
  const cached = Math.round(prompt * 0.85);
  const { u, cost } = usage(prompt - cached, opts.output ?? 420, cached);
  emit({ type: "turn.finished", role, turn: t, usage: u, costUsd: cost, stopReason: opts.stop ?? (opts.calls?.length ? "tool_use" : "end_turn"), model: "claude-opus-5-5" }, 2600);
  emit({ type: "context.snapshot", snapshot: snapshot(role, prompt, t) }, 10);
  if (opts.thinking) emit({ type: "thinking", role, text: opts.thinking }, 100);
  if (opts.text) emit({ type: "text", role, text: opts.text }, 200);
  for (const c of opts.calls ?? []) {
    const id = `toolu_${String(++toolUse).padStart(3, "0")}`;
    emit({ type: "tool.called", role, toolUseId: id, name: c.name, input: c.input, narration: narrateToolCall(c.name, c.input) }, 300);
    if (c.guard) emit({ type: "guardrail.decision", role, toolUseId: id, tool: c.name, ...c.guard }, 150);
    if (c.ask) {
      emit({ type: "approval.requested", request: { approvalId: `ap_${id}`, kind: "action", title: c.ask.title, detail: c.ask.detail, payload: { tool: c.name, input: c.input } } }, 200);
      emit({ type: "approval.resolved", approvalId: `ap_${id}`, decision: "approve" }, 4000);
      emit({ type: "guardrail.decision", role, toolUseId: id, tool: c.name, verdict: "allow", source: "user", rule: "approval", rationale: "Approved by you." }, 100);
    }
    emit({ type: "tool.result", role, toolUseId: id, name: c.name, ok: c.ok ?? true, output: c.output, truncated: false, durationMs: c.ms ?? 180 }, c.ms ?? 500);
  }
}

function phase(phaseName: "plan" | "contract" | "build" | "evaluate" | "wrapup", round: number, body: () => string) {
  const start = clock;
  const before = events.filter((e) => e.type === "turn.finished").length;
  emit({ type: "phase.started", phase: phaseName, round }, 600);
  const summary = body();
  const turns = events.filter((e): e is Extract<RunEvent, { type: "turn.finished" }> => e.type === "turn.finished").slice(before);
  const u = turns.reduce((a, e) => ({ input: a.input + e.usage.input, output: a.output + e.usage.output, cacheRead: a.cacheRead + e.usage.cacheRead, cacheWrite: 0 }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const cost = turns.reduce((a, e) => a + e.costUsd, 0);
  emit({ type: "phase.finished", phase: phaseName, round, summary, usage: u, costUsd: cost, durationMs: clock - start }, 400);
}

// ---------------------------------------------------------------------------
emit({ type: "run.created", config }, 0);
emit({ type: "run.status", status: "running" }, 200);
emit({ type: "note", level: "info", text: "Environment: node v23.9.0, darwin arm64, git repo at 3f9c2a1." }, 100);

const features: FeatureItem[] = [
  { id: "F1", title: "GET /health route returning status, uptime and git sha", status: "todo" },
  { id: "F2", title: "Git sha resolved once at startup with a safe fallback", status: "todo" },
  { id: "F3", title: "Supertest coverage for /health (shape and 200)", status: "todo" },
  { id: "F4", title: "README section documenting the endpoint", status: "todo" },
];

phase("plan", 0, () => {
  turn("planner", {
    thinking: "Small Express app. I should look at how routes and tests are organised before writing a spec, and check for any existing health route.",
    calls: [
      { name: "list_files", input: { pattern: "**/*.{js,ts,json,md}" }, output: "package.json  (812 B)\nREADME.md  (1403 B)\nsrc/app.js  (1210 B)\nsrc/server.js  (240 B)\nsrc/routes/users.js  (980 B)\ntest/users.test.js  (1510 B)" },
      { name: "read_file", input: { path: "package.json" }, output: '    1  {\n    2    "name": "sample-api",\n    3    "scripts": { "test": "node --test test/", "start": "node src/server.js" },\n    4    "dependencies": { "express": "^4.19.2" },\n    5    "devDependencies": { "supertest": "^7.0.0" }\n    6  }' },
      { name: "search", input: { query: "health" }, output: "No matches." },
    ],
    growth: 2600,
  });
  turn("planner", {
    calls: [
      { name: "read_file", input: { path: "src/app.js" }, output: "    1  const express = require('express');\n    2  const users = require('./routes/users');\n    3  const app = express();\n    4  app.use(express.json());\n    5  app.use('/users', users);\n    6  module.exports = app;" },
      { name: "read_file", input: { path: "test/users.test.js", limit: 20 }, output: "    1  const test = require('node:test');\n    2  const assert = require('node:assert');\n    3  const request = require('supertest');\n    4  const app = require('../src/app');\n    5  \n    6  test('GET /users returns a list', async () => {\n    7    const res = await request(app).get('/users');\n    8    assert.equal(res.status, 200);\n    9  });" },
    ],
    growth: 1500,
  });
  turn("planner", {
    thinking: "Tests use node:test with supertest already installed, so no new dependency is needed. Git sha should be read once at startup via `git rev-parse` with a fallback when .git is absent (Docker builds). Keep the spec high level.",
    calls: [
      { name: "think", input: { thought: "Scope: one route, one helper, one test file, one README section. Non-goals: readiness/liveness split, metrics. Verification: npm test passes; curl /health returns the three fields." }, output: "Noted." },
      { name: "write_file", input: { path: ".reins/spec.md", content: "# Spec: /health endpoint\n\n## What\nGET /health returns `{ status: \"ok\", uptime: <seconds>, sha: <short git sha|\"unknown\"> }` with 200.\n\n## Why\nLoad balancers and humans need a cheap liveness check that also identifies the deployed build.\n\n## Scope\n- Route in src/app.js (or a routes module), helper for sha resolution.\n- Test with supertest in test/health.test.js.\n- README section.\n\n## Non-goals\nReadiness checks, dependency probes, metrics.\n\n## Verification\n`npm test` passes; `curl localhost:3000/health` shows the three fields; sha falls back to \"unknown\" without .git.\n" }, output: "Created .reins/spec.md (18 lines)" },
      { name: "update_progress", input: { features, note: "Planned 4 features. Tests use node:test + supertest (already a devDependency)." }, output: "Recorded. 0/4 features done." },
    ],
    growth: 1200,
  });
  emit({ type: "progress.updated", features, note: "Planned 4 features. Tests use node:test + supertest (already a devDependency)." }, 50);
  turn("planner", { calls: [{ name: "finish", input: { summary: "Spec written to .reins/spec.md with 4 features, ordered route -> sha helper -> test -> docs.", open_items: [] }, output: "Finished." }], growth: 600, output: 160 });
  return "Spec written to .reins/spec.md with 4 features.";
});
emit({ type: "files.changed", files: [] }, 100);

const proposed: ContractCriterion[] = [
  { id: "C1", text: "GET /health responds 200 with JSON containing status, uptime and sha", verify: "curl -s localhost:3000/health | jq 'has(\"status\") and has(\"uptime\") and has(\"sha\")'", hard: true },
  { id: "C2", text: "uptime is a non-negative number of seconds that increases between calls", verify: "two curls 1s apart; compare .uptime", hard: true },
  { id: "C3", text: "sha matches `git rev-parse --short HEAD` in this repo", verify: "compare curl output .sha to git rev-parse --short HEAD", hard: true },
  { id: "C4", text: "npm test passes including a new test/health.test.js", verify: "npm test", hard: true },
  { id: "C5", text: "README documents the endpoint and its fields", verify: "grep -n '/health' README.md", hard: false },
];
const revised: ContractCriterion[] = [
  ...proposed,
  { id: "C6", text: "Without a .git directory the endpoint still returns 200 with sha \"unknown\"", verify: "copy the repo without .git to a temp dir, start it, curl /health", hard: true },
  { id: "C7", text: "/health does not require authentication or a JSON body", verify: "curl with no headers returns 200", hard: false },
];

phase("contract", 0, () => {
  turn("builder", {
    thinking: "Read the spec and the existing test style, then propose criteria the evaluator can actually run.",
    calls: [
      { name: "read_file", input: { path: ".reins/spec.md" }, output: "    1  # Spec: /health endpoint\n ...  (18 lines)" },
      { name: "read_file", input: { path: ".reins/features.json" }, output: JSON.stringify(features, null, 1) },
    ],
    growth: 2200,
  });
  turn("builder", {
    calls: [{ name: "propose_contract", input: { criteria: proposed, rationale: "Each criterion maps to a feature and has a shell-checkable verification. C1-C4 are hard." }, output: "Proposed." }],
    growth: 900,
    output: 700,
  });
  emit({ type: "contract.proposed", by: "builder", criteria: proposed, rationale: "Each criterion maps to a feature and has a shell-checkable verification. C1-C4 are hard." }, 50);
  turn("evaluator", {
    thinking: "The proposal covers the happy path only. The spec explicitly calls out the no-.git fallback; that is exactly the kind of thing that breaks in Docker. Add it as hard. Also pin down that the route is unauthenticated.",
    calls: [
      { name: "read_file", input: { path: ".reins/contract.proposed.json" }, output: JSON.stringify(proposed, null, 1) },
      { name: "review_contract", input: { accept: false, criteria: revised, feedback: "Added C6 (sha fallback without .git, hard) because the spec names it and it is the realistic deployment failure. Added C7 to make the unauthenticated assumption explicit." }, output: "Reviewed." },
    ],
    growth: 2400,
    output: 900,
  });
  emit({ type: "contract.proposed", by: "evaluator", criteria: revised, rationale: "Added C6 (sha fallback without .git, hard) because the spec names it and it is the realistic deployment failure. Added C7 to make the unauthenticated assumption explicit." }, 50);
  emit({ type: "approval.requested", request: { approvalId: "ap_contract", kind: "contract", title: "Approve the definition of done", detail: "Edit, remove or add criteria, then approve. The evaluator will hold the builder to exactly this list.", payload: revised } }, 300);
  emit({ type: "approval.resolved", approvalId: "ap_contract", decision: "approve" }, 6000);
  emit({ type: "contract.agreed", criteria: revised }, 100);
  return "7 criteria agreed (5 hard).";
});

phase("build", 1, () => {
  turn("builder", {
    thinking: "Preamble first: progress, contract, baseline test run.",
    calls: [
      { name: "read_file", input: { path: ".reins/progress.md" }, output: "## 2026-10-24T09:01:40.000Z\nPlanned 4 features. Tests use node:test + supertest (already a devDependency)." },
      { name: "read_file", input: { path: ".reins/contract.json" }, output: JSON.stringify(revised, null, 1) },
      { name: "bash", input: { command: "git status --short && npm test 2>&1 | tail -8" }, output: "ℹ tests 2\nℹ suites 0\nℹ pass 2\nℹ fail 0", guard: { verdict: "allow", source: "rule", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." }, ms: 1900 },
    ],
    growth: 3000,
  });
  turn("builder", {
    text: "Baseline is green (2 tests). Adding the sha helper and the route.",
    calls: [
      { name: "write_file", input: { path: "src/build-info.js", content: "const { execSync } = require('node:child_process');\n\nlet sha = 'unknown';\ntry {\n  sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();\n} catch {}\n\nmodule.exports = { sha };\n" }, output: "Created src/build-info.js (9 lines)" },
      { name: "edit_file", input: { path: "src/app.js", old_text: "app.use('/users', users);", new_text: "app.use('/users', users);\napp.get('/health', (req, res) => {\n  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), sha });\n});" }, output: "Edited src/app.js" },
      { name: "edit_file", input: { path: "src/app.js", old_text: "const users = require('./routes/users');", new_text: "const users = require('./routes/users');\nconst { sha } = require('./build-info');" }, output: "Edited src/app.js" },
    ],
    growth: 2100,
    output: 900,
  });
  turn("builder", {
    calls: [
      { name: "write_file", input: { path: "test/health.test.js", content: "const test = require('node:test');\nconst assert = require('node:assert');\nconst request = require('supertest');\nconst app = require('../src/app');\n\ntest('GET /health returns status, uptime and sha', async () => {\n  const res = await request(app).get('/health');\n  assert.equal(res.status, 200);\n  assert.equal(res.body.status, 'ok');\n  assert.ok(Number.isInteger(res.body.uptime) && res.body.uptime >= 0);\n  assert.match(res.body.sha, /^[0-9a-f]{7,}$|^unknown$/);\n});\n" }, output: "Created test/health.test.js (13 lines)" },
      { name: "bash", input: { command: "npm test 2>&1 | tail -6" }, output: "ℹ tests 3\nℹ suites 0\nℹ pass 3\nℹ fail 0", guard: { verdict: "allow", source: "rule", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." }, ms: 2100 },
    ],
    growth: 1700,
    output: 600,
  });
  emit({ type: "context.cleared", role: "builder", clearedToolResults: 3, tokensFreed: 4120 }, 50);
  turn("builder", {
    thinking: "Three criteria need a running server to verify (C1-C3). Start it with a timeout, curl, then kill it. Port 3000 might be in use; use PORT=3999.",
    calls: [
      { name: "bash", input: { command: "PORT=3999 timeout 8 node src/server.js & sleep 1; curl -s localhost:3999/health; echo; git rev-parse --short HEAD; sleep 1; curl -s localhost:3999/health | jq .uptime; wait" }, output: '{"status":"ok","uptime":1,"sha":"3f9c2a1"}\n3f9c2a1\n2', guard: { verdict: "allow", source: "rule", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." }, ms: 9200 },
    ],
    growth: 1300,
  });
  turn("builder", {
    text: "C1-C4 verified by hand. Now the README and the no-.git fallback check.",
    calls: [
      { name: "edit_file", input: { path: "README.md", old_text: "## Endpoints", new_text: "## Endpoints\n\n### GET /health\nLiveness check. Returns `{ \"status\": \"ok\", \"uptime\": <seconds since start>, \"sha\": <short git sha or \"unknown\"> }`.\n" }, output: "Edited README.md" },
      { name: "bash", input: { command: "rm -rf /tmp/sample-api-nogit && mkdir -p /tmp/sample-api-nogit && rsync -a --exclude .git ./ /tmp/sample-api-nogit/ && cd /tmp/sample-api-nogit && PORT=3998 timeout 6 node src/server.js & sleep 1; curl -s localhost:3998/health; wait" }, output: '{"status":"ok","uptime":1,"sha":"unknown"}', guard: { verdict: "ask", source: "classifier", rule: "ask:recursive delete", rationale: "Recursive delete is limited to a scratch directory under /tmp and the copy is needed to test the no-.git path named in the contract." }, ask: { title: "Running `rm -rf /tmp/sample-api-nogit && mkdir -p /tmp/sample-api-nogit && rsync ...`", detail: "Recursive delete outside the workspace (a /tmp scratch copy) to test the no-.git fallback." }, ms: 7600 },
    ],
    growth: 1900,
    output: 700,
  });
  const f2 = features.map((f) => ({ ...f, status: "done" as const }));
  turn("builder", {
    calls: [
      { name: "update_progress", input: { features: f2, note: "All 4 features implemented and verified by hand (C1-C7). Server verified on PORT=3999; no-.git fallback verified from a /tmp copy." }, output: "Recorded. 4/4 features done." },
      { name: "tool_search_tool_regex", input: { pattern: "git.*commit" }, output: "git_commit" },
    ],
    growth: 1400,
  });
  emit({ type: "progress.updated", features: f2, note: "All 4 features implemented and verified by hand (C1-C7)." }, 50);
  emit({ type: "tools.loaded", role: "builder", names: ["git_commit"] }, 50);
  turn("builder", {
    calls: [
      { name: "git_commit", input: { message: "Add GET /health with uptime and git sha, test and docs" }, output: "Committed 8d1e4b7" },
      { name: "finish", input: { summary: "Added src/build-info.js (sha resolution with fallback), GET /health in src/app.js, test/health.test.js, README section. npm test: 3 pass. Verified C1-C7 manually.", open_items: [] }, output: "Finished." },
    ],
    growth: 800,
    output: 300,
  });
  emit({ type: "git.commit", sha: "8d1e4b7", message: "Add GET /health with uptime and git sha, test and docs", files: 4 }, 100);
  return "Added build-info helper, /health route, test and README; npm test 3 pass.";
});
emit({ type: "files.changed", files: [
  { path: "src/build-info.js", kind: "added", additions: 9, deletions: 0 },
  { path: "src/app.js", kind: "modified", additions: 4, deletions: 0 },
  { path: "test/health.test.js", kind: "added", additions: 13, deletions: 0 },
  { path: "README.md", kind: "modified", additions: 4, deletions: 0 },
] }, 100);

phase("evaluate", 1, () => {
  turn("evaluator", {
    thinking: "Do not trust the builder's summary. Run each verification myself, starting with the ones most likely to hide a bug: C2 (uptime increases) and C6 (fallback).",
    calls: [
      { name: "read_file", input: { path: ".reins/contract.json" }, output: JSON.stringify(revised, null, 1) },
      { name: "bash", input: { command: "npm test 2>&1 | tail -4" }, output: "ℹ pass 3\nℹ fail 0", guard: { verdict: "allow", source: "rule", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." }, ms: 2000 },
      { name: "bash", input: { command: "PORT=3997 timeout 8 node src/server.js & sleep 1; curl -s -o /dev/null -w '%{http_code}\\n' localhost:3997/health; curl -s localhost:3997/health | jq -c '{status,uptime,sha}'; sleep 2; curl -s localhost:3997/health | jq .uptime; git rev-parse --short HEAD; wait" }, output: '200\n{"status":"ok","uptime":1,"sha":"8d1e4b7"}\n3\n8d1e4b7', guard: { verdict: "allow", source: "rule", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." }, ms: 9100 },
    ],
    growth: 3200,
  });
  turn("evaluator", {
    thinking: "C1-C4 observed passing. Now C6: the fallback. The builder tested from a copy made with rsync, but what happens when the working directory is not the repo at all, e.g. started from / with an absolute path? execSync inherits cwd, so `git rev-parse` would look at cwd, not the app directory. That is a real deployment path (systemd WorkingDirectory=/).",
    calls: [
      { name: "bash", input: { command: "cd / && PORT=3996 timeout 6 node $OLDPWD/src/server.js & sleep 1; curl -s localhost:3996/health; wait" }, output: '{"status":"ok","uptime":1,"sha":"unknown"}', guard: { verdict: "allow", source: "rule", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." }, ms: 7200 },
      { name: "bash", input: { command: "grep -n '/health' README.md; curl -s -H 'Accept: text/html' localhost:3996/health -o /dev/null -w '%{http_code}' || true" }, output: "9:### GET /health\n000", guard: { verdict: "allow", source: "rule", rule: "safe:read-only", rationale: "Read-only command." }, ms: 400 },
    ],
    growth: 1600,
  });
  const results = [
    { id: "C1", pass: true, evidence: "curl localhost:3997/health -> 200, body has status/uptime/sha." },
    { id: "C2", pass: true, evidence: "uptime 1 then 3 after 2s sleep." },
    { id: "C3", pass: false, evidence: "sha is read with execSync('git rev-parse') inheriting process cwd. Started from `/` with an absolute script path the server returns sha \"unknown\" even though the repo has a .git. The sha must be resolved relative to the app directory (cwd: __dirname), otherwise production deployments report the wrong value." },
    { id: "C4", pass: true, evidence: "npm test: 3 pass, 0 fail, includes test/health.test.js." },
    { id: "C5", pass: true, evidence: "README.md:9 documents GET /health with the three fields." },
    { id: "C6", pass: true, evidence: "Copy without .git returned sha \"unknown\" with 200." },
    { id: "C7", pass: true, evidence: "Plain curl with no headers returns 200." },
  ];
  turn("evaluator", {
    calls: [{ name: "report_evaluation", input: { results, summary: "6/7 pass. C3 fails: the git sha lookup depends on the process working directory, so a server started from another directory reports \"unknown\" despite being in a git checkout. Resolve the sha with cwd set to the app directory." }, output: "Recorded: fail." }],
    growth: 900,
    output: 800,
  });
  emit({ type: "evaluation.result", round: 1, results, verdict: "fail", summary: "6/7 pass. C3 fails: the git sha lookup depends on the process working directory, so a server started from another directory reports \"unknown\" despite being in a git checkout." }, 50);
  return "FAIL: C3 — sha lookup depends on cwd.";
});

emit({ type: "steer.received", text: "Please also make sure the sha is only resolved once at startup, not per request.", deliveredTo: "next" }, 2500);

phase("build", 2, () => {
  emit({ type: "steer.delivered", text: "Please also make sure the sha is only resolved once at startup, not per request.", role: "builder" }, 300);
  turn("builder", {
    thinking: "The evaluator is right: execSync inherits cwd. Fix by passing cwd: __dirname. The sha is already resolved once at module load, which satisfies the operator note; I will add a test that asserts the module caches it.",
    calls: [
      { name: "edit_file", input: { path: "src/build-info.js", old_text: "execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })", new_text: "execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })" }, output: "Edited src/build-info.js" },
      { name: "bash", input: { command: "cd / && PORT=3995 timeout 6 node $OLDPWD/src/server.js & sleep 1; curl -s localhost:3995/health; wait; npm test 2>&1 | tail -3" }, output: '{"status":"ok","uptime":1,"sha":"8d1e4b7"}\nℹ pass 3\nℹ fail 0', guard: { verdict: "allow", source: "rule", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." }, ms: 8900 },
    ],
    growth: 2000,
    output: 500,
  });
  turn("builder", {
    calls: [
      { name: "update_progress", input: { features: features.map((f) => ({ ...f, status: "done" as const })), note: "Fix round 1: sha resolved with cwd=__dirname so it is correct regardless of the launch directory. Resolved once at module load (operator note)." }, output: "Recorded. 4/4 features done." },
      { name: "git_commit", input: { message: "Resolve git sha relative to the app directory" }, output: "Committed a41c0de" },
      { name: "finish", input: { summary: "Fixed C3: build-info.js resolves the sha with cwd=__dirname. Verified from / and via npm test (3 pass).", open_items: [] }, output: "Finished." },
    ],
    growth: 800,
    output: 300,
  });
  emit({ type: "git.commit", sha: "a41c0de", message: "Resolve git sha relative to the app directory", files: 1 }, 100);
  return "Fixed C3 (sha resolved relative to app dir).";
});
emit({ type: "files.changed", files: [
  { path: "src/build-info.js", kind: "added", additions: 9, deletions: 0 },
  { path: "src/app.js", kind: "modified", additions: 4, deletions: 0 },
  { path: "test/health.test.js", kind: "added", additions: 13, deletions: 0 },
  { path: "README.md", kind: "modified", additions: 4, deletions: 0 },
] }, 100);

phase("evaluate", 2, () => {
  turn("evaluator", {
    calls: [
      { name: "bash", input: { command: "cd / && PORT=3994 timeout 6 node $OLDPWD/src/server.js & sleep 1; curl -s localhost:3994/health | jq -r .sha; git -C $OLDPWD rev-parse --short HEAD; wait" }, output: "a41c0de\na41c0de", guard: { verdict: "allow", source: "rule", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." }, ms: 7400 },
      { name: "bash", input: { command: "npm test 2>&1 | tail -3" }, output: "ℹ pass 3\nℹ fail 0", guard: { verdict: "allow", source: "rule", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." }, ms: 1900 },
    ],
    growth: 2400,
  });
  const results = [
    { id: "C1", pass: true, evidence: "Re-verified: 200 with all three fields." },
    { id: "C2", pass: true, evidence: "uptime increases between calls." },
    { id: "C3", pass: true, evidence: "Started from /, sha a41c0de matches git rev-parse --short HEAD." },
    { id: "C4", pass: true, evidence: "npm test: 3 pass." },
    { id: "C5", pass: true, evidence: "README.md:9." },
    { id: "C6", pass: true, evidence: "Unchanged since round 1 (fallback path untouched)." },
    { id: "C7", pass: true, evidence: "Plain curl 200." },
  ];
  turn("evaluator", {
    calls: [{ name: "report_evaluation", input: { results, summary: "All 7 criteria pass. The cwd fix is correct and the fallback still works." }, output: "Recorded: pass." }],
    growth: 700,
    output: 500,
  });
  emit({ type: "evaluation.result", round: 2, results, verdict: "pass", summary: "All 7 criteria pass. The cwd fix is correct and the fallback still works." }, 50);
  return "PASS: all 7 criteria.";
});

phase("wrapup", 0, () => "4/4 features done.");
const total = events.filter((e): e is Extract<RunEvent, { type: "turn.finished" }> => e.type === "turn.finished").reduce((a, e) => a + e.costUsd, 0);
emit({ type: "run.summary", summary: "All 7 criteria pass. The cwd fix is correct and the fallback still works.", costUsd: total, durationMs: clock - Date.parse(config.createdAt) }, 300);
emit({ type: "run.status", status: "completed", reason: "All 7 criteria pass." }, 100);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`wrote ${events.length} events to ${OUT} (cost $${total.toFixed(2)})`);
