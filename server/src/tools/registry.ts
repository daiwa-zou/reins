import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import type { RoleId } from "../../../shared/types.js";
import { confinePath } from "../guardrails/policy.js";
import { listLessons, getLesson } from "../lessons.js";
import { loadSkills } from "../skills.js";
import { sandboxArgs, sandboxAvailable } from "./sandbox.js";

/** Tool results are capped so one noisy command cannot flood the context. */
export const MAX_RESULT_CHARS = 24_000;

export interface ToolContext {
  workspace: string;
  role: RoleId;
  allowNetwork: boolean;
  /** Run shell commands under the OS sandbox when available. */
  sandbox: boolean;
  signal: AbortSignal;
  /** Phase-specific tools register handlers here (propose_contract, finish, delegate_scout, ...). */
  handlers: Record<string, (input: any) => Promise<string> | string>;
}

export interface ToolDef {
  schema: Anthropic.Beta.BetaToolUnion;
  /** Deferred tools are hidden from the prompt until found by tool search. */
  deferred: boolean;
  /** Read-only tools can run in parallel and never need approval. */
  readOnly: boolean;
  run: (input: any, ctx: ToolContext) => Promise<string>;
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  run: ToolDef["run"],
  opts: { deferred?: boolean; readOnly?: boolean; examples?: Record<string, unknown>[] } = {},
): ToolDef {
  return {
    schema: {
      name,
      description,
      input_schema: { type: "object", properties, required, additionalProperties: false },
      strict: true,
      ...(opts.examples ? { input_examples: opts.examples } : {}),
    } as Anthropic.Beta.BetaTool,
    deferred: opts.deferred ?? false,
    readOnly: opts.readOnly ?? false,
    run,
  };
}

export function truncate(s: string, max = MAX_RESULT_CHARS): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  const head = s.slice(0, Math.floor(max * 0.7));
  const tail = s.slice(-Math.floor(max * 0.25));
  return {
    text: `${head}\n\n[... ${s.length - head.length - tail.length} characters omitted. Narrow the output with grep, head, tail or a more specific query ...]\n\n${tail}`,
    truncated: true,
  };
}

/**
 * Credentials never enter the sandbox: the agent's shell gets a copy of the
 * environment with API keys and tokens removed, so a prompt-injected
 * `env | curl` cannot exfiltrate them (contain-claude, sandboxing posts).
 */
export function scrubbedEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(ANTHROPIC|CLAUDE|OPENAI|AWS_SECRET|AWS_SESSION|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|REINS_)/.test(k)) continue;
    if (/(_TOKEN|_SECRET|_API_KEY|PASSWORD|CREDENTIALS)$/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export function runShell(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs = 120_000,
  env?: NodeJS.ProcessEnv,
  sandbox?: { workspace: string; allowNetwork: boolean },
): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const spawnSpec = sandbox && sandboxAvailable() ? sandboxArgs(command, sandbox.workspace, sandbox.allowNetwork) : { file: "/bin/zsh", args: ["-lc", command] };
    const child = spawn(spawnSpec.file, spawnSpec.args, { cwd, env: { ...scrubbedEnv(), ...env, REINS: "1", CI: "1", GIT_TERMINAL_PROMPT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let timedOut = false;
    const cap = (chunk: Buffer) => {
      if (out.length < MAX_RESULT_CHARS * 4) out += chunk.toString();
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({ code, out, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, out: String(err), timedOut: false });
    });
  });
}

const readFile = tool(
  "read_file",
  "Read a UTF-8 text file in the workspace. Returns numbered lines. Use offset/limit for large files instead of reading everything.",
  {
    path: { type: "string", description: "Path relative to the workspace root" },
    offset: { type: "integer", description: "1-based first line to return (default 1)" },
    limit: { type: "integer", description: "Max lines to return (default 400)" },
  },
  ["path"],
  async (input, ctx) => {
    const c = confinePath(ctx.workspace, input.path);
    if (!c.ok) throw new Error(c.reason);
    if (!fs.existsSync(c.abs)) throw new Error(`No such file: ${input.path}`);
    const stat = fs.statSync(c.abs);
    if (stat.isDirectory()) return fs.readdirSync(c.abs).join("\n");
    const lines = fs.readFileSync(c.abs, "utf8").split("\n");
    const start = Math.max(1, input.offset ?? 1);
    const limit = Math.min(2000, input.limit ?? 400);
    const slice = lines.slice(start - 1, start - 1 + limit);
    const body = slice.map((l, i) => `${String(start + i).padStart(5)}  ${l}`).join("\n");
    const more = lines.length > start - 1 + limit ? `\n[... ${lines.length - (start - 1 + limit)} more lines; total ${lines.length}]` : "";
    return body + more;
  },
  { readOnly: true },
);

