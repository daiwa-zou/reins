import type { ContractCriterion, HarnessComponent, Lesson, RunConfig, RunEvent, RunSummary, ServerInfo, ChangedFile, TrialSet } from "@shared/types";

export interface LessonAudit {
  slug: string;
  checkedAgainstOriginal: string;
  rows: { learning: string; where: string; status: "implemented" | "partial" | "gap" }[];
  gaps: string[];
  counts: { implemented: number; partial: number; gap: number };
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  info: () => fetch("/api/info").then((r) => j<ServerInfo>(r)),
  components: () => fetch("/api/components").then((r) => j<HarnessComponent[]>(r)),
  lessons: () => fetch("/api/lessons").then((r) => j<Lesson[]>(r)),
  runs: () => fetch("/api/runs").then((r) => j<RunSummary[]>(r)),
  run: (id: string) => fetch(`/api/runs/${id}`).then((r) => j<{ config: RunConfig; events: RunEvent[]; active: boolean }>(r)),
  createRun: (body: Partial<RunConfig> & { task: string; workspace: string }) => post("/api/runs", body).then((r) => j<RunConfig>(r)),
  demo: () => post("/api/runs/demo").then((r) => j<RunConfig>(r)),
  deleteRun: (id: string) => fetch(`/api/runs/${id}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
  approve: (id: string, approvalId: string, decision: "approve" | "reject", note?: string, criteria?: ContractCriterion[]) =>
    post(`/api/runs/${id}/approve`, { approvalId, decision, note, criteria }).then((r) => j<{ ok: true }>(r)),
  steer: (id: string, text: string) => post(`/api/runs/${id}/steer`, { text }).then((r) => j<{ ok: true }>(r)),
  pause: (id: string) => post(`/api/runs/${id}/pause`).then((r) => j<{ ok: true }>(r)),
  resume: (id: string) => post(`/api/runs/${id}/resume`).then((r) => j<{ ok: true }>(r)),
  cancel: (id: string) => post(`/api/runs/${id}/cancel`).then((r) => j<{ ok: true }>(r)),
  files: (id: string) => fetch(`/api/runs/${id}/files`).then((r) => j<ChangedFile[]>(r)),
  diff: (id: string, file: string) => fetch(`/api/runs/${id}/diff?file=${encodeURIComponent(file)}`).then((r) => r.text()),
  workspaces: () => fetch("/api/workspaces").then((r) => j<{ recent: string[]; home: string }>(r)),
  checkWorkspace: (p: string) => fetch(`/api/workspaces/check?path=${encodeURIComponent(p)}`).then((r) => j<{ path: string; exists: boolean; git: boolean; files: string[] }>(r)),
  trials: (k = 3) => fetch(`/api/trials?k=${k}`).then((r) => j<TrialSet[]>(r)),
  repeat: (id: string, k: number) => post(`/api/runs/${id}/repeat?k=${k}`).then((r) => j<{ ok: true; k: number }>(r)),
  audit: () => fetch("/api/audit").then((r) => j<LessonAudit[]>(r)),
  testConnection: (model?: string) => post("/api/settings/test", { model }).then((r) => j<{ ok: true; model: string; usage: { input: number; output: number; cacheRead: number; cacheWrite: number }; degraded: string[]; ms: number } | { ok: false; error: string; status?: number }>(r)),
  setApiKey: (apiKey: string) => post("/api/settings/api-key", { apiKey }).then((r) => j<{ ok: true; hasApiKey: boolean }>(r)),
};
