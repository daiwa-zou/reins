import { create } from "zustand";
import type { Composition, EngineId, HarnessComponent, IntakeJobSummary, Lesson, RunEvent, RunSummary, ServerInfo, ServerMessage } from "@shared/types";
import { api, type PresetEntry } from "../lib/api";
import { tagUserDomains } from "@shared/domains";
import { decodeNav, encodeNav, isKnownRun, normalizeNav, sameNav, type DetailsSub, type NavState, type RunView, type Section } from "./nav";

export type { Section, RunView, DetailsSub, NavState } from "./nav";
/** The run views, in tab order. App sections (Runs, Reliability, Harness, Lessons) live in nav.ts SECTIONS. */
export { RUN_VIEWS, DETAILS_SUBS, SECTIONS } from "./nav";

type Theme = "light" | "dark" | "system";

interface State {
  info?: ServerInfo;
  connected: boolean;
  runs: RunSummary[];
  /** Lesson intake jobs (never in the Runs list; listed on Lessons, openable on the Stage by id). */
  intakeJobs: IntakeJobSummary[];
  refreshIntake: () => Promise<void>;
  components: HarnessComponent[];
  lessons: Lesson[];
  selectedRunId: string | null;
  events: Record<string, RunEvent[]>;
  /** App section (left sidebar). */
  section: Section;
  /** View of the selected run (tab bar under the run header). */
  view: RunView;
  /** Sub-view of Details. */
  sub: DetailsSub;
  /** Overview rail open (persisted). */
  overviewOpen: boolean;
  /** Show model thinking in Activity (persisted, off by default). */
  showThinking: boolean;
  theme: Theme;
  modal: null | "newRun" | "settings" | "help" | "domainBuilder";
  newRunPrefill?: Partial<import("@shared/types").RunConfig>;
  /** The user's domains built from implications ($REINS_HOME/domains.json); the library in `lessons` is tagged with them. */
  userDomains: import("@shared/types").UserDomain[];
  refreshDomains: () => Promise<void>;
  /** What the domain builder opens on: an existing domain to edit, or a lesson to seed from. */
  domainDraft: { domain?: import("@shared/types").UserDomain | null; lesson?: import("@shared/types").Lesson | null } | null;
  openDomainBuilder: (seed?: State["domainDraft"]) => void;
  /** Scrubber: show state as of this seq (null = live). */
  scrubSeq: number | null;
  /** Open lesson (Lessons section), mirrored in the URL as ?lesson=. */
  lesson: string | null;
  /** Lessons: component filter; Harness: focused card. Mirrored in the URL as ?component=. */
  component: string | null;
  /** Harness: focused skill row. Mirrored in the URL as ?skill=. */
  skill: string | null;
  presets: PresetEntry[];
  defaultPreset: string | null;
  /** The composition New run opens on (the default preset's, or a retired default migrated). */
  defaultComposition: (Composition & { engine?: EngineId }) | null;
  refreshPresets: () => Promise<void>;
  refreshLessons: () => Promise<void>;
  toast?: { text: string; kind: "info" | "error" };
  booting: boolean;
  bootError: string | null;
  /** Approval drafts survive tab switches. */
  approvalDrafts: Record<string, { criteria: import("@shared/types").ContractCriterion[]; note: string; lesson?: import("./lessonDraft").LessonDraftState } | undefined>;
  /** New-run form draft survives closing the dialog. */
  newRunDraft: Partial<import("@shared/types").RunConfig> | null;

  setApprovalDraft: (id: string, draft: { criteria: import("@shared/types").ContractCriterion[]; note: string; lesson?: import("./lessonDraft").LessonDraftState } | null) => void;
  setNewRunDraft: (d: Partial<import("@shared/types").RunConfig> | null) => void;
  /** Which live engine the server can run right now. */
  availableEngine: () => "anthropic" | "claude-code";

  boot: () => Promise<void>;
  /** Select a run (opens the Runs section). `replace` rewrites history instead of adding an entry. */
  selectRun: (id: string | null, opts?: { replace?: boolean; view?: RunView }) => void;
  /** Change any part of the navigation state; synced to the URL with pushState. */
  navigate: (patch: Partial<NavState>, opts?: { replace?: boolean }) => void;
  /** Re-read navigation from the URL (back/forward). */
  syncFromUrl: () => void;
  nav: () => NavState;
  setOverviewOpen: (open: boolean) => void;
  setShowThinking: (on: boolean) => void;
  setTheme: (t: Theme) => void;
  openModal: (m: State["modal"], prefill?: State["newRunPrefill"]) => void;
  setScrub: (seq: number | null) => void;
  /** Open a lesson (or the list with null) in the Lessons section. */
  setLessonFilter: (slug: string | null) => void;
  toastMsg: (text: string, kind?: "info" | "error") => void;
  refreshInfo: () => Promise<void>;
}