const writeFile = tool(
  "write_file",
  "Create or overwrite a text file in the workspace. Parent directories are created. Prefer edit_file for small changes to existing files.",
  { path: { type: "string" }, content: { type: "string" } },
  ["path", "content"],
  async (input, ctx) => {
    const c = confinePath(ctx.workspace, input.path);
    if (!c.ok) throw new Error(c.reason);
    fs.mkdirSync(path.dirname(c.abs), { recursive: true });
    const existed = fs.existsSync(c.abs);
    fs.writeFileSync(c.abs, input.content);
    return `${existed ? "Overwrote" : "Created"} ${input.path} (${input.content.split("\n").length} lines)`;
  },
);

const editFile = tool(
  "edit_file",
  "Replace one exact occurrence of old_text with new_text in a workspace file. Fails if old_text is missing or appears more than once; include enough surrounding lines to make it unique.",
  { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } },
  ["path", "old_text", "new_text"],
  async (input, ctx) => {
    const c = confinePath(ctx.workspace, input.path);
    if (!c.ok) throw new Error(c.reason);
    if (!fs.existsSync(c.abs)) throw new Error(`No such file: ${input.path}`);
    const src = fs.readFileSync(c.abs, "utf8");
    const count = src.split(input.old_text).length - 1;
    if (count === 0) throw new Error(`old_text not found in ${input.path}. Re-read the file; it may have changed.`);
    if (count > 1) throw new Error(`old_text occurs ${count} times in ${input.path}; add context to make it unique.`);
    fs.writeFileSync(c.abs, src.replace(input.old_text, input.new_text));
    return `Edited ${input.path}`;
  },
  { examples: [{ path: "src/app.js", old_text: "app.use('/users', users);", new_text: "app.use('/users', users);\napp.get('/health', (req, res) => res.json({ status: 'ok' }));" }] },
);

const listFiles = tool(
  "list_files",
  "List files in the workspace matching a glob (e.g. 'src/**/*.ts'). Ignores node_modules, .git and build output. Returns relative paths with sizes.",
  { pattern: { type: "string", description: "Glob relative to the workspace. Default '**/*'" }, limit: { type: "integer" } },
  [],
  async (input, ctx) => {
    const pattern = input.pattern ?? "**/*";
    const limit = Math.min(1000, input.limit ?? 300);
    const out: string[] = [];
    const ignore = new Set(["node_modules", ".git", "dist", "build", "target", ".next", ".reins", "venv", "__pycache__"]);
    const walk = (dir: string) => {
      if (out.length >= limit) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= limit) return;
        if (ignore.has(e.name)) continue;
        const abs = path.join(dir, e.name);
        const rel = path.relative(ctx.workspace, abs);
        if (e.isDirectory()) walk(abs);
        else if (path.matchesGlob(rel, pattern)) {
          let size = 0;
          try {
            size = fs.statSync(abs).size;
          } catch {
            /* ignore */
          }
          out.push(`${rel}  (${size} B)`);
        }
      }
    };
    walk(ctx.workspace);
    return out.length ? out.join("\n") + (out.length >= limit ? `\n[... capped at ${limit}; narrow the pattern]` : "") : "No files matched.";
  },
  { readOnly: true },
);

const search = tool(
  "search",
  "Search file contents in the workspace with a regular expression (ripgrep if available, grep otherwise). Returns file:line:text matches, capped.",
  { query: { type: "string", description: "Regular expression" }, path: { type: "string", description: "Subdirectory or file to search (default whole workspace)" }, limit: { type: "integer" } },
  ["query"],
  async (input, ctx) => {
    const sub = input.path ?? ".";
    const c = confinePath(ctx.workspace, sub);
    if (!c.ok) throw new Error(c.reason);
    const limit = Math.min(500, input.limit ?? 100);
    const q = JSON.stringify(input.query);
    const target = JSON.stringify(c.abs);
    const cmd = `if command -v rg >/dev/null; then rg -n --no-heading --color never -S -m ${limit} -g '!node_modules' -g '!.git' -g '!dist' ${q} ${target}; else grep -rn -I -E --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist ${q} ${target} | head -${limit}; fi`;
    const r = await runShell(cmd, ctx.workspace, ctx.signal, 30_000);
    const text = r.out.split(ctx.workspace + "/").join("");
    return text.trim() || "No matches.";
  },
  { readOnly: true },
);

