import type { ApprovalDecision, Composition, IntakeJobSummary, EngineId, PresetCompatibility, ContractCriterion, HarnessComponent, Lesson, LessonProblem, Preset, PresetConfig, PublishDraft, RunConfig, RunSummary, ServerInfo, SkillInfo, ChangedFile, TrialSet, UserDomain, McpServerSpec } from "@shared/types";

export type PresetEntry = Preset & { isDefault: boolean; compatibility?: Record<EngineId, PresetCompatibility> };
export interface PresetList {
  presets: PresetEntry[];
  default: string | null;
  defaultComposition?: Composition & { engine?: EngineId };
  file: string;
}

export interface LessonAudit {
  slug: string;
  checkedAgainstOriginal: string;
  rows: { learning: string; where: string; status: "implemented" | "partial" | "gap" }[];
  gaps: string[];
  counts: { implemented: number; partial: number; gap: number };
}

/** GET /api/lessons/:slug/derived and the DELETE response: what hangs off a lesson in your library. */
export interface LessonDerived {
  slug: string;
  file: string;
  intakeJobs: string[];
  domains: { id: string; label: string; dropped: string[]; deleted: boolean }[];
  presets: { name: string; deleted: boolean }[];
  revealsBundled: boolean;
}

/** POST /api/intake refused the source: it matches a lesson in the library, or an intake job still in progress. */
export class IntakeRefusedError extends Error {
  constructor(
    message: string,
    public readonly duplicate: { kind: "lesson" | "job"; slug: string; jobId?: string; status?: string } | null,
  ) {
    super(message);
  }
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
  lessonProblems: () => fetch("/api/lessons/problems").then((r) => j<{ problems: LessonProblem[]; userDir: string; bundledDir: string }>(r)),
  presets: () => fetch("/api/presets").then((r) => j<PresetList>(r)),
  domains: () => fetch("/api/domains").then((r) => j<UserDomain[]>(r)),
  saveDomain: (body: Pick<UserDomain, "id" | "label" | "description" | "implications">) => post("/api/domains", body).then((r) => j<UserDomain>(r)),
  deleteDomain: (id: string) => fetch(`/api/domains/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
  savePreset: (body: { name: string; description?: string; config: PresetConfig; default?: boolean; lessons?: string[] }) => post("/api/presets", body).then((r) => j<{ preset: Preset; dropped: string[]; default: string | null }>(r)),
  deletePreset: (name: string) => fetch(`/api/presets/${encodeURIComponent(name)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
  setDefaultPreset: (name: string | null) => post("/api/presets/default", { name }).then((r) => j<{ default: string | null }>(r)),
  skills: (workspace?: string) => fetch(`/api/skills${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`).then((r) => j<SkillInfo[]>(r)),
  runs: () => fetch("/api/runs").then((r) => j<RunSummary[]>(r)),
  createRun: (body: Partial<RunConfig> & { task: string; workspace: string }) => post("/api/runs", body).then((r) => j<RunConfig>(r)),
  demo: () => post("/api/runs/demo").then((r) => j<RunConfig>(r)),
  deleteRun: (id: string) => fetch(`/api/runs/${id}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
  approve: (id: string, approvalId: string, decision: ApprovalDecision, note?: string, extra: { criteria?: ContractCriterion[]; lesson?: unknown; publish?: PublishDraft } = {}) =>
    post(`/api/runs/${id}/approve`, { approvalId, decision, note, ...extra }).then((r) => j<{ ok: true }>(r)),
  lessonDerived: (slug: string) => fetch(`/api/lessons/${encodeURIComponent(slug)}/derived`).then((r) => j<LessonDerived>(r)),
  deleteLesson: (slug: string) => fetch(`/api/lessons/${encodeURIComponent(slug)}`, { method: "DELETE" }).then((r) => j<LessonDerived>(r)),
  setStanding: (slug: string, standing: "reviewed" | "unreviewed") => post(`/api/lessons/${encodeURIComponent(slug)}/standing`, { standing }).then((r) => j<Lesson>(r)),
  mcpServers: () => fetch("/api/mcp-servers").then((r) => j<{ name: string; from: "project" | "local" | "user"; transport: "http" | "stdio" }[]>(r)),
  startIntake: async (body: { url?: string; text?: string; repo?: string; ref?: string; mcp?: Partial<McpServerSpec> & { name: string }; focus?: string }) => {
    const r = await post("/api/intake", body);
    if (r.status === 409) {
      const b = await r.json().catch(() => ({}));
      throw new IntakeRefusedError(b.error ?? "This source is already taken in.", b.duplicate ?? null);
    }
    return j<{ id: string; slug: string }>(r);
  },
  intakeJobs: () => fetch("/api/intake").then((r) => j<IntakeJobSummary[]>(r)),
  steer: (id: string, text: string) => post(`/api/runs/${id}/steer`, { text }).then((r) => j<{ ok: true }>(r)),
  pause: (id: string) => post(`/api/runs/${id}/pause`).then((r) => j<{ ok: true }>(r)),
  resume: (id: string) => post(`/api/runs/${id}/resume`).then((r) => j<{ ok: true }>(r)),
  cancel: (id: string) => post(`/api/runs/${id}/cancel`).then((r) => j<{ ok: true }>(r)),
  files: (id: string) => fetch(`/api/runs/${id}/files`).then((r) => j<ChangedFile[]>(r)),
  diff: (id: string, file: string) =>
    fetch(`/api/runs/${id}/diff?file=${encodeURIComponent(file)}`).then((r) => {
      if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
      return r.text();
    }),
  workspaces: () => fetch("/api/workspaces").then((r) => j<{ recent: string[]; home: string }>(r)),
  checkWorkspace: (p: string) => fetch(`/api/workspaces/check?path=${encodeURIComponent(p)}`).then((r) => j<{ path: string; exists: boolean; git: boolean; files: string[]; suggestions?: { domain: string; reason: string }[] }>(r)),
  trials: (k = 3) => fetch(`/api/trials?k=${k}`).then((r) => j<TrialSet[]>(r)),
  repeat: (id: string, k: number) => post(`/api/runs/${id}/repeat?k=${k}`).then((r) => j<{ ok: true; k: number }>(r)),
  audit: () => fetch("/api/audit").then((r) => j<LessonAudit[]>(r)),
  testConnection: (model?: string) => post("/api/settings/test", { model }).then((r) => j<{ ok: true; model: string; usage: { input: number; output: number; cacheRead: number; cacheWrite: number }; degraded: string[]; ms: number } | { ok: false; error: string; status?: number }>(r)),
  setApiKey: (apiKey: string) => post("/api/settings/api-key", { apiKey }).then((r) => j<{ ok: true; hasApiKey: boolean }>(r)),
};
