import { create } from "zustand";
import type { HarnessComponent, Lesson, RunEvent, RunSummary, ServerInfo, ServerMessage } from "@shared/types";
import { api } from "../lib/api";

export type Tab = "stage" | "transcript" | "contract" | "context" | "guardrails" | "files" | "harness" | "lessons" | "reliability";
export const TABS: { id: Tab; label: string; key: string }[] = [
  { id: "stage", label: "Stage", key: "1" },
  { id: "transcript", label: "Transcript", key: "2" },
  { id: "contract", label: "Contract", key: "3" },
  { id: "context", label: "Context", key: "4" },
  { id: "guardrails", label: "Guardrails", key: "5" },
  { id: "files", label: "Files", key: "6" },
  { id: "harness", label: "Harness", key: "7" },
  { id: "lessons", label: "Lessons", key: "8" },
  { id: "reliability", label: "Reliability", key: "9" },
];

type Theme = "light" | "dark" | "system";

interface State {
  info?: ServerInfo;
  connected: boolean;
  runs: RunSummary[];
  components: HarnessComponent[];
  lessons: Lesson[];
  selectedRunId: string | null;
  events: Record<string, RunEvent[]>;
  tab: Tab;
  theme: Theme;
  modal: null | "newRun" | "settings" | "help";
  newRunPrefill?: Partial<import("@shared/types").RunConfig>;
  /** Scrubber: show state as of this seq (null = live). */
  scrubSeq: number | null;
  lessonFilter: string | null;
  toast?: { text: string; kind: "info" | "error" };

  boot: () => Promise<void>;
  selectRun: (id: string | null) => void;
  setTab: (t: Tab) => void;
  setTheme: (t: Theme) => void;
  openModal: (m: State["modal"], prefill?: State["newRunPrefill"]) => void;
  setScrub: (seq: number | null) => void;
  setLessonFilter: (slug: string | null) => void;
  toastMsg: (text: string, kind?: "info" | "error") => void;
  refreshInfo: () => Promise<void>;
}

let ws: WebSocket | null = null;
const subscribed = new Set<string>();

function connect(set: (p: Partial<State> | ((s: State) => Partial<State>)) => void, get: () => State) {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    set({ connected: true });
    for (const id of subscribed) {
      const have = get().events[id]?.length ?? 0;
      ws!.send(JSON.stringify({ type: "subscribe", runId: id, fromSeq: have }));
    }
  };
  ws.onclose = () => {
    set({ connected: false });
    setTimeout(() => connect(set, get), 1500);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMessage;
    if (msg.type === "hello") set({ info: msg.info });
    else if (msg.type === "runs") set({ runs: msg.runs });
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

export const useStore = create<State>((set, get) => ({
  connected: false,
  runs: [],
  components: [],
  lessons: [],
  selectedRunId: null,
  events: {},
  tab: "stage",
  theme: savedTheme,
  modal: null,
  scrubSeq: null,
  lessonFilter: null,

  boot: async () => {
    connect(set, get);
    const [info, components, lessons, runs] = await Promise.all([api.info(), api.components(), api.lessons(), api.runs()]);
    set({ info, components, lessons, runs });
    const fromUrl = new URLSearchParams(location.search).get("run");
    const pick = fromUrl && runs.some((r) => r.id === fromUrl) ? fromUrl : runs.find((r) => r.status === "running" || r.status === "waiting_approval")?.id ?? runs[0]?.id ?? null;
    if (pick) get().selectRun(pick);
  },
  selectRun: (id) => {
    set({ selectedRunId: id, scrubSeq: null });
    const url = new URL(location.href);
    if (id) url.searchParams.set("run", id);
    else url.searchParams.delete("run");
    history.replaceState(null, "", url);
    if (id) subscribe(id, get().events[id]?.length ?? 0);
  },
  setTab: (tab) => set({ tab }),
  setTheme: (theme) => {
    localStorage.setItem("reins.theme", theme);
    applyTheme(theme);
    set({ theme });
  },
  openModal: (modal, prefill) => set({ modal, newRunPrefill: prefill }),
  setScrub: (scrubSeq) => set({ scrubSeq }),
  setLessonFilter: (lessonFilter) => set({ lessonFilter, tab: "lessons" }),
  toastMsg: (text, kind = "info") => {
    set({ toast: { text, kind } });
    setTimeout(() => set((s) => (s.toast?.text === text ? { toast: undefined } : {})), 3500);
  },
  refreshInfo: async () => set({ info: await api.info() }),
}));
