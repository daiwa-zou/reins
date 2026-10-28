import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { RunConfig, RunEvent, RunSummary } from "../../../shared/types.js";
import { runChipLabel } from "../../../shared/presets.js";

/** The state directory, read at call time so tests and scripts can point REINS_HOME elsewhere after import. */
export const reinsHome = () => process.env.REINS_HOME ?? path.join(os.homedir(), ".reins");
/** The state directory as it was at startup: the runs store and the server bind to it once. */
export const REINS_HOME = reinsHome();
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

/** Append one event to a JSONL log, creating its directory. */
export function appendEventLine(file: string, ev: RunEvent) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(ev) + "\n");
}

/** Read a JSONL event log from `fromSeq`. A torn last line from a crash is dropped, never fatal. */
export function readEventFile(file: string, fromSeq = 0): RunEvent[] {
  if (!fs.existsSync(file)) return [];
  const out: RunEvent[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as RunEvent;
      if (ev.seq >= fromSeq) out.push(ev);
    } catch {
      /* torn last line */
    }
  }
  return out;
}

const eventsFile = (id: string) => path.join(runDir(id), "events.jsonl");

export function appendEvent(ev: RunEvent) {
  appendEventLine(eventsFile(ev.runId), ev);
}

export function readEvents(id: string, fromSeq = 0): RunEvent[] {
  return readEventFile(eventsFile(id), fromSeq);
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
  let pkg: RunSummary["package"];
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
        pkg = ev.package;
        break;
      case "turn.finished":
        costUsd += ev.costUsd;
        break;
    }
  }
  // The title chip: the composition label, or the old text for runs that predate Effort and Supervision.
  const chip = runChipLabel(config);
  return {
    id: config.id,
    title: config.title,
    ...(chip ? { chip } : {}),
    status,
    phase,
    round,
    ...(pkg ? { package: pkg } : {}),
    costUsd,
    workspace: config.workspace,
    engine: config.engine,
    model: config.roles.builder.model,
    createdAt: config.createdAt,
    updatedAt,
    eventCount: events.length,
  };
}
