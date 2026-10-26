// The publish stage's git and GitHub side: one branch and one pull request per
// work package, merged when approved with green checks, then the base pulled so
// the next package starts from the merged tip. `gh` is the only GitHub client;
// tests substitute a fake through the constructor.
import type { ContractCriterion, CriterionResult, FeatureItem, PublishPolicy, WorkPackage } from "../../../shared/types.js";
import { runShell } from "../tools/registry.js";
import { writeWorkspaceFile } from "../workspace.js";

/** The fields of `gh pr view --json` the harness reads. Everything is optional: a view may be partial. */
export interface PrView {
  number?: number;
  url?: string;
  state?: string;
  mergedAt?: string | null;
  reviewDecision?: string;
  statusCheckRollup?: unknown[] | null;
  mergeStateStatus?: string;
}

export type PrState = { kind: "merged" } | { kind: "closed" } | { kind: "ready" } | { kind: "failing"; checks: string[] } | { kind: "waiting"; why: string };

const OK_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** What the harness does with a pull request as it stands: merge it, keep waiting, give up, or fix the checks. */
export function prState(v: PrView, mergeWhen: PublishPolicy["mergeWhen"]): PrState {
  if (v.state === "MERGED") return { kind: "merged" };
  if (v.state === "CLOSED") return { kind: "closed" };
  const failing: string[] = [];
  const pending: string[] = [];
  for (const raw of Array.isArray(v.statusCheckRollup) ? v.statusCheckRollup : []) {
    const c = (raw ?? {}) as Record<string, string>;
    const name = c.name || c.context || "check";
    if (c.__typename === "StatusContext" || (c.state && c.conclusion === undefined && c.status === undefined)) {
      // A commit status: SUCCESS, PENDING, EXPECTED, FAILURE or ERROR.
      if (c.state === "SUCCESS") continue;
      if (c.state === "FAILURE" || c.state === "ERROR") failing.push(name);
      else pending.push(name);
      continue;
    }
    // A check run: status until COMPLETED, then a conclusion.
    if (c.status && c.status !== "COMPLETED") pending.push(name);
    else if (!OK_CONCLUSIONS.has(c.conclusion ?? "")) failing.push(name);
  }
  if (failing.length) return { kind: "failing", checks: failing };
  if (pending.length) return { kind: "waiting", why: `checks pending: ${pending.join(", ")}` };
  if (mergeWhen === "checks") return { kind: "ready" };
  if (v.reviewDecision === "APPROVED") return { kind: "ready" };
  if (v.reviewDecision === "CHANGES_REQUESTED") return { kind: "waiting", why: "changes requested" };
  return { kind: "waiting", why: "no approving review yet" };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** reins/<run>-<package>-<title>: one branch per package, readable in a branch list. */
export function branchNameFor(runId: string, pkgId: string, title: string): string {
  return `reins/${slug(runId) || "run"}-${slug(pkgId)}-${slug(title).slice(0, 40).replace(/-+$/, "")}`;
}

const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** The pull request body: for a reviewer judging intent, not reading lines. */
export function renderPrBody(input: {
  pkg: WorkPackage;
  features: FeatureItem[];
  contract: ContractCriterion[];
  evaluation: { results: CriterionResult[]; summary: string } | null;
  testsDoc: string;
  baseSha: string;
  base: string;
  runId: string;
}): string {
  const { pkg, features, contract, evaluation, testsDoc, baseSha, base, runId } = input;
  const out = [`## Work package ${pkg.id}: ${pkg.title}`, "", ...pkg.features.map((id) => `- ${id}: ${features.find((f) => f.id === id)?.title ?? "(unknown feature)"}`), "", pkg.rationale, "", "## Definition of done", "", "| id | kind | criterion | verify | result | evidence |", "|---|---|---|---|---|---|"];
  for (const c of contract) {
    const r = evaluation?.results.find((x) => x.id === c.id);
    const verdict = !r ? "–" : r.unverified ? "UNVERIFIED" : r.pass ? "PASS" : "FAIL";
    out.push(`| ${c.id} | ${c.hard ? "hard" : "soft"} | ${cell(c.text)} | \`${cell(c.verify).replace(/`/g, "'")}\` | ${verdict} | ${cell(r?.evidence)} |`);
  }
  if (evaluation?.summary) out.push("", evaluation.summary);
  const doc = testsDoc.replace(/^# [^\n]*\n+/, "").trim();
  if (doc) out.push("", "## Tests written first", "", doc);
  out.push("", "---", `Built on \`${base}\` at ${baseSha.slice(0, 7)} by Reins run ${runId}.`, "");
  return out.join("\n");
}

export interface PublisherOptions {
  /** The gh command (a shell prefix, e.g. "gh" or "node ./fake-gh.mjs"). */
  gh?: string;
}

/** Shell helpers for the publish stage. Every method throws with the command's output on failure. */
export class Publisher {
  private gh: string;
  constructor(opts: PublisherOptions = {}) {
    this.gh = opts.gh ?? "gh";
  }

