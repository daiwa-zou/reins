import { api } from "./api";
import { useStore } from "../state/store";

/**
 * One demo is enough: if a recorded run already exists, open it instead of
 * creating another. Only a finished one gets replaced on request.
 */
export async function startDemo(force = false) {
  const s = useStore.getState();
  const existing = s.runs.find((r) => r.engine === "replay");
  if (existing && !force) {
    s.selectRun(existing.id);
    s.setTab("stage");
    if (["completed", "failed", "cancelled"].includes(existing.status)) s.toastMsg("Showing the recorded demo you already have. Delete it from the list to watch it play again.");
    return;
  }
  try {
    const cfg = await api.demo();
    s.selectRun(cfg.id);
    s.setTab("stage");
  } catch (e) {
    s.toastMsg((e as Error).message, "error");
  }
}