const bash = tool(
  "bash",
  "Run a shell command in the workspace (zsh, 2 minute timeout, stdout+stderr combined). Keep output small: pipe through head, tail or grep. Never use interactive commands. Prefer the dedicated file tools for reading and editing files.",
  { command: { type: "string" }, timeout_seconds: { type: "integer", description: "Optional timeout, max 600" } },
  ["command"],
  async (input, ctx) => {
    const timeout = Math.min(600, input.timeout_seconds ?? 120) * 1000;
    const r = await runShell(input.command, ctx.workspace, ctx.signal, timeout, undefined, ctx.sandbox ? { workspace: ctx.workspace, allowNetwork: ctx.allowNetwork } : undefined);
    const status = r.timedOut ? `[timed out after ${timeout / 1000}s]` : r.code === 0 ? "" : `[exit code ${r.code}]`;
    let body = r.out.trim();
    if (ctx.sandbox && /operation not permitted|sandbox/i.test(body) && r.code !== 0) body += "\n[sandbox: writes are limited to the workspace and temp dirs" + (ctx.allowNetwork ? "" : "; network is off for this run") + "]";
    return [body, status].filter(Boolean).join("\n") || "(no output, exit 0)";
  },
  { examples: [{ command: "npm test 2>&1 | tail -20" }] },
);

const think = tool(
  "think",
  "Use this to stop and think between tool calls: list the rules that apply, check whether you have all the information you need, verify the last result, and plan the next step. It does nothing but record your reasoning.",
  { thought: { type: "string" } },
  ["thought"],
  async () => "Noted.",
  { readOnly: true },
);

const updateProgress = tool(
  "update_progress",
  "Record progress for the next session: update the feature list statuses and append a dated note to progress.md. Call this whenever a feature changes status and before finishing. Never remove features; only change their status.",
  {
    features: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["todo", "in_progress", "done", "blocked"] },
          note: { type: "string" },
        },
        required: ["id", "title", "status"],
        additionalProperties: false,
      },
    },
    note: { type: "string", description: "What was done, what is next, and anything the next session must know." },
  },
  ["features", "note"],
  async (input, ctx) => (ctx.handlers.update_progress ? ctx.handlers.update_progress(input) : "Progress recorded."),
);

const gitStatus = tool("git_status", "Show git status and the last 5 commits of the workspace.", {}, [], async (_i, ctx) => {
  const r = await runShell("git status --short --branch && echo && git log --oneline -5", ctx.workspace, ctx.signal, 20_000);
  return r.out.trim() || "(not a git repository)";
}, { deferred: true, readOnly: true });

const gitDiff = tool("git_diff", "Show the uncommitted diff (optionally for one path), with stats.", { path: { type: "string" } }, [], async (input, ctx) => {
  const p = input.path ? JSON.stringify(input.path) : "";
  const r = await runShell(`git diff --stat ${p} && echo && git diff ${p}`, ctx.workspace, ctx.signal, 20_000);
  return r.out.trim() || "(no changes)";
}, { deferred: true, readOnly: true });

const gitCommit = tool("git_commit", "Stage all changes in the workspace and commit with the given message.", { message: { type: "string" } }, ["message"], async (input, ctx) => {
  const r = await runShell(`git add -A && git -c user.name="${process.env.GIT_AUTHOR_NAME ?? "Reins"}" -c user.email="${process.env.GIT_AUTHOR_EMAIL ?? "reins@localhost"}" commit -q -m ${JSON.stringify(input.message)} && git rev-parse --short HEAD`, ctx.workspace, ctx.signal, 30_000);
  if (r.code !== 0) throw new Error(r.out.trim() || "commit failed");
  return `Committed ${r.out.trim()}`;
}, { deferred: true });

const httpFetch = tool("http_fetch", "Fetch a URL over HTTP(S) and return the response text (capped). Only available when network is allowed for the run.", { url: { type: "string" } }, ["url"], async (input, ctx) => {
  if (!ctx.allowNetwork) throw new Error("Network is disabled for this run.");
  const res = await fetch(input.url, { signal: ctx.signal, headers: { "user-agent": "reins/0.1" } });
  const text = await res.text();
  return `HTTP ${res.status}\n\n${text}`;
}, { deferred: true, readOnly: true });

const listLessonsTool = tool("list_lessons", "List the harness lesson library (distilled Anthropic engineering posts) with one-line takeaways.", {}, [], async () => {
  return listLessons().map((l) => `${l.slug}: ${l.title} — ${l.takeaway}`).join("\n");
}, { deferred: true, readOnly: true });

const readLesson = tool("read_lesson", "Read one lesson from the harness library by slug.", { slug: { type: "string" } }, ["slug"], async (input) => {
  const l = getLesson(input.slug);
  if (!l) throw new Error(`No lesson ${input.slug}. Call list_lessons.`);
  return `# ${l.title}\n\n${l.learnings.map((x) => "- " + x).join("\n")}\n\n## Harness implications\n${l.implications.map((x) => "- " + x).join("\n")}`;
}, { deferred: true, readOnly: true });

