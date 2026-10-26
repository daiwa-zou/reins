import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientMessage, RunEvent, ServerInfo, ServerMessage } from "../../shared/types.js";
import { COMPONENTS, FOUNDATIONS, HARNESS_VERSION, MODELS } from "../../shared/components.js";
import { RunManager } from "./engine/runManager.js";
import { ensureHome, REINS_HOME } from "./store/runStore.js";
import { getLesson, LessonNotFound, loadLessonLibrary, setLessonStanding } from "./lessons.js";
import { IntakeManager, IntakeRefused, isIntakeId } from "./intake/intake.js";
import { suggestDomains } from "./workspace.js";
import { composablePresets, deletePreset, listPresets, PresetCompositionError, PresetNotFound, savePreset, setDefaultPreset } from "./presets.js";
import { PresetValidationError } from "../../shared/config.js";
import { deleteDomain, DomainNotFound, DomainValidationError, listDomains, saveDomain } from "./domains.js";
import { loadSkills } from "./skills.js";
import { changedFiles, fileDiff, headSha } from "./workspace.js";
import { loadDemoEvents } from "./engine/replay.js";
import { allTrialSets } from "./engine/trials.js";
import { sandboxAvailable } from "./tools/sandbox.js";
import { listAudits } from "./audit.js";
import { probeDirectEngine } from "./engine/loop.js";
import { defaultRunConfig } from "../../shared/components.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.REINS_PORT ?? 5191);
ensureHome();

// Optional local settings (API key) saved from the UI. Stored only on this machine.
const SETTINGS_FILE = path.join(REINS_HOME, "settings.json");
function loadSettings(): { apiKey?: string; recentWorkspaces?: string[] } {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveSettings(s: ReturnType<typeof loadSettings>) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

const manager = new RunManager();
const settings = loadSettings();
if (!manager.hasApiKey && settings.apiKey) manager.setApiKey(settings.apiKey);

// Lesson intake jobs: their own manager and storage ($REINS_HOME/lessons/<slug>/), never in the Runs list.
const intake = new IntakeManager({ client: () => manager.client, hasClaudeCode: () => manager.hasClaudeCode });
// A draft left waiting for approval by a previous server process gets its approval card back.
{
  const r = intake.recover();
  if (r.resumed.length || r.interrupted.length) console.log(`intake: resumed ${r.resumed.length} waiting draft(s), marked ${r.interrupted.length} interrupted job(s)`);
}
const eventsFor = (id: string, from = 0) => (isIntakeId(id) ? intake.events(id, from) : manager.events(id, from));

const app = new Hono();
app.use("/api/*", cors());

function info(): ServerInfo {
  return {
    version: HARNESS_VERSION,
    hasApiKey: manager.hasApiKey,
    hasClaudeCode: manager.hasClaudeCode,
    sandboxAvailable: sandboxAvailable(),
    home: REINS_HOME,
    defaultWorkspace: process.env.REINS_WORKSPACE ?? process.cwd(),
    models: MODELS,
  };
}

app.get("/api/info", (c) => c.json(info()));
// Component lesson lists are derived from implications when the library loads.
app.get("/api/components", (c) => {
  loadLessonLibrary();
  // `default` mirrors defaultOn for API clients.
  return c.json(COMPONENTS.map((x) => ({ ...x, default: x.defaultOn })));
});
app.get("/api/foundations", (c) => {
  loadLessonLibrary();
  return c.json(FOUNDATIONS);
});
// Lessons: the merged library (bundled + $REINS_HOME/lessons), re-read when a file changes.
app.get("/api/lessons", (c) => c.json(loadLessonLibrary().lessons));
app.get("/api/lessons/problems", (c) => {
  const lib = loadLessonLibrary();
  return c.json({ problems: lib.problems, userDir: lib.dirs.user, bundledDir: lib.dirs.bundled });
});
app.post("/api/lessons/:slug/standing", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(setLessonStanding(c.req.param("slug"), body?.standing));
  } catch (e) {
    return c.json({ error: (e as Error).message }, e instanceof LessonNotFound ? 404 : 400);
  }
});
app.get("/api/intake", (c) => c.json(intake.list()));
app.post("/api/intake", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(intake.start({ url: body?.url, text: body?.text, title: body?.title, engine: body?.engine === "claude-code" || body?.engine === "anthropic" ? body.engine : undefined }), 201);
  } catch (e) {
    if (e instanceof IntakeRefused) return c.json({ error: e.message, duplicate: e.duplicate }, 409);
    return c.json({ error: (e as Error).message }, 400);
  }
});
app.get("/api/lessons/:slug", (c) => {
  const l = getLesson(c.req.param("slug"));
  return l ? c.json(l) : c.json({ error: "no such lesson" }, 404);
});

