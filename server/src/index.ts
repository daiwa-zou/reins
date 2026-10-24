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
import { COMPONENTS, HARNESS_VERSION, MODELS } from "../../shared/components.js";
import { RunManager } from "./engine/runManager.js";
import { ensureHome, REINS_HOME } from "./store/runStore.js";
import { listLessons } from "./lessons.js";
import { changedFiles, fileDiff, headSha } from "./workspace.js";
import { loadDemoEvents } from "./engine/replay.js";
import { allTrialSets } from "./engine/trials.js";
import { sandboxAvailable } from "./tools/sandbox.js";

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
app.get("/api/components", (c) => c.json(COMPONENTS));
app.get("/api/lessons", (c) => c.json(listLessons()));
app.get("/api/runs", (c) => c.json(manager.listRuns()));
app.get("/api/trials", (c) => c.json(allTrialSets(Number(c.req.query("k") ?? 3))));
app.post("/api/runs/:id/repeat", (c) => {
  const k = Math.max(1, Math.min(10, Number(c.req.query("k") ?? 3)));
  manager.repeat(c.req.param("id"), k).catch((e) => console.error("repeat failed", e));
  return c.json({ ok: true, k });
});
app.get("/api/runs/:id", (c) => {
  const cfg = manager.config(c.req.param("id"));
  if (!cfg) return c.json({ error: "not found" }, 404);
  return c.json({ config: cfg, events: manager.events(cfg.id), pending: manager.pendingApprovals(cfg.id), active: manager.isActive(cfg.id) });
});
app.get("/api/runs/:id/events", (c) => c.json(manager.events(c.req.param("id"), Number(c.req.query("from") ?? 0))));
app.post("/api/runs", async (c) => {
  const body = await c.req.json();
  if (!body.task || !body.workspace) return c.json({ error: "task and workspace are required" }, 400);
  const ws = path.resolve(String(body.workspace).replace(/^~/, os.homedir()));
  if (body.engine !== "replay" && !fs.existsSync(ws)) return c.json({ error: `Workspace does not exist: ${ws}` }, 400);
  const s = loadSettings();
  s.recentWorkspaces = [ws, ...(s.recentWorkspaces ?? []).filter((w) => w !== ws)].slice(0, 8);
  saveSettings(s);
  const cfg = manager.createRun({ ...body, workspace: ws });
  return c.json(cfg);
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
  } as any);
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
    manager.approve(c.req.param("id"), body.approvalId, body.decision, body.note, body.criteria);
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
      manager[action](c.req.param("id"));
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
app.get("/api/workspaces", (c) => c.json({ recent: loadSettings().recentWorkspaces ?? [], home: os.homedir() }));
app.get("/api/workspaces/check", (c) => {
  const p = path.resolve(String(c.req.query("path") ?? "").replace(/^~/, os.homedir()));
  const exists = fs.existsSync(p) && fs.statSync(p).isDirectory();
  const git = exists && fs.existsSync(path.join(p, ".git"));
  const files = exists ? fs.readdirSync(p).filter((f) => !f.startsWith(".")).slice(0, 12) : [];
  return c.json({ path: p, exists, git, files });
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

const server = serve({ fetch: app.fetch, port: PORT }, () => {
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
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === "subscribe") {
        subs.get(ws)!.add(msg.runId);
        for (const ev of manager.events(msg.runId, msg.fromSeq ?? 0)) send(ws, { type: "event", event: ev });
      } else if (msg.type === "unsubscribe") subs.get(ws)!.delete(msg.runId);
    } catch {
      /* ignore */
    }
  });
  ws.on("close", () => subs.delete(ws));
});
manager.on("event", (ev: RunEvent) => {
  for (const [ws, ids] of subs) if (ids.has(ev.runId)) send(ws, { type: "event", event: ev });
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