let ws: WebSocket | null = null;
let booted = false;
const subscribed = new Set<string>();

function connect(set: (p: Partial<State> | ((s: State) => Partial<State>)) => void, get: () => State) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    set({ connected: true });
    for (const id of subscribed) {
      const have = get().events[id]?.length ?? 0;
      sock.send(JSON.stringify({ type: "subscribe", runId: id, fromSeq: have }));
    }
  };
  sock.onclose = () => {
    set({ connected: false });
    if (ws === sock) {
      ws = null;
      setTimeout(() => connect(set, get), 1500);
    }
  };
  sock.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMessage;
    if (msg.type === "hello") set({ info: msg.info });
    else if (msg.type === "runs") set({ runs: msg.runs });
    else if (msg.type === "intake") set({ intakeJobs: msg.jobs });
    else if (msg.type === "event") {
      const ev = msg.event;
      set((s) => {
        const list = s.events[ev.runId] ?? [];
        if (list.length && list[list.length - 1].seq >= ev.seq) {
          // out of order or duplicate (replayed catch-up): insert/replace by seq
          const idx = list.findIndex((x) => x.seq === ev.seq);
          if (idx >= 0) return {};
          const copy = [...list, ev].sort((a, b) => a.seq - b.seq);
          return { events: { ...s.events, [ev.runId]: copy } };
        }
        return { events: { ...s.events, [ev.runId]: [...list, ev] } };
      });
    }
  };
}

function subscribe(id: string, fromSeq: number) {
  subscribed.add(id);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "subscribe", runId: id, fromSeq }));
}

const savedTheme = (localStorage.getItem("reins.theme") as Theme | null) ?? "system";
function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
applyTheme(savedTheme);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(useStore.getState().theme));

const PREF_OVERVIEW = "reins.overviewOpen";
const PREF_THINKING = "reins.showThinking";
function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function writePref(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* private mode: the toggle still works for this session */
  }
}

/** Write the nav state to the address bar. Back/forward replays it via syncFromUrl. */
function writeUrl(nav: NavState, replace: boolean) {
  const next = location.pathname + encodeNav(nav) + location.hash;
  if (next === location.pathname + location.search + location.hash) return;
  if (replace) history.replaceState(null, "", next);
  else history.pushState(null, "", next);
}

