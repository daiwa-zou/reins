import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { RunConfig, RunEvent, RunSummary } from "../../../shared/types.js";
import { runChipLabel } from "../../../shared/presets.js";

export const REINS_HOME = process.env.REINS_HOME ?? path.join(os.homedir(), ".reins");
const RUNS_DIR = path.join(REINS_HOME, "runs");

function runDir(id: string) {
  return path.join(RUNS_DIR, id);
}

export function ensureHome() {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

export function saveConfig(config: RunConfig) {
  fs.mkdirSync(runDir(config.id), { recursive: true });
  fs.writeFileSync(path.join(runDir(config.id), "config.json"), JSON.stringify(config, null, 2));
}

export function loadConfig(id: string): RunConfig | null {
  const p = path.join(runDir(id), "config.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as RunConfig;
}

export function appendEvent(ev: RunEvent) {
  fs.mkdirSync(runDir(ev.runId), { recursive: true });
  fs.appendFileSync(path.join(runDir(ev.runId), "events.jsonl"), JSON.stringify(ev) + "\n");
}

export function readEvents(id: string, fromSeq = 0): RunEvent[] {
  const p = path.join(runDir(id), "events.jsonl");
  if (!fs.existsSync(p)) return [];
  const out: RunEvent[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as RunEvent;
      if (ev.seq >= fromSeq) out.push(ev);
    } catch {
      // a torn last line from a crash is dropped, never fatal
    }
  }
  return out;
}

export function listRunIds(): string[] {
  ensureHome();
  return fs
    .readdirSync(RUNS_DIR)
    .filter((d) => fs.existsSync(path.join(RUNS_DIR, d, "config.json")));
}

export function deleteRun(id: string) {
  fs.rmSync(runDir(id), { recursive: true, force: true });
}

/** Fold an event log into the list-view summary. */
export function summarize(config: RunConfig, events: RunEvent[]): RunSummary {
  let status: RunSummary["status"] = "queued";
  let phase: RunSummary["phase"];
  let round = 0;
  let costUsd = 0;
  let updatedAt = config.createdAt;
  for (const ev of events) {
    updatedAt = ev.ts;
    switch (ev.type) {
      case "run.status":
        status = ev.status;
        break;
      case "phase.started":
        phase = ev.phase;
        round = ev.round;
        break;
      case "turn.finished":
        costUsd += ev.costUsd;
        break;
    }
  }
  return {
    id: config.id,
    title: config.title,
    // The title chip: the composition label, or the old text for runs that predate Effort and Supervision.
    ...(runChipLabel(config) ? { chip: runChipLabel(config) } : {}),
    status,
    phase,
    round,
    costUsd,
    workspace: config.workspace,
    engine: config.engine,
    model: config.roles.builder.model,
    createdAt: config.createdAt,
    updatedAt,
    eventCount: events.length,
  };
}