// Presets: built-ins from shared/config.ts plus the user's own in $REINS_HOME/presets.json.
const presetError = (c: any, e: unknown) => {
  if (e instanceof PresetValidationError) return c.json({ error: e.message.split("\n")[0] }, 400);
  if (e instanceof PresetNotFound) return c.json({ error: e.message }, 404);
  throw e;
};
app.get("/api/presets", (c) => c.json(listPresets()));
app.get("/api/presets/composable", (c) => c.json(composablePresets()));
app.post("/api/presets", async (c) => {
  const body = await c.req.json().catch(() => null);
  try {
    return c.json(savePreset(body), 201);
  } catch (e) {
    return presetError(c, e);
  }
});
app.post("/api/presets/default", async (c) => {
  const body = await c.req.json().catch(() => null);
  try {
    if (!body || typeof body !== "object" || !("name" in body)) throw new PresetValidationError('body must be {"name": "<preset>"} or {"name": null} to clear');
    return c.json({ default: setDefaultPreset((body as any).name) });
  } catch (e) {
    return presetError(c, e);
  }
});
app.delete("/api/presets/:name", (c) => {
  try {
    deletePreset(c.req.param("name"));
    return c.json({ ok: true });
  } catch (e) {
    return presetError(c, e);
  }
});

// User-built domains: named sets of implications from the library ($REINS_HOME/domains.json).
const domainError = (c: any, e: unknown) => {
  if (e instanceof DomainValidationError) return c.json({ error: e.message }, 400);
  if (e instanceof DomainNotFound) return c.json({ error: e.message }, 404);
  throw e;
};
app.get("/api/domains", (c) => c.json(listDomains()));
app.post("/api/domains", async (c) => {
  const body = await c.req.json().catch(() => null);
  try {
    return c.json(saveDomain(body), 201);
  } catch (e) {
    return domainError(c, e);
  }
});
app.delete("/api/domains/:id", (c) => {
  try {
    deleteDomain(c.req.param("id"));
    return c.json({ ok: true });
  } catch (e) {
    return domainError(c, e);
  }
});