export const useStore = create<State>((set, get) => ({
  connected: false,
  runs: [],
  intakeJobs: [],
  components: [],
  lessons: [],
  selectedRunId: null,
  events: {},
  section: "runs",
  view: "activity",
  sub: "transcript",
  // Closed unless asked for: the run header carries the budget, and Progress opens the rail on demand.
  overviewOpen: readPref(PREF_OVERVIEW, false),
  showThinking: readPref(PREF_THINKING, false),
  theme: savedTheme,
  modal: null,
  userDomains: [],
  domainDraft: null,
  scrubSeq: null,
  lesson: null,
  component: null,
  skill: null,
  presets: [],
  defaultPreset: null,
  defaultComposition: null,
  booting: true,
  bootError: null,
  approvalDrafts: {},
  newRunDraft: null,

  setApprovalDraft: (id, draft) => set((s) => ({ approvalDrafts: { ...s.approvalDrafts, [id]: draft ?? undefined } })),
  setNewRunDraft: (newRunDraft) => set({ newRunDraft }),
  availableEngine: () => (get().info?.hasApiKey ? "anthropic" : get().info?.hasClaudeCode ? "claude-code" : "anthropic"),

  boot: async () => {
    if (booted) return;
    booted = true;
    connect(set, get);
    let info, components, lessons, runs, intakeJobs: IntakeJobSummary[] = [];
    let userDomains: import("@shared/types").UserDomain[] = [];
    try {
      [info, components, lessons, runs, intakeJobs, userDomains] = await Promise.all([api.info(), api.components(), api.lessons(), api.runs(), api.intakeJobs().catch(() => [] as IntakeJobSummary[]), api.domains().catch(() => [])]);
    } catch (e) {
      booted = false;
      set({ booting: false, bootError: (e as Error).message });
      return;
    }
    set({ info, components, lessons: tagUserDomains(lessons, userDomains), userDomains, runs, intakeJobs, booting: false, bootError: null });
    void get().refreshPresets();
    const known = (id: string) => isKnownRun(get(), id);
    const fromUrl = decodeNav(location.search, { runExists: known });
    const latest = get().runs;
    const pick = fromUrl.run ?? latest.find((r) => r.status === "running" || r.status === "waiting_approval")?.id ?? latest[0]?.id ?? null;
    get().navigate({ ...fromUrl, run: pick }, { replace: true });
  },
  nav: () => {
    const s = get();
    return { section: s.section, run: s.selectedRunId, view: s.view, sub: s.sub, lesson: s.lesson, component: s.component, skill: s.skill };
  },
  navigate: (patch, opts) => {
    const prev = get().nav();
    const next = normalizeNav({ ...prev, ...patch });
    if (!sameNav(prev, next)) {
      set({ section: next.section, selectedRunId: next.run, view: next.view, sub: next.sub, lesson: next.lesson ?? null, component: next.component ?? null, skill: next.skill ?? null, ...(next.run !== prev.run ? { scrubSeq: null } : {}) });
      if (next.run && next.run !== prev.run) subscribe(next.run, get().events[next.run]?.length ?? 0);
    }
    writeUrl(next, !!opts?.replace);
  },
  syncFromUrl: () => {
    const s = get();
    // Before boot has loaded the run list we cannot tell a stale id from a real one; keep it.
    const known = s.booting ? undefined : (id: string) => isKnownRun(s, id);
    const next = decodeNav(location.search, { runExists: known });
    const prev = s.nav();
    if (sameNav(prev, next)) return;
    set({ section: next.section, selectedRunId: next.run, view: next.view, sub: next.sub, lesson: next.lesson ?? null, component: next.component ?? null, skill: next.skill ?? null, ...(next.run !== prev.run ? { scrubSeq: null } : {}) });
    if (next.run && next.run !== prev.run) subscribe(next.run, get().events[next.run]?.length ?? 0);
  },
  selectRun: (id, opts) => get().navigate({ run: id, section: "runs", ...(opts?.view ? { view: opts.view } : {}) }, { replace: opts?.replace }),
  setOverviewOpen: (overviewOpen) => {
    writePref(PREF_OVERVIEW, overviewOpen);
    set({ overviewOpen });
  },
  setShowThinking: (showThinking) => {
    writePref(PREF_THINKING, showThinking);
    set({ showThinking });
  },
  setTheme: (theme) => {
    localStorage.setItem("reins.theme", theme);
    applyTheme(theme);
    set({ theme });
  },
  openModal: (modal, prefill) => set({ modal, newRunPrefill: prefill, ...(modal === "domainBuilder" ? {} : { domainDraft: null }) }),
  openDomainBuilder: (seed) => set({ modal: "domainBuilder", domainDraft: seed ?? null }),
  refreshDomains: async () => {
    try {
      const [lessons, userDomains] = await Promise.all([api.lessons(), api.domains()]);
      set({ lessons: tagUserDomains(lessons, userDomains), userDomains });
    } catch {
      /* keep what we have */
    }
  },
  setScrub: (scrubSeq) => set({ scrubSeq }),
  setLessonFilter: (slug) => get().navigate({ section: "lessons", lesson: slug, component: null }),
  refreshPresets: async () => {
    try {
      const p = await api.presets();
      set({ presets: p.presets, defaultPreset: p.default, defaultComposition: p.defaultComposition ?? null });
    } catch {
      /* presets are optional; New run falls back to the defaults */
    }
  },
  refreshIntake: async () => {
    try {
      set({ intakeJobs: await api.intakeJobs() });
    } catch {
      /* keep what we have */
    }
  },
  refreshLessons: async () => {
    try {
      set({ lessons: tagUserDomains(await api.lessons(), get().userDomains) });
    } catch {
      /* keep what we have */
    }
  },
  toastMsg: (text, kind = "info") => {
    set({ toast: { text, kind } });
    setTimeout(() => set((s) => (s.toast?.text === text ? { toast: undefined } : {})), kind === "error" ? 9000 : 3500);
  },
  refreshInfo: async () => set({ info: await api.info() }),
}));
