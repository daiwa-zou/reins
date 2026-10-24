import React from "react";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { Kbd } from "./ui";

export function Welcome() {
  const openModal = useStore((s) => s.openModal);
  const selectRun = useStore((s) => s.selectRun);
  const toastMsg = useStore((s) => s.toastMsg);
  const info = useStore((s) => s.info);
  const lessons = useStore((s) => s.lessons);
  const setTab = useStore((s) => s.setTab);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto px-6 py-14 fade-in">
        <div className="text-[28px] font-semibold tracking-tight leading-tight">A harness you can see.</div>
        <p className="muted text-[15px] mt-3 max-w-xl leading-relaxed">
          Reins runs a planner, a builder and a skeptical evaluator against your repository. Every piece of scaffolding around the model is a switch you can flip, every
          decision is narrated in plain language, and every lesson it is built on is one click away.
        </p>
        <div className="flex flex-wrap gap-2 mt-6">
          <button className="btn btn-primary" onClick={() => api.demo().then((c) => selectRun(c.id)).catch((e) => toastMsg(e.message, "error"))}>
            ▶ Watch a recorded run <Kbd>d</Kbd>
          </button>
          <button className="btn" onClick={() => openModal("newRun")}>
            Start a run on your code <Kbd>n</Kbd>
          </button>
          {!info?.hasApiKey && !info?.hasClaudeCode && (
            <button className="btn btn-ghost" onClick={() => openModal("settings")}>
              Add an API key for live runs →
            </button>
          )}
          {!info?.hasApiKey && info?.hasClaudeCode && <span className="muted text-[12.5px] self-center">Live runs use your Claude Code login; no API key needed.</span>}
        </div>

        <div className="grid md:grid-cols-3 gap-3 mt-12">
          <Card title="Contract before code" body="The builder proposes what 'done' means and how to verify it. The evaluator pushes back. You approve the final list, and the evaluator holds the builder to exactly that." />
          <Card title="Context as a fuel gauge" body="See the prompt grow turn by turn, what it is made of, and where compaction or a handoff will kick in. Watch for the agent wrapping up early." />
          <Card title="Switchable scaffolding" body="Each harness component states the assumption about the model it encodes. When a new model ships, turn pieces off one at a time and see what still earns its place." />
          <Card title="Guardrails that know the task" body="Hard rules deny the dangerous. An action classifier that sees only your task and the proposed command decides the ambiguous. You get asked rarely, and for good reason." />
          <Card title="Read the transcript" body="Every tool call, result and decision is recorded. Scrub backwards through a run like a flight recorder, and whisper a note to the agent at any point." />
          <Card title={`${lessons.length} lessons, linked`} body="The engineering posts that justify each feature are distilled into a library the agents themselves can consult." onClick={() => setTab("lessons")} />
        </div>
      </div>
    </div>
  );
}

function Card({ title, body, onClick }: { title: string; body: string; onClick?: () => void }) {
  return (
    <div className={`card p-4 ${onClick ? "cursor-pointer hover:border-[var(--line-strong)]" : ""}`} onClick={onClick}>
      <div className="font-semibold mb-1">{title}</div>
      <div className="muted text-[12.5px] leading-relaxed">{body}</div>
    </div>
  );
}
