import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedFile } from "../../shared/types.js";

const exec = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err: any) {
    throw new Error(err?.stderr?.toString?.() || err?.message || String(err));
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function headSha(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "HEAD"])).trim();
  } catch {
    return null;
  }
}

/** Changed files since a base commit, including uncommitted work. */
export async function changedFiles(cwd: string, base: string | null): Promise<ChangedFile[]> {
  if (!(await isGitRepo(cwd))) return [];
  const out: ChangedFile[] = [];
  const numstat = base ? await git(cwd, ["diff", "--numstat", "-M", base]) : await git(cwd, ["diff", "--numstat", "-M"]);
  const status = base ? await git(cwd, ["diff", "--name-status", "-M", base]) : await git(cwd, ["diff", "--name-status", "-M"]);
  const kinds = new Map<string, ChangedFile["kind"]>();
  for (const line of status.split("\n")) {
    const [s, a, b] = line.split("\t");
    if (!s) continue;
    const p = b ?? a;
    kinds.set(p, s.startsWith("A") ? "added" : s.startsWith("D") ? "deleted" : s.startsWith("R") ? "renamed" : "modified");
  }
  for (const line of numstat.split("\n")) {
    const [add, del, ...rest] = line.split("\t");
    if (!rest.length) continue;
    const p = rest[rest.length - 1].replace(/^.*=> /, "").replace(/[{}]/g, "");
    out.push({ path: p, kind: kinds.get(p) ?? "modified", additions: Number(add) || 0, deletions: Number(del) || 0 });
  }
  // untracked files
  const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  for (const p of untracked.split("\n").filter(Boolean)) {
    if (p.startsWith(".reins/")) continue;
    let lines = 0;
    try {
      lines = fs.readFileSync(path.join(cwd, p), "utf8").split("\n").length;
    } catch {
      /* binary */
    }
    out.push({ path: p, kind: "added", additions: lines, deletions: 0 });
  }
  return out.filter((f) => !f.path.startsWith(".reins/"));
}

export async function fileDiff(cwd: string, base: string | null, file: string): Promise<string> {
  if (!(await isGitRepo(cwd))) return "";
  const tracked = (await git(cwd, ["ls-files", "--error-unmatch", file]).catch(() => "")).trim();
  if (!tracked) {
    const abs = path.join(cwd, file);
    if (!fs.existsSync(abs)) return "";
    const body = fs.readFileSync(abs, "utf8");
    return `--- /dev/null\n+++ b/${file}\n` + body.split("\n").map((l) => "+" + l).join("\n");
  }
  return base ? git(cwd, ["diff", base, "--", file]) : git(cwd, ["diff", "--", file]);
}

export function reinsDir(workspace: string) {
  const d = path.join(workspace, ".reins");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function readWorkspaceFile(workspace: string, rel: string): string | null {
  const p = path.join(workspace, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

export function writeWorkspaceFile(workspace: string, rel: string, content: string) {
  const p = path.join(workspace, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** Make sure .reins/ is ignored by the workspace's git so agent notes never land in commits unintentionally. */
export function ensureReinsIgnored(workspace: string) {
  const excl = path.join(workspace, ".git", "info", "exclude");
  if (!fs.existsSync(path.dirname(excl))) return;
  const cur = fs.existsSync(excl) ? fs.readFileSync(excl, "utf8") : "";
  if (!cur.split("\n").includes(".reins/")) fs.appendFileSync(excl, (cur.endsWith("\n") || cur === "" ? "" : "\n") + ".reins/\n");
}
