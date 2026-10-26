import type { RunConfig, RunEvent, RunSummary, Trial, TrialSet } from "../../../shared/types.js";
import { groupTrials } from "../../../shared/components.js";
import { listRunIds, loadConfig, readEvents, summarize } from "../store/runStore.js";

/** One run as a trial: outcome, cost, duration and how many fix rounds it needed. */
export function trialFromEvents(config: RunConfig, events: RunEvent[]): Trial {
  const s = summarize(config, events);
  let verdict: Trial["verdict"] = "none";
  let fixRounds = 0;
  let durationMs = 0;
  let harnessVersion: string | undefined;
  for (const ev of events) {
    if (ev.type === "evaluation.result") verdict = ev.verdict;
    if (ev.type === "phase.started" && ev.phase === "build" && ev.round > 1) fixRounds = ev.round - 1;
    if (ev.type === "run.summary") durationMs = ev.durationMs;
    if (ev.type === "note" && ev.text.startsWith("Environment")) harnessVersion = ev.text.match(/reins ([\d.]+)/)?.[1];
  }
  if (!durationMs && events.length) durationMs = Date.parse(events[events.length - 1].ts) - Date.parse(events[0].ts);
  // A run killed by a server restart says nothing about the agent; count it like a cancel, not a failure.
  const last = [...events].reverse().find((e) => e.type === "run.status") as Extract<RunEvent, { type: "run.status" }> | undefined;
  const status = s.status === "failed" && /^Interrupted/.test(last?.reason ?? "") ? "cancelled" : s.status;
  const errors = events.filter((e): e is Extract<RunEvent, { type: "error" }> => e.type === "error").map((e) => e.message);
  const infra = /Interrupted|Model call failed|engine failed|rate limit|overloaded|connection|timed out|Transient API error/i;
  const failureKind: Trial["failureKind"] = status === "completed" && verdict === "pass" ? "none" : errors.some((m) => infra.test(m)) || /^Interrupted/.test(last?.reason ?? "") ? "infra" : "agent";
  return { runId: config.id, title: config.task, status, verdict, costUsd: s.costUsd, durationMs, fixRounds, createdAt: config.createdAt, engine: config.engine, model: config.roles.builder.model, harnessVersion, failureKind, originWorkspace: config.origin?.workspace, fresh: config.origin?.fresh };
}

export function allTrialSets(k = 3): TrialSet[] {
  const runs: RunSummary[] = [];
  const trials = new Map<string, Trial>();
  for (const id of listRunIds()) {
    const cfg = loadConfig(id);
    // Intake jobs live under $REINS_HOME/lessons/<slug>/, not runs/, and are never trials; guard anyway.
    if (!cfg || cfg.job === "intake") continue;
    const events = readEvents(id);
    runs.push(summarize(cfg, events));
    trials.set(id, trialFromEvents(cfg, events));
  }
  return groupTrials(runs, trials, k);
}
