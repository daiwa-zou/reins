import React, { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { Badge, Empty } from "../components/ui";

/** The library the harness is built from. Each lesson links back to the components it informs. */
export function LessonsPanel() {
  const lessons = useStore((s) => s.lessons);
  const components = useStore((s) => s.components);
  const filter = useStore((s) => s.lessonFilter);
  const setLessonFilter = useStore((s) => s.setLessonFilter);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(filter);

  React.useEffect(() => {
    if (filter) {
      setOpen(filter);
      setTimeout(() => document.getElementById(`lesson-${filter}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }, [filter]);

  const tags = useMemo(() => [...new Set(lessons.flatMap((l) => l.tags))].sort(), [lessons]);
  const shown = lessons.filter((l) => (!tag || l.tags.includes(tag)) && (!q || `${l.title} ${l.takeaway} ${l.learnings.join(" ")}`.toLowerCase().includes(q.toLowerCase())));

  if (!lessons.length) return <Empty title="No lessons found" body="Add markdown files under /lessons." />;

  return (
    <div className="h-full flex">
      <div className="w-[260px] shrink-0 border-r line overflow-auto p-3 flex flex-col gap-3">
        <input className="input" placeholder="Search lessons…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1">
          <button className={`badge ${tag === null ? "badge-accent" : "badge-neutral"}`} onClick={() => setTag(null)}>
            all · {lessons.length}
          </button>
          {tags.map((t) => (
            <button key={t} className={`badge ${tag === t ? "badge-accent" : "badge-neutral"}`} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          {shown.map((l) => (
            <button key={l.slug} className={`text-left rounded-md px-2 py-1.5 text-[12.5px] leading-snug ${open === l.slug ? "sunk font-medium" : "hover:bg-[var(--bg-sunk)]"}`} onClick={() => { setOpen(l.slug); setLessonFilter(l.slug); }}>
              {l.title}
              <div className="faint text-[10.5px] mt-0.5">{l.date}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-w-0 overflow-auto p-5">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {shown
            .filter((l) => !open || l.slug === open)
            .map((l) => {
              const informs = components.filter((c) => c.lessons.includes(l.slug));
              return (
                <article key={l.slug} id={`lesson-${l.slug}`} className="card p-5 fade-in">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-[17px] font-semibold tracking-tight leading-tight">{l.title}</h2>
                    <a href={l.url} target="_blank" rel="noreferrer" className="btn btn-sm shrink-0">
                      Original ↗
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[11.5px] muted">
                    <span>{l.date}</span>
                    {l.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                  <p className="mt-3 leading-relaxed text-[14px]">{l.takeaway}</p>
                  {informs.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
                      <span className="faint">informs:</span>
                      {informs.map((c) => (
                        <Badge key={c.id} tone="accent">
                          {c.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <h3 className="text-[10.5px] uppercase tracking-wider faint font-semibold mt-5 mb-2">Learnings</h3>
                  <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed list-disc pl-5">
                    {l.learnings.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                  <h3 className="text-[10.5px] uppercase tracking-wider faint font-semibold mt-5 mb-2">Harness implications</h3>
                  <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed list-disc pl-5">
                    {l.implications.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </article>
              );
            })}
          {open && (
            <button className="btn self-center" onClick={() => { setOpen(null); setLessonFilter(null); }}>
              Show all lessons
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
