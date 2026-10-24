import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const AUDIT_DIR = path.resolve(here, "../../docs/audit");

export interface AuditRow {
  learning: string;
  where: string;
  status: "implemented" | "partial" | "gap";
}
export interface LessonAudit {
  slug: string;
  checkedAgainstOriginal: string;
  rows: AuditRow[];
  gaps: string[];
  counts: { implemented: number; partial: number; gap: number };
}

/** docs/audit/<slug>.md is written by an independent audit pass; the UI shows it as-is. */
export function listAudits(): LessonAudit[] {
  if (!fs.existsSync(AUDIT_DIR)) return [];
  const out: LessonAudit[] = [];
  for (const f of fs.readdirSync(AUDIT_DIR).filter((x) => x.endsWith(".md") && x !== "README.md").sort()) {
    const raw = fs.readFileSync(path.join(AUDIT_DIR, f), "utf8");
    const rows: AuditRow[] = [];
    for (const line of raw.split("\n")) {
      const m = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(implemented|partial|gap)\s*\|\s*$/i);
      if (m && !/^-+$/.test(m[1])) rows.push({ learning: m[1], where: m[2], status: m[3].toLowerCase() as AuditRow["status"] });
    }
    const gapsSection = raw.split(/\n##\s*Gaps\s*\n/i)[1] ?? "";
    const gaps = gapsSection.split("\n").filter((l) => l.trim().startsWith("- ")).map((l) => l.trim().slice(2));
    const checked = raw.match(/checked against the original:\s*(.+)/i)?.[1]?.trim() ?? "";
    const counts = { implemented: 0, partial: 0, gap: 0 };
    for (const r of rows) counts[r.status]++;
    out.push({ slug: f.replace(/\.md$/, ""), checkedAgainstOriginal: checked, rows, gaps, counts });
  }
  return out;
}
