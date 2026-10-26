import React, { useEffect, useMemo, useState } from "react";
import { presetChip, presetDomains } from "@shared/presets";
import { useStore } from "../state/store";
import { Badge, Empty } from "../components/ui";
import { api, type LessonAudit } from "../lib/api";
import { FOUNDATIONS } from "@shared/components";
import { ImplicationsByKind, IntakeForm, IntakeJobs, IntakeNotice, StandingControl } from "../components/LessonImplications";
import type { LessonProblem } from "@shared/types";

/**
 * The library the harness is built from: bundled lessons plus the user's own
 * ($REINS_HOME/lessons). The open lesson and the component filter live in the
 * URL (?section=lessons&lesson=<slug>&component=<id>), so a lesson can be
 * reloaded and shared. It is a reading library: a lesson reaches runs through
 * the components it informs and the domains it shapes ("Used by"), never as a
 * preset of its own.
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
  const [addOpen, setAddOpen] = useState(false);
  const openModal = useStore((s) => s.openModal);
  const openDomainBuilder = useStore((s) => s.openDomainBuilder);
  const userDomains = useStore((s) => s.userDomains);
  // Domains New run can pick (unreviewed lessons do not shape runs yet), the user's own included.
  const knownDomains = useMemo(() => [...presetDomains(lessons), ...userDomains.map((u) => u.id)], [lessons, userDomains]);
  const startWithDomain = (d: string) => openModal("newRun", { __compose: { domains: [d] } } as any);

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

  if (!lessons.length && loaded)
    return (
      <div className="h-full overflow-auto p-6 flex flex-col items-center gap-4" data-lessons-empty>
        <Empty title="No lessons yet" body="The library ships empty and the harness needs none. Run `npm run lessons:examples` to add the 30 distilled Anthropic engineering posts, write one from docs/lesson-template.md into $REINS_HOME/lessons, or distil one from a source below." />
        <div className="card p-4 w-full max-w-2xl">
          <IntakeNotice />
          <IntakeForm inline />
          <IntakeJobs />
        </div>
      </div>
    );

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
        <details className="text-small" open={!!tag}>
          <summary className="cursor-pointer faint">Tags{tag ? `: ${tag}` : ` · ${tags.length}`}</summary>
          <div className="flex flex-wrap gap-1 mt-1">
            <button className={`badge ${tag === null ? "badge-accent" : "badge-neutral"}`} onClick={() => setTag(null)}>
              all tags
            </button>
            {tags.map((t) => (
              <button key={t} className={`badge ${tag === t ? "badge-accent" : "badge-neutral"}`} onClick={() => setTag(tag === t ? null : t)}>
                {t}
              </button>
            ))}
          </div>
        </details>
        <div className="faint text-[11px]">
          {shown.length} of {lessons.length} lessons{userCount ? ` · ${userCount} yours` : ""}
        </div>
        <button type="button" className="btn btn-sm self-start" onClick={() => openDomainBuilder()} data-build-domain title="Pick implications from the library and name them as a domain for New run">
          Build a domain…
        </button>
        <div className="flex flex-col gap-0.5">
          {shown.map((l) => (
            <button key={l.slug} className={`text-left rounded-md px-2 py-1.5 text-[12.5px] leading-snug ${open === l.slug ? "sunk font-medium" : "hover:bg-[var(--bg-sunk)]"}`} onClick={() => select(l.slug)} aria-current={open === l.slug ? "page" : undefined}>
              {l.title}
              <div className="faint text-[10.5px] mt-0.5 flex items-center gap-1.5">
                {l.date}
                {l.source === "user" && <Badge tone="accent">yours</Badge>}
                {(l.domains ?? []).map((d) => (
                  <Badge key={d} title="A domain this lesson shapes">
                    {presetChip(d)}
                  </Badge>
                ))}
              </div>
            </button>
          ))}
          {!shown.length && <div className="muted text-small px-2">No lessons match these filters.</div>}
        </div>
      </div>
      <div id="lesson-view" className="flex-1 min-w-0 overflow-auto p-5">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {open && <IntakeNotice />}
          {!open && (
            <>
              <IntakeJobs />
              <details className="card p-4 text-small leading-relaxed" data-add-lesson open={addOpen} onToggle={(e) => setAddOpen((e.target as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer font-semibold">Add a lesson</summary>
                {addOpen && (
                <>
                <div className="flex items-center gap-2 mt-2">
                  <p className="muted flex-1">
                    Drop a markdown file in <code className="mono">{problems?.userDir ?? "$REINS_HOME/lessons"}</code>. It appears here without a restart, and a file with the same name as a bundled lesson replaces it. Start from{" "}
                    <a className="underline" href="/api/docs/lesson-template.md" target="_blank" rel="noreferrer">
                      docs/lesson-template.md
                    </a>{" "}
                    and run <code className="mono">npm run lessons:check</code> to lint it. Or let an agent draft one from a post:
                  </p>
                  <button className="btn btn-sm self-start" onClick={() => void reload()} title="Re-read the library (the server also notices changed files on its own)">
                    Reload
                  </button>
                </div>
                <div className="mt-2">
                  <IntakeForm inline />
                </div>
                {audits.length > 0 && (
                  <p className="muted mt-2" title="From docs/audit, written by an independent audit pass that re-read each post and looked for the matching code">
                    Independent audit of {audits.length} lessons: <span className="text-[var(--ok)] font-semibold">{totals.implemented}</span> implemented · <span className="text-[var(--warn)] font-semibold">{totals.partial}</span> partial ·{" "}
                    <span className="text-[var(--bad)] font-semibold">{totals.gap}</span> gaps
                  </p>
                )}
                </>
                )}
              </details>
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
                    {l.source === "user" && <Badge tone="accent">yours</Badge>}
                    {(l.domains ?? []).map((d) => (
                      <Badge key={d}>{presetChip(d)}</Badge>
                    ))}
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
                const usedDomains = l.standing === "unreviewed" ? [] : (l.domains ?? []).filter((d) => knownDomains.includes(d));
                const fx = [l.enables?.length ? `on: ${l.enables.join(", ")}` : "", l.disables?.length ? `off: ${l.disables.join(", ")}` : "", l.guidance ? "guidance" : ""].filter(Boolean).join("; ");
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
                          yours
                        </Badge>
                      )}
                      {l.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                    <p className="mt-3 leading-relaxed text-[14px]">{l.takeaway}</p>
                    {(informs.length > 0 || founds.length > 0 || usedDomains.length > 0) && (
                      <div className="mt-4 rounded-lg border line p-3 flex flex-col gap-2 text-[12px]" data-used-by>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[13px] font-semibold flex-1">Used by</h3>
                          {l.standing !== "unreviewed" && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDomainBuilder({ lesson: l })} data-build-domain-from={l.slug} title="Open the domain builder with this lesson's implications picked">
                              Build a domain from this lesson…
                            </button>
                          )}
                        </div>
                        {(informs.length > 0 || founds.length > 0) && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="faint">Components:</span>
                            {informs.map((c) => (
                              <button key={c.id} className="badge badge-accent hover:brightness-95" onClick={() => navigate({ section: "lessons", component: c.id, lesson: null })} title={`Show every lesson behind ${c.label}`}>
                                {c.label} →
                              </button>
                            ))}
                            {founds.map((f) => (
                              <button key={f.id} className="badge badge-neutral hover:brightness-95" onClick={() => navigate({ section: "lessons", component: f.id, lesson: null })} title={`Show every lesson behind ${f.label}`}>
                                {f.label} →
                              </button>
                            ))}
                          </div>
                        )}
                        {usedDomains.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="faint">Domains:</span>
                            {usedDomains.map((d) => (
                              <button key={d} className="btn btn-sm" onClick={() => startWithDomain(d)} data-start-domain={d} title={`Open New run with the ${presetChip(d)} domain on`}>
                                Start a run with {presetChip(d)}
                              </button>
                            ))}
                            {fx && <span className="muted">this lesson adds {fx}</span>}
                          </div>
                        )}
                        {l.guidance && <div className="muted">Guidance: {l.guidance}</div>}
                      </div>
                    )}
                    <h3 className="text-[13px] font-semibold mt-5 mb-2">Learnings</h3>
                    <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed list-disc pl-5">
                      {l.learnings.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                    <h3 className="text-[13px] font-semibold mt-5 mb-2">Harness implications</h3>
                    <ImplicationsByKind lesson={l} />
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
