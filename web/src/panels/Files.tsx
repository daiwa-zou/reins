import React, { useEffect, useRef, useState } from "react";
import type { RunModel } from "../state/derive";
import { Empty } from "../components/ui";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import type { ChangedFile } from "@shared/types";

/** How long after the latest tool call the Changes view asks the server for the current file list and diff. */
const REFRESH_DEBOUNCE_MS = 1500;

/**
 * Changed files and diffs against the commit the run started from. The event
 * log carries the list at phase boundaries (files.changed); for a live run the
 * server is asked again a moment after each tool call, since a call may have
 * changed files. While rewinding, only the rewound model's list is shown.
 */
export function FilesPanel({ model }: { model: RunModel }) {
  const runId = useStore((s) => s.selectedRunId)!;
  const scrubbing = useStore((s) => s.scrubSeq) !== null;
  const [files, setFiles] = useState<ChangedFile[]>(model.files);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);
  // Only the newest diff request may set the diff; an older response arriving late is ignored.
  const diffRequest = useRef(0);
  const isDemo = model.config?.engine === "replay";
  const fetchLive = !isDemo && !scrubbing;
  const calls = model.calls.length;

  useEffect(() => {
    setFiles(model.files);
  }, [model.files]);
  useEffect(() => {
    setSelected(null);
    setDiff("");
  }, [runId]);

  useEffect(() => {
    if (!fetchLive) return;
    let live = true;
    const t = setTimeout(() => api.files(runId).then((f) => live && setFiles(f)).catch(() => {}), calls ? REFRESH_DEBOUNCE_MS : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [runId, calls, fetchLive]);

  useEffect(() => {
    if (!selected || !fetchLive) return;
    const id = ++diffRequest.current;
    setLoading(true);
    const t = setTimeout(
      () =>
        api
          .diff(runId, selected)
          .then((d) => id === diffRequest.current && setDiff(d))
          .catch(() => id === diffRequest.current && setDiff(""))
          .finally(() => id === diffRequest.current && setLoading(false)),
      calls ? REFRESH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(t);
  }, [selected, runId, calls, fetchLive]);

  if (!files.length) return <Empty title="No file changes yet" body="Files the agent creates, edits or deletes in the workspace appear here with their diffs. Notes under .reins/ are excluded." />;

  return (
    <div className="h-full flex">
      <div className="w-[320px] shrink-0 border-r line overflow-auto p-2">
        {model.commits.length > 0 && (
          <div className="px-2 pb-2 mb-1 border-b line">
            <div className="text-[10.5px] uppercase tracking-wider faint font-semibold mb-1">Commits</div>
            {model.commits.map((c) => (
              <div key={c.sha} className="text-[12px] truncate" title={c.message}>
                <span className="mono muted">{c.sha}</span> {c.message}
              </div>
            ))}
          </div>
        )}
        {files.map((f) => (
          <button key={f.path} className={`w-full text-left rounded-md px-2 py-1.5 flex items-center gap-2 text-[12.5px] ${selected === f.path ? "sunk" : "hover:bg-[var(--bg-sunk)]"}`} onClick={() => setSelected(f.path)}>
            <span className={`mono text-[10px] w-3 font-bold ${f.kind === "added" ? "text-[var(--ok)]" : f.kind === "deleted" ? "text-[var(--bad)]" : "text-[var(--warn)]"}`}>{f.kind[0].toUpperCase()}</span>
            <span className="truncate flex-1 mono text-[11.5px]" title={f.path}>
              {f.path}
            </span>
            <span className="text-[11px] mono shrink-0">
              <span className="text-[var(--ok)]">+{f.additions}</span> <span className="text-[var(--bad)]">−{f.deletions}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 overflow-auto p-3">
        {!selected ? (
          <Empty title="Select a file" body={`${files.length} files changed · +${files.reduce((a, f) => a + f.additions, 0)} −${files.reduce((a, f) => a + f.deletions, 0)}`} />
        ) : isDemo ? (
          <Empty title="Diffs are not available for the recorded demo" body="In a live run this shows the diff of the selected file against the commit the run started from, refreshed as the agent works." />
        ) : scrubbing ? (
          <Empty title="Diffs show the workspace as it is now" body="Go back to live to see the current diff of this file; the file list above is as it was at the rewound point." />
        ) : loading ? (
          <div className="muted">Loading diff…</div>
        ) : (
          <DiffView text={diff} />
        )}
      </div>
    </div>
  );
}

export function DiffView({ text }: { text: string }) {
  if (!text.trim()) return <div className="muted">No diff (binary file or no changes).</div>;
  return (
    <pre className="text-[11.5px] leading-[1.5] rounded-lg border line overflow-auto">
      {text.split("\n").map((l, i) => (
        <div key={i} className={`px-3 ${l.startsWith("+") && !l.startsWith("+++") ? "diff-add" : l.startsWith("-") && !l.startsWith("---") ? "diff-del" : l.startsWith("@@") ? "diff-hunk" : ""}`}>
          {l || " "}
        </div>
      ))}
    </pre>
  );
}
