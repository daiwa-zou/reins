import React from "react";
import { ArrowRight, CirclePlay, Plus } from "lucide-react";
import { useStore } from "../state/store";
import { Kbd, Badge } from "./ui";
import { startDemo } from "../lib/demo";

const STEPS: [string, string][] = [
  ["You describe", "A sentence or two. The planner turns it into a spec and a feature list in your repo."],
  ["You approve what “done” means", "The builder proposes checkable criteria, the checker tightens them, you edit and approve."],
  ["It builds, then gets checked", "One feature at a time. The checker re-runs every criterion and sends it back if anything fails."],
];

export function Welcome() {
  const openModal = useStore((s) => s.openModal);
  const navigate = useStore((s) => s.navigate);
  const info = useStore((s) => s.info);
  const booting = useStore((s) => s.booting);
  const bootError = useStore((s) => s.bootError);
  const ready = !!info?.hasApiKey || !!info?.hasClaudeCode;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-16 fade-in">
        <h1 className="text-2xl font-semibold tracking-tight leading-tight">Describe a change. Approve what “done” means. Watch it get built and checked.</h1>
        <p className="muted text-title mt-3 leading-relaxed">Reins runs AI coding agents on a folder on this computer, with a planner, a builder and a separate checker, and narrates every step.</p>

        <div className="flex flex-wrap items-center gap-2 mt-7">
          <button className="btn btn-primary" onClick={() => startDemo()} disabled={booting}>
            <CirclePlay size={15} aria-hidden /> Watch the demo <Kbd>d</Kbd>
          </button>
          <button className="btn" onClick={() => openModal("newRun")} disabled={booting}>
            <Plus size={15} aria-hidden /> Start a run on your code <Kbd>n</Kbd>
          </button>
        </div>
        <div className="mt-3 text-small">
          {bootError ? (
            <Badge tone="bad">Server unreachable: {bootError}</Badge>
          ) : booting ? (
            <span className="muted">Connecting…</span>
          ) : ready ? (
            <span className="muted">Ready: {info?.hasClaudeCode ? "your Claude Code login" : "an API key"} will run live runs. The demo is free.</span>
          ) : (
            <button className="underline muted hover:text-[var(--fg)]" onClick={() => openModal("settings")}>
              Not ready for live runs yet: add an API key or install Claude Code
            </button>
          )}
        </div>

        <ol className="mt-10 flex flex-col gap-3">
          {STEPS.map(([h, b], i) => (
            <li key={h} className="flex gap-3">
              <span className="w-6 h-6 rounded-full sunk flex items-center justify-center text-small font-semibold shrink-0 muted">{i + 1}</span>
              <div>
                <div className="font-semibold">{h}</div>
                <div className="muted text-small leading-relaxed">{b}</div>
              </div>
            </li>
          ))}
        </ol>

        <button className="mt-10 text-small muted hover:text-[var(--fg)] inline-flex items-center gap-1" onClick={() => navigate({ section: "harness" })}>
          What’s inside: the harness components and the lessons behind them <ArrowRight size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
