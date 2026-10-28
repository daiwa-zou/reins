import { create } from "zustand";
import type { Composition, ContractCriterion, EngineId, HarnessComponent, IntakeJobSummary, Lesson, PublishDraft, RunConfig, RunEvent, RunSummary, ServerInfo, ServerMessage, UserDomain } from "@shared/types";
import { api, type PresetEntry } from "../lib/api";
import { tagUserDomains } from "@shared/domains";
import { decodeNav, encodeNav, isKnownRun, normalizeNav, sameNav, type DetailsSub, type NavState, type RunView, type Section } from "./nav";
import type { LessonDraftState } from "./lessonDraft";

export type { Section, RunView, DetailsSub, NavState } from "./nav";
/** The run views, in tab order. App sections (Runs, Reliability, Harness, Lessons) live in nav.ts SECTIONS. */
export { RUN_VIEWS, DETAILS_SUBS, SECTIONS } from "./nav";

type Theme = "light" | "dark" | "system";
const THEMES: Theme[] = ["light", "dark", "system"];

/** Prefill extras New run understands besides a RunConfig (run again, Harness, Lessons). */
export interface NewRunExtras {
  /** Start from this composition, composed fresh (e.g. "Start a run with Web"). */
  __compose?: Partial<Composition>;
  /** Start from this saved preset. */
  __saved?: string;
  /** Open Customize on the components. */
  __openHarness?: boolean;
  __notice?: string;
}
export type NewRunPrefill = Partial<RunConfig> & NewRunExtras;

/** What an approval card holds while you edit it: contract criteria, a note, and (for a lesson or a pull request) the draft. */
export interface ApprovalDraft {
  criteria: ContractCriterion[];
  note: string;
  lesson?: LessonDraftState;
  publish?: PublishDraft;
}

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
  newRunPrefill?: NewRunPrefill;
  /** The user's domains built from implications ($REINS_HOME/domains.json); the library in `lessons` is tagged with them. */
  userDomains: UserDomain[];
  refreshDomains: () => Promise<void>;
  /** What the domain builder opens on: an existing domain to edit, or a lesson to seed from. */
  domainDraft: { domain?: UserDomain | null; lesson?: Lesson | null } | null;
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
  approvalDrafts: Record<string, ApprovalDraft | undefined>;
  /** New-run form draft survives closing the dialog. */
  newRunDraft: Partial<RunConfig> | null;

  setApprovalDraft: (id: string, draft: ApprovalDraft | null) => void;
  setNewRunDraft: (d: Partial<RunConfig> | null) => void;
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
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data) as ServerMessage;
    } catch {
      return; // a torn frame is dropped, never fatal to the socket
    }
    if (msg.type === "hello") set({ info: msg.info });
    else if (msg.type === "runs") set({ runs: msg.runs });
    else if (msg.type === "intake") set({ intakeJobs: msg.jobs });
    else if (msg.type === "event") set((s) => ({ events: { ...s.events, [msg.event.runId]: mergeEvents(s.events[msg.event.runId] ?? [], [msg.event]) } }));
    else if (msg.type === "events" && msg.events.length) set((s) => ({ events: { ...s.events, [msg.runId]: mergeEvents(s.events[msg.runId] ?? [], msg.events) } }));
  };
}

/** The log with `incoming` folded in, ordered by seq with duplicates dropped; the common case (events after the last one) is an append. */
export function mergeEvents(existing: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const last = existing.length ? existing[existing.length - 1].seq : -1;
  if (incoming.every((e, i) => e.seq > last && (i === 0 || e.seq > incoming[i - 1].seq))) return existing.length ? [...existing, ...incoming] : incoming;
  const bySeq = new Map<number, RunEvent>();
  for (const e of existing) bySeq.set(e.seq, e);
  for (const e of incoming) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function subscribe(id: string, fromSeq: number) {
  subscribed.add(id);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "subscribe", runId: id, fromSeq }));
}

/** Stop streaming a run we are no longer looking at; its events are kept, so coming back catches up from the last seq. */
function unsubscribe(id: string) {
  subscribed.delete(id);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "unsubscribe", runId: id }));
}

// Preferences live in localStorage, which can be missing or throw (private mode): every read has a fallback and every write is best effort.
const PREF_OVERVIEW = "reins.overviewOpen";
const PREF_THINKING = "reins.showThinking";
const PREF_THEME = "reins.theme";
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the setting still works for this session */
  }
}
const readBool = (key: string, fallback: boolean) => {
  const v = readPref(key);
  return v === null ? fallback : v === "1";
};

const savedTheme: Theme = THEMES.find((t) => t === readPref(PREF_THEME)) ?? "system";
function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
applyTheme(savedTheme);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(useStore.getState().theme));

/** Write the nav state to the address bar. Back/forward replays it via syncFromUrl. */
function writeUrl(nav: NavState, replace: boolean) {
  const next = location.pathname + encodeNav(nav) + location.hash;
  if (next === location.pathname + location.search + location.hash) return;
  if (replace) history.replaceState(null, "", next);
  else history.pushState(null, "", next);
}

/** The state patch for a new nav state: the selection, a cleared scrub point on a run change, and the run subscription moved along. */
function applyNav(prev: NavState, next: NavState, events: Record<string, RunEvent[]>): Partial<State> {
  const runChanged = next.run !== prev.run;
  if (runChanged) {
    if (prev.run) unsubscribe(prev.run);
    if (next.run) subscribe(next.run, events[next.run]?.length ?? 0);
  }
  return { section: next.section, selectedRunId: next.run, view: next.view, sub: next.sub, lesson: next.lesson ?? null, component: next.component ?? null, skill: next.skill ?? null, ...(runChanged ? { scrubSeq: null } : {}) };
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
  overviewOpen: readBool(PREF_OVERVIEW, false),
  showThinking: readBool(PREF_THINKING, false),
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
    let userDomains: UserDomain[] = [];
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
    if (!sameNav(prev, next)) set(applyNav(prev, next, get().events));
    writeUrl(next, !!opts?.replace);
  },
  syncFromUrl: () => {
    const s = get();
    // Before boot has loaded the run list we cannot tell a stale id from a real one; keep it.
    const known = s.booting ? undefined : (id: string) => isKnownRun(s, id);
    const next = decodeNav(location.search, { runExists: known });
    const prev = s.nav();
    if (!sameNav(prev, next)) set(applyNav(prev, next, s.events));
  },
  selectRun: (id, opts) => get().navigate({ run: id, section: "runs", ...(opts?.view ? { view: opts.view } : {}) }, { replace: opts?.replace }),
  setOverviewOpen: (overviewOpen) => {
    writePref(PREF_OVERVIEW, overviewOpen ? "1" : "0");
    set({ overviewOpen });
  },
  setShowThinking: (showThinking) => {
    writePref(PREF_THINKING, showThinking ? "1" : "0");
    set({ showThinking });
  },
  setTheme: (theme) => {
    writePref(PREF_THEME, theme);
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
    // Each toast is its own object, so a repeat of the same text is not dismissed by the earlier timer.
    const toast = { text, kind };
    set({ toast });
    setTimeout(() => set((s) => (s.toast === toast ? { toast: undefined } : {})), kind === "error" ? 9000 : 3500);
  },
  refreshInfo: async () => set({ info: await api.info() }),
}));
