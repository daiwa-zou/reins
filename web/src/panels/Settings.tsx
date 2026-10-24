import React, { useState } from "react";
import { Modal } from "../components/ui";
import { useStore } from "../state/store";
import { api } from "../lib/api";

export function Settings() {
  const openModal = useStore((s) => s.openModal);
  const info = useStore((s) => s.info);
  const refreshInfo = useStore((s) => s.refreshInfo);
  const toastMsg = useStore((s) => s.toastMsg);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<null | "running" | Awaited<ReturnType<typeof api.testConnection>>>(null);

  const runTest = async () => {
    setTest("running");
    try {
      setTest(await api.testConnection());
    } catch (e) {
      setTest({ ok: false, error: (e as Error).message });
    }
  };

  const save = async (value: string) => {
    setBusy(true);
    try {
      await api.setApiKey(value);
      await refreshInfo();
      setKey("");
      toastMsg(value ? "API key saved locally." : "API key removed.");
    } catch (e) {
      toastMsg((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Settings" onClose={() => openModal(null)} width={560}>
      <div className="flex flex-col gap-5">
        <section>
          <div className="font-semibold">Anthropic API key</div>
          <p className="muted text-[12.5px] mt-1 leading-relaxed">
            Live runs call the Claude API directly from this machine. The key is stored in <code>{info?.home}/settings.json</code> with owner-only permissions and never leaves your computer except
            to api.anthropic.com. You can also set <code>ANTHROPIC_API_KEY</code> in the environment instead.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`badge ${info?.hasApiKey ? "badge-ok" : "badge-warn"}`}>{info?.hasApiKey ? "key present" : "no key"}</span>
            {info?.hasApiKey && (
              <button className="btn btn-sm" disabled={test === "running"} onClick={runTest} title="Sends one tiny request with the exact shape the direct engine uses">
                {test === "running" ? "Testing…" : "Test connection"}
              </button>
            )}
          </div>
          {test && test !== "running" && (
            <div className={`mt-2 text-[12.5px] rounded-lg p-2.5 ${test.ok ? "badge-ok" : "badge-bad"}`} style={{ background: test.ok ? "var(--ok-soft)" : "var(--bad-soft)" }}>
              {test.ok ? (
                <>
                  Reached {test.model} in {Math.round(test.ms / 1000)}s ({test.usage.input + test.usage.cacheRead + test.usage.cacheWrite} in / {test.usage.output} out). The direct engine's request shape is accepted
                  {test.degraded.length ? ` with ${test.degraded.length} feature(s) turned off: ${test.degraded.join(" ")}` : " with every optional feature on."}
                </>
              ) : (
                <>Connection failed{test.status ? ` (${test.status})` : ""}: {test.error}</>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <input className="input mono" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
            <button className="btn btn-primary" disabled={busy || !key.trim()} onClick={() => save(key.trim())}>
              Save
            </button>
            {info?.hasApiKey && (
              <button className="btn btn-danger" disabled={busy} onClick={() => save("")}>
                Remove
              </button>
            )}
          </div>
        </section>
        <section>
          <div className="font-semibold">Appearance</div>
          <div className="flex gap-2 mt-2">
            {(["system", "light", "dark"] as const).map((t) => (
              <button key={t} className={`btn btn-sm ${theme === t ? "btn-primary" : ""}`} onClick={() => setTheme(t)}>
                {t}
              </button>
            ))}
          </div>
        </section>
        <section className="muted text-[12px] leading-relaxed">
          Runs are stored under <code>{info?.home}/runs</code>; agent notes live in each workspace's <code>.reins/</code> folder (excluded from git). Reins {info?.version}.
        </section>
      </div>
    </Modal>
  );
}
