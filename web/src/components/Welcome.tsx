import React from "react";
import { useStore } from "../state/store";
import { Kbd, Badge } from "./ui";
import { startDemo } from "../lib/demo";

export function Welcome() {
  const openModal = useStore((s) => s.openModal);
  const info = useStore((s) => s.info);
  const lessons = useStore((s) => s.lessons);
  const setTab = useStore((s) => s.setTab);
  const booting = useStore((s) => s.booting);
  const bootError = useStore((s) => s.bootError);
  const ready = !!info?.hasApiKey || !!info?.hasClaudeCode;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto px-6 py-14 fade-in">
        <div className="text-[28px] font-semibold tracking-tight leading-tight">Describe a change. Approve what "done" means. Watch it get built and checked.</div>
        <p className="muted text-[15px] mt-3 max-w-xl leading-relaxed">
          Reins runs AI coding agents against a folder on this computer, with a planner, a builder and a separate checker. Every step is narrated in plain language and every
          design choice links to the Anthropic engineering post behind it.
        </p>

        <ol className="grid md:grid-cols-3 gap-3 mt-8 text-[13px]">
          {[
            ["1. You describe", "A sentence or two is enough. The planner turns it into a spec and a feature list in your repo."],
            ["2. You approve the definition of done", "The builder proposes concrete, checkable criteria; the checker tightens them; you edit and approve."],
            ["3. It builds, then gets checked", "The builder works one feature at a time. The checker re-runs every criterion itself and sends it back if anything fails."],
          ].map(([h, b]) => (
            <li key={h} className="card p-4">
              <div className="font-semibold mb-1">{h}</div>
              <div className="muted text-[12.5px] leading-relaxed">{b}</div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-2 mt-8">
          <button className="btn btn-primary" onClick={() => startDemo()} disabled={booting}>
            ▶ Watch the demo <Kbd>d</Kbd>
          </button>
          <button className="btn" onClick={() => openModal("newRun")} disabled={booting}>
            Start a run on your code <Kbd>n</Kbd>
          </button>
          {bootError ? (
            <Badge tone="bad">Server unreachable: {bootError}</Badge>
          ) : booting ? (
            <span className="muted text-[12.5px]">Connecting…</span>
          ) : ready ? (
            <span className="muted text-[12.5px]">Ready: {info?.hasClaudeCode ? "your Claude Code login" : "API key"} will run live runs. The demo is free.</span>
          ) : (
            <button className="btn btn-ghost" onClick={() => openModal("settings")}>
              Not ready yet: add an API key or install Claude Code →
            </button>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-3 mt-12">
          <Card title="You see the whole prompt" body="A gauge shows how full the model's context is, what it is made of, and where the harness will trim or hand off. No surprises when a long run starts forgetting." />
          <Card title="Every piece of scaffolding is a switch" body="Each helper around the model states the assumption it encodes. When a new model ships, turn one off and see whether it still earns its place." />
          <Card title="Guardrails that know the task" body="Dangerous commands are blocked outright. Ambiguous ones are judged against your task by a small classifier, so you are asked rarely and for a reason." />
          <Card title="Rewind any run" body="Every tool call, result and decision is recorded. Scrub back through a run like a flight recorder, and leave the agent a note at any point." />
          <Card title="One run proves little" body="Repeat a task and see how often it passes. Reliability, not a lucky green run, is what you are buying." />
          <Card title={`${lessons.length} lessons, linked and audited`} body="The engineering posts behind each feature are distilled into a library, with an independent audit of where each lesson lives in the code." onClick={() => setTab("lessons")} />
        </div>
      </div>
    </div>
  );
}

function Card({ title, body, onClick }: { title: string; body: string; onClick?: () => void }) {
  const cls = `card p-4 text-left ${onClick ? "cursor-pointer hover:border-[var(--line-strong)]" : ""}`;
  const inner = (
    <>
      <div className="font-semibold mb-1">{title}</div>
      <div className="muted text-[12.5px] leading-relaxed">{body}</div>
    </>
  );
  return onClick ? (
    <button className={cls} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