// Skills: read-only listing of what loadSkills() would give a run in this workspace.
app.get("/api/skills", (c) => {
  const q = c.req.query("workspace");
  const ws = path.resolve(String(q || info().defaultWorkspace).replace(/^~/, os.homedir()));
  const exists = fs.existsSync(ws) && fs.statSync(ws).isDirectory();
  try {
    // A skill links to lessons through its `lessons:` frontmatter and the [skill:<name>] implications that target it.
    const impls = loadLessonLibrary().lessons.flatMap((l) => l.items.filter((i) => i.kind === "skill").map((i) => ({ slug: l.slug, target: i.target })));
    const skills = loadSkills(exists ? ws : null).map(({ name, description, source, dir, lessons }) => ({ name, description, source, dir, lessons: [...new Set([...lessons, ...impls.filter((i) => i.target === name).map((i) => i.slug)])] }));
    return c.json(skills);
  } catch (e) {
    return c.json({ error: `Could not list skills: ${(e as Error).message}` }, 400);
  }
});
// The two user-facing docs, served read-only so the UI can link to them (a fixed allow-list, never a path).
const DOCS: Record<string, string> = { "configuring.md": "configuring.md", "lesson-template.md": "lesson-template.md" };
app.get("/api/docs/:name", (c) => {
  const name = c.req.param("name");
  const f = Object.hasOwn(DOCS, name) ? DOCS[name] : undefined;
  const p = f && path.resolve(here, "../../docs", f);
  if (!p || !fs.existsSync(p)) return c.text("not found", 404);
  return c.text(fs.readFileSync(p, "utf8"), 200, { "content-type": "text/plain; charset=utf-8" });
});
app.get("/api/audit", (c) => c.json(listAudits()));
app.post("/api/settings/test", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const client = manager.client;
  if (!client) return c.json({ ok: false, error: "No API key configured." });
  const cfg = defaultRunConfig({ task: "connection test", workspace: os.tmpdir(), roles: body.model ? { builder: { model: body.model, effort: "low" } } as any : undefined });
  cfg.roles.builder.effort = "low";
  return c.json(await probeDirectEngine(client, cfg));
});
app.get("/api/runs", (c) => c.json(manager.listRuns()));
app.get("/api/trials", (c) => c.json(allTrialSets(Number(c.req.query("k") ?? 3))));
app.post("/api/runs/:id/repeat", (c) => {
  const k = Math.max(1, Math.min(10, Number(c.req.query("k") ?? 3)));
  if (!manager.config(c.req.param("id"))) return c.json({ error: `No such run: ${c.req.param("id")}` }, 404);
  const fresh = c.req.query("fresh") === "1";
  manager.repeat(c.req.param("id"), k, fresh).catch((e) => console.error("repeat failed", e));
  return c.json({ ok: true, k, fresh });
});
app.get("/api/runs/:id", (c) => {
  const id = c.req.param("id");
  if (isIntakeId(id)) {
    const cfg = intake.config(id);
    if (!cfg) return c.json({ error: "not found" }, 404);
    return c.json({ config: cfg, events: intake.events(id), pending: intake.pendingApprovals(id), active: intake.isActive(id) });
  }
  const cfg = manager.config(c.req.param("id"));
  if (!cfg) return c.json({ error: "not found" }, 404);
  return c.json({ config: cfg, events: manager.events(cfg.id), pending: manager.pendingApprovals(cfg.id), active: manager.isActive(cfg.id) });
});
app.get("/api/runs/:id/events", (c) => c.json(eventsFor(c.req.param("id"), Number(c.req.query("from") ?? 0))));
app.post("/api/runs", async (c) => {
  const body = await c.req.json();
  if (!body.task || !body.workspace) return c.json({ error: "task and workspace are required" }, 400);
  const ws = path.resolve(String(body.workspace).replace(/^~/, os.homedir()));
  if (body.engine !== "replay" && !fs.existsSync(ws)) return c.json({ error: `Workspace does not exist: ${ws}` }, 400);
  const s = loadSettings();
  s.recentWorkspaces = [ws, ...(s.recentWorkspaces ?? []).filter((w) => w !== ws)].slice(0, 8);
  saveSettings(s);
  try {
    const cfg = manager.createRun({ ...body, workspace: ws });
    return c.json(cfg);
  } catch (e) {
    if (e instanceof PresetCompositionError) return c.json({ error: e.message }, 400);
    throw e;
  }
});
app.post("/api/runs/demo", (c) => {
  const demo = loadDemoEvents();
  const created = demo.find((e) => e.type === "run.created") as Extract<RunEvent, { type: "run.created" }> | undefined;
  const base = created?.config;
  const cfg = manager.createRun({
    ...(base ?? { task: "Demo task", workspace: os.homedir() }),
    id: undefined,
    createdAt: undefined,
    title: base?.title ?? "Recorded demo",
    engine: "replay",
    task: base?.task ?? "Demo",
    workspace: base?.workspace ?? os.homedir(),
  } as any, { verbatim: true });
  return c.json(cfg);
});
app.delete("/api/runs/:id", (c) => {
  try {
    manager.deleteRun(c.req.param("id"));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
app.post("/api/runs/:id/approve", async (c) => {
  const body = await c.req.json();
  try {
    const id = c.req.param("id");
    if (isIntakeId(id)) intake.approve(id, body.approvalId, body.decision, body.note, body.lesson);
    else manager.approve(id, body.approvalId, body.decision, body.note, body.criteria);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
app.post("/api/runs/:id/steer", async (c) => {
  const body = await c.req.json();
  try {
    manager.steer(c.req.param("id"), String(body.text ?? "").slice(0, 4000));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
for (const action of ["pause", "resume", "cancel"] as const) {
  app.post(`/api/runs/:id/${action}`, (c) => {
    try {
      const id = c.req.param("id");
      if (isIntakeId(id)) {
        if (action !== "cancel") throw new Error("Intake jobs can only be cancelled.");
        intake.cancel(id);
      } else manager[action](id);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
}
app.get("/api/runs/:id/files", async (c) => {
  const cfg = manager.config(c.req.param("id"));
  if (!cfg) return c.json({ error: "not found" }, 404);
  const base = (manager.events(cfg.id).find((e) => e.type === "note" && e.text.startsWith("Environment")) as any)?.text?.match(/repo at ([0-9a-f]{7})/)?.[1] ?? null;
  try {
    const sha = base ? (await headSha(cfg.workspace)) && base : null;
    return c.json(await changedFiles(cfg.workspace, sha));
  } catch (e) {
    return c.json([]);
  }
});
app.get("/api/runs/:id/diff", async (c) => {
  const cfg = manager.config(c.req.param("id"));
  if (!cfg) return c.json({ error: "not found" }, 404);
  const file = c.req.query("file") ?? "";
  const base = (manager.events(cfg.id).find((e) => e.type === "note" && e.text.startsWith("Environment")) as any)?.text?.match(/repo at ([0-9a-f]{7})/)?.[1] ?? null;
  try {
    return c.text(await fileDiff(cfg.workspace, base, file));
  } catch (e) {
    return c.text("");
  }
});
app.get("/api/runs/:id/tool-output/:toolUseId", (c) => {
  const p = path.join(REINS_HOME, "runs", c.req.param("id"), "tool-output", `${c.req.param("toolUseId").replace(/[^\w.-]/g, "_")}.txt`);
  if (!fs.existsSync(p)) return c.text("Full output was not kept for this call.", 404);
  return c.text(fs.readFileSync(p, "utf8"));
});
app.get("/api/workspaces", (c) => c.json({ recent: loadSettings().recentWorkspaces ?? [], home: os.homedir() }));
app.get("/api/workspaces/check", (c) => {
  const p = path.resolve(String(c.req.query("path") ?? "").replace(/^~/, os.homedir()));
  const exists = fs.existsSync(p) && fs.statSync(p).isDirectory();
  const git = exists && fs.existsSync(path.join(p, ".git"));
  const files = exists ? fs.readdirSync(p).filter((f) => !f.startsWith(".")).slice(0, 12) : [];
  return c.json({ path: p, exists, git, files, suggestions: exists ? suggestDomains(p) : [] });
});
app.post("/api/settings/api-key", async (c) => {
  const body = await c.req.json();
  const key = String(body.apiKey ?? "").trim();
  const s = loadSettings();
  if (!key) {
    delete s.apiKey;
    saveSettings(s);
    return c.json({ ok: true, hasApiKey: false });
  }
  s.apiKey = key;
  saveSettings(s);
  manager.setApiKey(key);
  return c.json({ ok: true, hasApiKey: true });
});

if (process.env.REINS_SERVE_STATIC) {
  const dist = path.resolve(here, "../../dist/web");
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), dist) }));
  app.get("*", (c) => c.html(fs.readFileSync(path.join(dist, "index.html"), "utf8")));
}

// Loopback only: the API has no auth and can start agents on this machine.
const server = serve({ fetch: app.fetch, port: PORT, hostname: process.env.REINS_HOST ?? "127.0.0.1" }, () => {
  console.log(`reins server on http://localhost:${PORT}  (home ${REINS_HOME}, api key ${manager.hasApiKey ? "present" : "missing"})`);
});

// ---- WebSocket fan-out ----------------------------------------------------
const wss = new WebSocketServer({ server: server as any, path: "/ws" });
const subs = new Map<WebSocket, Set<string>>();
const send = (ws: WebSocket, msg: ServerMessage) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};
wss.on("connection", (ws) => {
  subs.set(ws, new Set());
  send(ws, { type: "hello", info: info() });
  send(ws, { type: "runs", runs: manager.listRuns() });
  send(ws, { type: "intake", jobs: intake.list() });
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === "subscribe") {
        subs.get(ws)!.add(msg.runId);
        for (const ev of eventsFor(msg.runId, msg.fromSeq ?? 0)) send(ws, { type: "event", event: ev });
      } else if (msg.type === "unsubscribe") subs.get(ws)!.delete(msg.runId);
    } catch {
      /* ignore */
    }
  });
  ws.on("close", () => subs.delete(ws));
});
const fanOut = (ev: RunEvent) => {
  for (const [ws, ids] of subs) if (ids.has(ev.runId)) send(ws, { type: "event", event: ev });
};
manager.on("event", fanOut);
intake.on("event", fanOut);
// The Lessons section lists intake jobs; push the list when a job changes status.
intake.on("event", (ev: RunEvent) => {
  if (ev.type !== "run.status" && ev.type !== "run.created") return;
  const jobs = intake.list();
  for (const ws of subs.keys()) send(ws, { type: "intake", jobs });
});
let runsTimer: NodeJS.Timeout | null = null;
manager.on("runs", () => {
  if (runsTimer) return;
  runsTimer = setTimeout(() => {
    runsTimer = null;
    const runs = manager.listRuns();
    for (const ws of subs.keys()) send(ws, { type: "runs", runs });
  }, 150);
});
