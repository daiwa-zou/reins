import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApprovalRequest, RunConfig, RunEvent } from "../../../shared/types.js";
import { RunBus } from "./bus.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEMO_FILE = process.env.REINS_DEMO_FILE ?? path.resolve(here, "../../../demo/sample-run.jsonl");

export interface ReplayControl {
  signal: AbortSignal;
  waitIfPaused: () => Promise<void>;
  drainSteer: () => string[];
  /** Ask the person; resolves once answered, with the run shown as running again. */
  ask: (request: Omit<ApprovalRequest, "approvalId">) => Promise<{ approved: boolean; note?: string }>;
}

export function loadDemoEvents(): RunEvent[] {
  if (!fs.existsSync(DEMO_FILE)) return [];
  return fs
    .readFileSync(DEMO_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunEvent);
}

/**
 * Replays a recorded event log through a fresh bus, compressing the original
 * timing. Approval requests in the recording become real approval prompts so
 * the demo exercises the same UI as a live run. Operator notes typed during
 * the replay are echoed back as delivered so the steering channel is visible.
 */
export async function startReplay(bus: RunBus, config: RunConfig, control: ReplayControl) {
  const events = loadDemoEvents();
  if (!events.length) {
    bus.emitEvent({ type: "error", message: `No demo recording found at ${DEMO_FILE}. Run "npm run record-demo" to generate one.`, recoverable: false });
    return;
  }
  const speed = Number(process.env.REINS_REPLAY_SPEED ?? 1);
  let prev = events[0] ? Date.parse(events[0].ts) : Date.now();
  for (const ev of events) {
    if (control.signal.aborted) return;
    await control.waitIfPaused();
    const t = Date.parse(ev.ts);
    const gap = Math.min(2500, Math.max(60, (t - prev) / speed));
    prev = t;
    await new Promise((r) => setTimeout(r, gap));
    if (control.signal.aborted) return;

    for (const note of control.drainSteer()) bus.emitEvent({ type: "steer.delivered", text: note, role: "builder" });

    if (ev.type === "run.created" || ev.type === "run.status") continue; // the manager owns these
    if (ev.type === "approval.requested") {
      const { approvalId: _drop, ...rest } = ev.request;
      const r = await control.ask(rest);
      if (control.signal.aborted) return;
      if (!r.approved) {
        bus.emitEvent({ type: "note", level: "info", text: "You rejected this step. In a live run the agent would be told why and adjust; the demo continues anyway." });
      }
      continue;
    }
    if (ev.type === "approval.resolved") continue;
    const { seq: _s, ts: _t, runId: _r, ...payload } = ev;
    bus.emitEvent(payload as any);
  }
}