  private async sh(cmd: string, cwd: string, signal: AbortSignal, timeoutMs = 60_000): Promise<string> {
    const r = await runShell(cmd, cwd, signal, timeoutMs);
    if (r.timedOut) throw new Error(`timed out after ${timeoutMs / 1000}s: ${cmd}`);
    if (r.code !== 0) throw new Error(`${cmd.split(" ").slice(0, 3).join(" ")} failed (exit ${r.code}): ${r.out.trim().slice(-600)}`);
    return r.out;
  }

  /** Can this workspace publish? A remote, a gh login and a branch to come back to. */
  async check(ws: string, remote: string, signal: AbortSignal): Promise<{ ok: true; url: string; base: string } | { ok: false; reason: string }> {
    let url: string;
    try {
      url = (await this.sh(`git remote get-url ${JSON.stringify(remote)}`, ws, signal)).trim();
    } catch {
      return { ok: false, reason: `no git remote "${remote}"` };
    }
    try {
      await this.sh(`${this.gh} auth status`, ws, signal, 30_000);
    } catch {
      return { ok: false, reason: "gh is not logged in (run gh auth login) or not installed" };
    }
    const base = (await this.sh("git rev-parse --abbrev-ref HEAD", ws, signal)).trim();
    if (!base || base === "HEAD") return { ok: false, reason: "the workspace is on a detached HEAD, so there is no base branch to open pull requests against" };
    return { ok: true, url, base };
  }

  /** Check out the base, pull it fast-forward, and cut the package branch from it. Returns the base sha the branch starts at. */
  async startBranch(ws: string, remote: string, base: string, branch: string, signal: AbortSignal): Promise<string> {
    await this.sh(`git checkout -q ${JSON.stringify(base)}`, ws, signal);
    await this.sh(`git pull -q --ff-only ${JSON.stringify(remote)} ${JSON.stringify(base)}`, ws, signal, 120_000);
    const sha = (await this.sh("git rev-parse HEAD", ws, signal)).trim();
    await this.sh(`git checkout -q -B ${JSON.stringify(branch)}`, ws, signal);
    return sha;
  }

  async push(ws: string, remote: string, branch: string, signal: AbortSignal): Promise<void> {
    await this.sh(`git push -q -u ${JSON.stringify(remote)} ${JSON.stringify(branch)}`, ws, signal, 120_000);
  }

  /** Open the pull request; the body goes through a file under .reins/ (ignored by git). */
  async open(ws: string, pr: { base: string; head: string; title: string; body: string }, signal: AbortSignal): Promise<{ number: number; url: string }> {
    writeWorkspaceFile(ws, ".reins/pr-body.md", pr.body);
    const out = await this.sh(`${this.gh} pr create --base ${JSON.stringify(pr.base)} --head ${JSON.stringify(pr.head)} --title ${JSON.stringify(pr.title)} --body-file .reins/pr-body.md`, ws, signal, 120_000);
    const url = out.trim().split("\n").filter(Boolean).pop() ?? "";
    const number = Number(url.match(/\/pull\/(\d+)|\/(\d+)$/)?.slice(1).find(Boolean));
    if (!Number.isFinite(number) || number <= 0) throw new Error(`gh pr create printed no pull request URL (output: ${out.trim().slice(-200)})`);
    return { number, url };
  }

  async view(ws: string, ref: string | number, signal: AbortSignal): Promise<PrView> {
    const out = await this.sh(`${this.gh} pr view ${JSON.stringify(String(ref))} --json number,url,state,mergedAt,reviewDecision,statusCheckRollup,mergeStateStatus`, ws, signal, 60_000);
    try {
      return JSON.parse(out) as PrView;
    } catch {
      throw new Error(`gh pr view returned no JSON: ${out.trim().slice(-200)}`);
    }
  }

  async merge(ws: string, number: number, method: PublishPolicy["mergeMethod"], signal: AbortSignal): Promise<void> {
    await this.sh(`${this.gh} pr merge ${number} --${method}`, ws, signal, 120_000);
  }

  /** Back to the base, pulled to the merged tip; the package branch is removed locally and on the remote (best effort). Returns the new base sha. */
  async afterMerge(ws: string, remote: string, base: string, branch: string, signal: AbortSignal): Promise<string> {
    await this.sh(`git checkout -q ${JSON.stringify(base)}`, ws, signal);
    await this.sh(`git pull -q --ff-only ${JSON.stringify(remote)} ${JSON.stringify(base)}`, ws, signal, 120_000);
    await runShell(`git branch -q -D ${JSON.stringify(branch)}; git push -q ${JSON.stringify(remote)} --delete ${JSON.stringify(branch)}`, ws, signal, 60_000);
    return (await this.sh("git rev-parse HEAD", ws, signal)).trim();
  }
}

/** Abortable sleep; resolves at once when ms is 0 or the signal fires. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
