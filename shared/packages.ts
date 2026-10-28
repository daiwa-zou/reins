// Work packages: the breakdown stage slices the planner's feature list into
// pull-request-sized packages. Pure: the orchestrator validates the planner's
// proposal with it, the web UI renders packages with it, and vitest shares it.
import type { FeatureItem, PackageRef, WorkPackage } from "./types.js";
import { isObj, str } from "./util.js";

/** A package that estimates more changed lines than this is refused: a reviewer reads one PR in one sitting. */
export const PACKAGE_MAX_LINES = 400;
/** More packages than this means the plan is being listed, not sliced. */
export const PACKAGE_MAX_COUNT = 12;

/**
 * Check a proposed breakdown against the feature list and normalise it. Every
 * problem is one actionable sentence the planner can act on; `packages` is only
 * meaningful when `problems` is empty.
 */
export function validateBreakdown(raw: unknown, features: FeatureItem[], opts: { maxLines?: number } = {}): { packages: WorkPackage[]; problems: string[] } {
  const maxLines = opts.maxLines ?? PACKAGE_MAX_LINES;
  const problems: string[] = [];
  if (!Array.isArray(raw) || raw.length === 0) return { packages: [], problems: ["Propose at least one package: a list of { id, title, features, rationale, estimated_lines }."] };
  if (raw.length > PACKAGE_MAX_COUNT) problems.push(`${raw.length} packages is too many (at most ${PACKAGE_MAX_COUNT}); group features that change the same files.`);
  const known = new Set(features.map((f) => f.id));
  const owners = new Map<string, string[]>();
  const ids = new Set<string>();
  const packages: WorkPackage[] = [];
  raw.forEach((p, i) => {
    const o = isObj(p) ? p : {};
    const id = str(o.id);
    const name = id || `package ${i + 1}`;
    if (!id) problems.push(`package ${i + 1} has no id (use P1, P2, ...).`);
    else if (ids.has(id)) problems.push(`id ${id} is used twice; every package needs its own id.`);
    ids.add(id);
    const title = str(o.title);
    if (!title) problems.push(`${name} has no title.`);
    const rationale = str(o.rationale);
    if (!rationale) problems.push(`${name} has no rationale: say why these features belong in one pull request.`);
    const linesRaw = o.estimated_lines ?? o.estimatedLines;
    const lines = typeof linesRaw === "number" && Number.isFinite(linesRaw) ? linesRaw : NaN;
    if (!(lines > 0)) problems.push(`${name} needs a positive number of changed lines (estimated_lines).`);
    else if (lines > maxLines) problems.push(`${name} estimates ${lines} changed lines; a reviewable pull request is at most ${maxLines}. Split it into smaller packages.`);
    const feats = Array.isArray(o.features) ? o.features.map(str).filter(Boolean) : [];
    if (!feats.length) problems.push(`${name} has no features; every package builds at least one feature.`);
    for (const f of feats) {
      if (!known.has(f)) problems.push(`${name} lists ${f}, which is not in the feature list (${[...known].join(", ") || "empty"}).`);
      owners.set(f, [...(owners.get(f) ?? []), name]);
    }
    const depsRaw = o.depends_on ?? o.dependsOn;
    const deps = Array.isArray(depsRaw) ? depsRaw.map(str).filter(Boolean) : [];
    const earlier = new Set(raw.slice(0, i).map((q) => (isObj(q) ? str(q.id) : "")));
    for (const d of deps) {
      if (d === id) problems.push(`${name} depends on itself.`);
      else if (!raw.some((q) => isObj(q) && str(q.id) === d)) problems.push(`${name} depends on ${d}, which is not a package.`);
      else if (!earlier.has(d)) problems.push(`${name} depends on ${d}, which comes later; order the packages so each one builds on the ones before it.`);
    }
    packages.push({ id, title, features: feats, rationale, estimatedLines: lines, dependsOn: deps });
  });
  for (const [f, who] of owners) if (who.length > 1) problems.push(`${f} is in more than one package (${who.join(", ")}); a feature is built once.`);
  const missing = features.filter((f) => !owners.has(f.id)).map((f) => f.id);
  if (missing.length) problems.push(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} in no package; every feature must be built by exactly one package.`);
  return { packages, problems };
}

/** The whole feature list as one package, for runs without a breakdown stage. */
export function singlePackage(title: string, features: FeatureItem[]): WorkPackage[] {
  return [{ id: "P1", title, features: features.map((f) => f.id), rationale: "The whole task as one package.", estimatedLines: 0, dependsOn: [] }];
}

/** "P2 of 3: Document the endpoint". */
export function packageLabel(ref: PackageRef): string {
  return `${ref.id} of ${ref.total}: ${ref.title}`;
}

export function packageRef(packages: WorkPackage[], index: number): PackageRef {
  const p = packages[index];
  return { id: p.id, title: p.title, index: index + 1, total: packages.length };
}

const featureLines = (pkg: WorkPackage, features: FeatureItem[]) => pkg.features.map((id) => `    ${id}: ${features.find((f) => f.id === id)?.title ?? "(unknown feature)"}`);

/** One package for a contract or build brief: its features and why they go together. */
export function renderPackage(pkg: WorkPackage, features: FeatureItem[]): string {
  return [...featureLines(pkg, features), `    why: ${pkg.rationale}`].join("\n");
}

/** The whole breakdown, for the plan approval and the first messages. */
export function renderBreakdown(packages: WorkPackage[], features: FeatureItem[]): string {
  return packages
    .map((p) => {
      const size = [p.estimatedLines > 0 ? `~${p.estimatedLines} lines` : "", p.dependsOn.length ? `after ${p.dependsOn.join(", ")}` : ""].filter(Boolean).join("; ");
      return [`- ${p.id}: ${p.title}${size ? ` (${size})` : ""}`, renderPackage(p, features)].join("\n");
    })
    .join("\n");
}