const readSkill = tool("read_skill", "Read the full body of a skill from the skills index in your instructions. Skills hold procedures and checklists; read one when its description matches what you are doing.", { name: { type: "string" } }, ["name"], async (input, ctx) => {
  const s = loadSkills(ctx.workspace).find((x) => x.name === input.name);
  if (!s) throw new Error(`No skill named ${input.name}.`);
  const extra = fs.readdirSync(s.dir).filter((f) => f !== "SKILL.md");
  return `# ${s.name}\n${s.body}${extra.length ? `\n\nFiles next to this skill (read with read_file if the path is inside the workspace): ${extra.join(", ")}` : ""}`;
}, { readOnly: true });

const delegateScout = tool(
  "delegate_scout",
  "Send a read-only scout subagent to answer a research question about the codebase (where is X handled, how are tests organised, what does module Y expose). It explores with list_files, search and read_file and returns a short written answer; none of its tool output enters your context. Use it instead of reading many files yourself.",
  { question: { type: "string", description: "A specific question with the context the scout needs" } },
  ["question"],
  async (input, ctx) => (ctx.handlers.delegate_scout ? ctx.handlers.delegate_scout(input) : "Scouts are disabled for this run."),
  { readOnly: true },
);

// ---- Phase-specific structured tools --------------------------------------

const criterionSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Short stable id like C1" },
    text: { type: "string", description: "The observable outcome" },
    verify: { type: "string", description: "Exactly how to check it: a command, a request, a file to inspect" },
    hard: { type: "boolean", description: "Failing this fails the sprint" },
  },
  required: ["id", "text", "verify", "hard"],
  additionalProperties: false,
};

const proposeContract = tool(
  "propose_contract",
  "Propose the definition of done for this sprint: 4-12 concrete, independently verifiable criteria. Each must name how it will be verified. This ends your turn.",
  { criteria: { type: "array", items: criterionSchema }, rationale: { type: "string" } },
  ["criteria", "rationale"],
  async (input, ctx) => ctx.handlers.propose_contract?.(input) ?? "Contract proposed.",
  {
    examples: [
      {
        criteria: [
          { id: "C1", text: "GET /health responds 200 with JSON containing status and uptime", verify: "curl -s localhost:3000/health | jq 'has(\"status\") and has(\"uptime\")'", hard: true },
          { id: "C2", text: "npm test passes including the new test file", verify: "npm test", hard: true },
          { id: "C3", text: "A request with an unknown path still returns JSON 404", verify: "curl -s -o /dev/null -w '%{http_code}' localhost:3000/nope", hard: false },
        ],
        rationale: "Each maps to a feature; C3 covers a failure path.",
      },
    ],
  },
);

const reviewContract = tool(
  "review_contract",
  "Accept the proposed contract or return a revised list. Reject vague criteria, add missing failure cases, tighten verification steps. This ends your turn.",
  { accept: { type: "boolean" }, criteria: { type: "array", items: criterionSchema, description: "The final criteria (revised if not accepting as-is)" }, feedback: { type: "string" } },
  ["accept", "criteria", "feedback"],
  async (input, ctx) => ctx.handlers.review_contract?.(input) ?? "Reviewed.",
);

const reportEvaluation = tool(
  "report_evaluation",
  "Report the result of checking every contract criterion. Provide concrete evidence (command output, observed behaviour) per criterion. This ends your turn.",
  {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, pass: { type: "boolean" }, evidence: { type: "string" } },
        required: ["id", "pass", "evidence"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  ["results", "summary"],
  async (input, ctx) => ctx.handlers.report_evaluation?.(input) ?? "Reported.",
);

const finish = tool(
  "finish",
  "Declare this phase complete. Only call after the required outputs exist and the verification steps you were given have been run. Summarize what was done and anything left open.",
  { summary: { type: "string" }, open_items: { type: "array", items: { type: "string" } } },
  ["summary", "open_items"],
  async (input, ctx) => ctx.handlers.finish?.(input) ?? "Finished.",
);

export const ALL_TOOLS: Record<string, ToolDef> = Object.fromEntries(
  [readFile, writeFile, editFile, listFiles, search, bash, think, updateProgress, gitStatus, gitDiff, gitCommit, httpFetch, listLessonsTool, readLesson, readSkill, delegateScout, proposeContract, reviewContract, reportEvaluation, finish].map((t) => [
    (t.schema as Anthropic.Beta.BetaTool).name,
    t,
  ]),
);

export const TOOL_SEARCH_SCHEMA = { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" } as const;
