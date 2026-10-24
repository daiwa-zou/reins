import React, { useEffect, useMemo, useState } from "react";
import { adaptPreset, composePreset, recipeFor } from "@shared/presets";
import { applyPreset } from "@shared/config";
import { defaultRunConfig } from "@shared/components";
import { useStore } from "../state/store";
import { Badge, Empty } from "../components/ui";
import { api, type LessonAudit } from "../lib/api";
import { FOUNDATIONS } from "@shared/components";
import { ImplicationsByKind, IntakeForm, StandingControl } from "../components/LessonImplications";
import type { LessonProblem } from "@shared/types";

/**
 * The library the harness is built from: bundled lessons plus the user's own
 * ($REINS_HOME/lessons). The open lesson and the component filter live in the
 * URL (?section=lessons&lesson=<slug>&component=<id>), so a lesson can be
 * reloaded and shared. Each lesson links back to the Harness cards it informs.
 */
export function LessonsPanel() {
  const lessons = useStore((s) => s.lessons);
  const components = useStore((s) => s.components);
  const lessonSlug = useStore((s) => s.lesson);
  const component = useStore((s) => s.component);
  const navigate = useStore((s) => s.navigate);
  const refreshLessons = useStore((s) => s.refreshLessons);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [audits, setAudits] = useState<LessonAudit[]>([]);
  const [problems, setProblems] = useState<{ problems: LessonProblem[]; userDir: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const openModal = useStore((s) => s.openModal);
  const availableEngine = useStore((s) => s.availableEngine);
  const info = useStore((s) => s.info);
  const presets = useStore((s) => s.presets);
  // Compose a preset from the selected lessons (or the current filter) and open New run prefilled with it.
  const buildPreset = (from: typeof lessons) => {
    const domain = [...new Set(from.flatMap((l) => l.domains ?? []))];
    const p = composePreset({ ...recipeFor(domain.length === 1 ? domain[0] : "custom"), name: "From lessons" }, from, { matchAll: true, name: "From lessons" });
    const engine = availableEngine();
    const cfg = applyPreset(defaultRunConfig({ task: "", workspace: info?.defaultWorkspace ?? "", engine }), adaptPreset(p, engine));
    openModal("newRun", { ...cfg, preset: undefined, id: undefined, createdAt: undefined, title: "", __basis: p.basis, __notice: `Prefilled from ${from.length} lesson${from.length === 1 ? "" : "s"}. Use "Save as preset…" to keep it.` } as any);
  };

  const reload = async () => {
    await refreshLessons();
    try {
      setProblems(await api.lessonProblems());
    } catch {
      setProblems(null);
    }
    setLoaded(true);
  };
  // The server re-reads the library when a file changes; refetch whenever this view opens.
  useEffect(() => {
    void reload();
    api.audit().then(setAudits).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const totals = audits.reduce((a, x) => ({ implemented: a.implemented + x.counts.implemented, partial: a.partial + x.counts.partial, gap: a.gap + x.counts.gap }), { implemented: 0, partial: 0, gap: 0 });

  const open = lessonSlug && lessons.some((l) => l.slug === lessonSlug) ? lessonSlug : null;
  // An unknown slug in the URL falls back to the list (and the URL is corrected) once the library has loaded.
  useEffect(() => {
    if (loaded && lessonSlug && !open) navigate({ lesson: null }, { replace: true });
  }, [loaded, lessonSlug, open, navigate]);
  useEffect(() => {
    if (open) setTimeout(() => document.getElementById("lesson-view")?.scrollTo({ top: 0 }), 0);
  }, [open]);

  const tags = useMemo(() => [...new Set(lessons.flatMap((l) => l.tags))].sort(), [lessons]);
  const shown = lessons.filter(
    (l) =>
      (!tag || l.tags.includes(tag)) &&
      (!component || l.components.includes(component as any) || l.foundations.includes(component)) &&
      (!q || `${l.title} ${l.takeaway} ${l.learnings.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  );
  const select = (slug: string | null) => navigate({ section: "lessons", lesson: slug });
  const userProblems = (problems?.problems ?? []).filter((p) => p.source !== "bundled" || p.level === "error");
  const userCount = lessons.filter((l) => l.source === "user").length;

  if (!lessons.length && loaded) return <Empty title="No lessons found" body="Add markdown files under lessons/ or your own library (see docs/lesson-template.md)." />;

  return (
    <div className="h-full flex">
      <div className="w-[270px] shrink-0 border-r line overflow-auto p-3 flex flex-col gap-3">
        <input className="input" placeholder="Search lessons…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search lessons" />
        <label className="flex flex-col gap-1 text-small">
          <span className="section-label">Informs component</span>
          <select className="input" value={component ?? ""} onChange={(e) => navigate({ section: "lessons", component: e.target.value || null, lesson: null })} aria-label="Filter by component">
            <option value="">All components</option>
            <optgroup label="Switchable components">
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Foundations">
              {FOUNDATIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="flex flex-wrap gap-1">
          <button className={`badge ${tag === null ? "badge-accent" : "badge-neutral"}`} onClick={() => setTag(null)}>
            all tags
          </button>
          {tags.map((t) => (
            <button key={t} className={`badge ${tag === t ? "badge-accent" : "badge-neutral"}`} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="faint text-[11px]">
          {shown.length} of {lessons.length} lessons{userCount ? ` · ${userCount} yours` : ""}
        </div>
        <div className="flex flex-col gap-1 text-[11.5px]">
          <button
            className="btn btn-sm"
            disabled={!picked.length && !shown.length}
            onClick={() => buildPreset(picked.length ? lessons.filter((l) => picked.includes(l.slug)) : shown)}
            title="Fold these lessons' enables/disables/guidance over the Full preset and open New run with the result"
          >
            Build a preset from these ({picked.length ? `${picked.length} selected` : `${shown.length} shown`})
          </button>
          {picked.length > 0 && (
            <button className="underline faint self-start" onClick={() => setPicked([])}>
              clear selection
            </button>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          {shown.map((l) => (
            <div key={l.slug} className="flex items-start gap-1">
            <input type="checkbox" className="mt-2 shrink-0" checked={picked.includes(l.slug)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.slug] : picked.filter((s) => s !== l.slug))} aria-label={`Select ${l.title} for a preset`} />
            <button className={`flex-1 text-left rounded-md px-2 py-1.5 text-[12.5px] leading-snug ${open === l.slug ? "sunk font-medium" : "hover:bg-[var(--bg-sunk)]"}`} onClick={() => select(l.slug)} aria-current={open === l.slug ? "page" : undefined}>
              {l.title}
              <div className="faint text-[10.5px] mt-0.5 flex items-center gap-1.5">
                {l.date}
                {l.source === "user" && <Badge tone="accent">user</Badge>}
                {l.domains?.length ? <Badge title="Shapes these preset domains">{l.domains.join(", ")}</Badge> : null}
              </div>
            </button>
            </div>
          ))}
          {!shown.length && <div className="muted text-small px-2">No lessons match these filters.</div>}
        </div>
      </div>
      <div id="lesson-view" className="flex-1 min-w-0 overflow-auto p-5">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {!open && (
            <>
              <div className="card p-4 text-small leading-relaxed">
                <div className="flex items-center gap-2">
                  <div className="font-semibold flex-1">Add your own lesson</div>
                  <button className="btn btn-sm" onClick={() => void reload()} title="Re-read the library (the server also notices changed files on its own)">
                    Reload
                  </button>
                </div>
                <p className="muted mt-1">
                  Drop a markdown file in <code className="mono">{problems?.userDir ?? "$REINS_HOME/lessons"}</code>. It appears here without a restart, and a file with the same name as a bundled lesson replaces it. Start from{" "}
                  <a className="underline" href="/api/docs/lesson-template.md" target="_blank" rel="noreferrer">
                    docs/lesson-template.md
                  </a>{" "}
                  and run <code className="mono">npm run lessons:check</code> to lint it.{" "}
                  <a className="underline" href="/api/docs/configuring.md" target="_blank" rel="noreferrer">
                    More in docs/configuring.md
                  </a>
                  .
                </p>
                {audits.length > 0 && (
                  <p className="muted mt-2" title="From docs/audit, written by an independent audit pass that re-read each post and looked for the matching code">
                    Independent audit of {audits.length} lessons: <span className="text-[var(--ok)] font-semibold">{totals.implemented}</span> implemented · <span className="text-[var(--warn)] font-semibold">{totals.partial}</span> partial ·{" "}
                    <span className="text-[var(--bad)] font-semibold">{totals.gap}</span> gaps
                  </p>
                )}
              </div>
              {userProblems.length > 0 && (
                <div className="card p-4 text-small" style={{ borderColor: "var(--warn)" }} role="status">
                  <div className="font-semibold text-[var(--warn)]">
                    {userProblems.length} problem{userProblems.length === 1 ? "" : "s"} in lesson files
                  </div>
                  <ul className="mt-2 flex flex-col gap-1">
                    {userProblems.map((p, i) => (
                      <li key={i} className="flex gap-2">
                        <Badge tone={p.level === "error" ? "bad" : "warn"}>{p.level}</Badge>
                        <span className="mono text-[11.5px]">{p.file}</span>
                        <span className="muted">{p.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {shown.map((l) => (
                <button key={l.slug} className="card p-4 text-left hover:brightness-[0.98]" onClick={() => select(l.slug)}>
                  <div className="flex items-center gap-2">
                    <div className="font-semibold flex-1">{l.title}</div>
                    {l.source === "user" && <Badge tone="accent">user</Badge>}
                    <span className="faint text-[11px]">{l.date}</span>
                  </div>
                  <p className="muted text-small mt-1 leading-relaxed line-clamp-2">{l.takeaway}</p>
                </button>
              ))}
            </>
          )}
          {open &&
            lessons
              .filter((l) => l.slug === open)
              .map((l) => {
                const informs = components.filter((c) => l.components.includes(c.id));
                const founds = FOUNDATIONS.filter((f) => l.foundations.includes(f.id));
                const audit = audits.find((a) => a.slug === l.slug);
                return (
                  <article key={l.slug} id={`lesson-${l.slug}`} className="card p-5 fade-in">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-[17px] font-semibold tracking-tight leading-tight">{l.title}</h2>
                      {l.url && (
                        <a href={l.url} target="_blank" rel="noreferrer" className="btn btn-sm shrink-0">
                          Original ↗
                        </a>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[11.5px] muted">
                      <span>{l.date}</span>
                      {l.provenance && <Badge>{l.provenance}</Badge>}
                      <StandingControl lesson={l} />
                      {l.source === "user" && (
                        <Badge tone="accent" title={`From ${problems?.userDir ?? "$REINS_HOME/lessons"}`}>
                          user
                        </Badge>
                      )}
                      {l.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                    <p className="mt-3 leading-relaxed text-[14px]">{l.takeaway}</p>
                    {l.domains?.length ? (
                      <div className="mt-2 text-[12px]" data-shapes-presets>
                        <span className="faint">Shapes presets: </span>
                        {l.domains.map((d, i) => {
                          const name = presets.find((p) => p.generated && p.domain === d)?.name ?? recipeFor(d).name;
                          const fx = [l.enables?.length ? `on: ${l.enables.join(", ")}` : "", l.disables?.length ? `off: ${l.disables.join(", ")}` : "", l.guidance ? "guidance" : ""].filter(Boolean).join("; ");
                          return (
                            <span key={d}>
                              {i > 0 && ", "}
                              <span className="font-medium">{name}</span> <span className="muted">({fx || "context"})</span>
                            </span>
                          );
                        })}
                        {l.guidance && <div className="muted mt-0.5">Guidance: {l.guidance}</div>}
                      </div>
                    ) : null}
                    {(informs.length > 0 || founds.length > 0) && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
                        <span className="faint">informs:</span>
                        {informs.map((c) => (
                          <button key={c.id} className="badge badge-accent hover:brightness-95" onClick={() => navigate({ section: "harness", component: c.id })} title={`Open the ${c.label} card in Harness`}>
                            {c.label} →
                          </button>
                        ))}
                        {founds.map((f) => (
                          <button key={f.id} className="badge badge-neutral hover:brightness-95" onClick={() => navigate({ section: "harness", component: f.id })} title={`Open the ${f.label} foundation in Harness`}>
                            {f.label} →
                          </button>
                        ))}
                      </div>
                    )}
                    {audit && (
                      <details className="mt-4 rounded-lg border line p-3">
                        <summary className="cursor-pointer text-[12.5px]">
                          <span className="font-semibold">Where this lives in Reins</span>{" "}
                          <span className="muted">
                            · {audit.counts.implemented} implemented · {audit.counts.partial} partial · {audit.counts.gap} gaps{audit.checkedAgainstOriginal ? ` · lesson re-checked against the original: ${audit.checkedAgainstOriginal.slice(0, 80)}` : ""}
                          </span>
                        </summary>
                        <table className="w-full text-[12px] mt-2">
                          <tbody>
                            {audit.rows.map((r, i) => (
                              <tr key={i} className="border-t line align-top">
                                <td className="py-1.5 pr-2 w-1/2">{r.learning}</td>
                                <td className="py-1.5 pr-2 mono text-[11px] muted">{r.where}</td>
                                <td className="py-1.5 w-24">
                                  <Badge tone={r.status === "implemented" ? "ok" : r.status === "partial" ? "warn" : "bad"}>{r.status}</Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {audit.gaps.length > 0 && (
                          <ul className="mt-2 text-[12px] list-disc pl-5 flex flex-col gap-1">
                            {audit.gaps.map((g, i) => (
                              <li key={i}>{g}</li>
                            ))}
                          </ul>
                        )}
                      </details>
                    )}
                    <h3 className="section-label mt-5 mb-2">Learnings</h3>
                    <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed list-disc pl-5">
                      {l.learnings.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                    <h3 className="section-label mt-5 mb-2">Harness implications</h3>
                    <ImplicationsByKind lesson={l} />
                  </article>
                );
              })}
          {open && (
            <button className="btn self-center" onClick={() => select(null)}>
              Show all lessons
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
