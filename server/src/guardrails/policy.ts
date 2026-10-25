import fs from "node:fs";
import path from "node:path";
import type { GuardrailPolicy, GuardrailVerdict } from "../../../shared/types.js";

export interface RuleDecision {
  verdict: GuardrailVerdict;
  rule: string;
  rationale: string;
}

// Hard denies: never run, regardless of mode. Clearly destructive or
// privilege-escalating; mirrors the "some things are never auto-approved"
// stance of the auto mode and sandboxing posts.
const DENY: [RegExp, string][] = [
  [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|~|\$HOME)(\s|$)/, "recursive delete of root or home"],
  [/\bsudo\b/, "privilege escalation"],
  [/\bmkfs\b|\bdd\s+if=/, "disk-level write"],
  [/\b(curl|wget)\b[^|]*\|\s*(ba)?sh\b/, "pipe remote script to shell"],
  [/\bgit\s+push\b.*(--force|-f)\b/, "force push"],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, "fork bomb"],
  [/\bchmod\s+(-R\s+)?777\s+\//, "world-writable root"],
  [/\bshutdown\b|\breboot\b/, "system control"],
  // Signalling every process (`kill -1`, `kill -9 -1`, `kill -- -1`) takes the harness down with it.
  [/\bkill\s+(-\S+\s+)*-1\b/, "signals every process"],
];

// Process names a kill-by-pattern must not be aimed at bare: the harness, its
// dev servers and the agent's own runtime run under these, and a stray
// `pkill -f node` once took out an agent's own harness. A pattern that also
// names a port, a path, an env assignment or a PID is specific enough and
// only needs an approval in auto mode; `kill <pid>` is always ordinary.
const HARNESS_PROCESS_NAMES = /^(node|nodejs|tsx|ts-node|vite|npm|npx|pnpm|yarn|bun|deno|concurrently|claude|python3?|perl|ruby|java|go|sh|bash|zsh)$/;

/**
 * Returns the offending pattern when the command kills processes by a broad
 * name (`killall node`, `pkill -f tsx`, `pkill -9 node`), null otherwise.
 */
export function broadKillPattern(command: string): string | null {
  const re = /\b(pkill|killall)\b([^|;&\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command))) {
    // The pattern is the quoted argument if there is one, else the last bare word.
    const rest = m[2];
    const quoted = rest.match(/["']([^"']+)["']/);
    const bare = quoted ? quoted[1].trim() : (rest.trim().split(/\s+/).filter((a) => a && !a.startsWith("-")).pop() ?? "");
    if (!bare) return m[1]; // nothing named at all
    const specific = /[\d/=:]/.test(bare);
    if (!specific || HARNESS_PROCESS_NAMES.test(bare)) return bare;
  }
  return null;
}

// Needs a human (or the classifier) in auto mode.
const ASK: [RegExp, string][] = [
  [/\bgit\s+push\b/, "pushes to a remote"],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s)/, "discards local changes"],
  [/\brm\s+-[a-zA-Z]*r/, "recursive delete"],
  [/\b(npm|pnpm|yarn)\s+publish\b/, "publishes a package"],
  [/\bdocker\s+(rm|rmi|system\s+prune)\b/, "removes containers or images"],
  [/\bkubectl\s+(delete|apply|scale)\b/, "mutates a cluster"],
  [/\b(psql|mysql)\b.*\b(drop|truncate|delete)\b/i, "destructive SQL"],
  [/(^|[;&|]\s*|\$\(\s*)(open|xdg-open)\s/, "opens an application"],
  [/\bosascript\b|\bautomator\b/, "scripts the desktop"],
  [/\b(pkill|killall)\b/, "kills processes by pattern"],
];

const NETWORK: [RegExp, string][] = [
  [/\b(curl|wget|http|https|nc|ssh|scp|rsync|ftp)\b/, "network access"],
  [/\b(npm|pnpm|yarn)\s+(install|add|ci|update|i)\b/, "downloads packages"],
  [/\bpip3?\s+install\b|\bcargo\s+(add|install)\b|\bgo\s+(get|mod\s+download)\b|\bbrew\s+install\b/, "downloads packages"],
  [/\bgit\s+(clone|fetch|pull)\b/, "contacts a git remote"],
];

// Clearly read-only commands: always allowed, parallel-safe.
const SAFE_PREFIX =
  /^\s*(ls|cat|head|tail|wc|grep|rg|find|fd|echo|pwd|which|type|file|stat|du|df|tree|sed\s+-n|awk|sort|uniq|cut|diff|jq|yq|env|printenv|date|whoami|uname|node\s+-v|npm\s+-v|python3?\s+--version|go\s+version|cargo\s+--version|git\s+(status|log|diff|show|branch|rev-parse|ls-files|blame))(\s|$)/;

export function classifyBash(command: string, policy: GuardrailPolicy): RuleDecision {
  for (const [re, why] of DENY) if (re.test(command)) return { verdict: "deny", rule: `deny:${why}`, rationale: `Blocked: ${why}.` };
  const broad = broadKillPattern(command);
  if (broad) return { verdict: "deny", rule: "deny:broad kill", rationale: `Blocked: killing processes by the broad name "${broad}" can take out the harness itself. Kill the PID you started (kill $PID, or lsof -ti:PORT | xargs kill), or name the port, path or env assignment in the pattern.` };
  for (const src of policy.denyPatterns) {
    try {
      if (new RegExp(src).test(command)) return { verdict: "deny", rule: `deny:custom`, rationale: `Blocked by your deny pattern /${src}/.` };
    } catch {
      /* ignore bad pattern */
    }
  }
  if (policy.mode === "trust") return { verdict: "allow", rule: "mode:trust", rationale: "Trust mode allows everything not hard-denied." };
  for (const src of policy.allowPatterns ?? []) {
    // A blanket interpreter or shell as an allow rule would let anything through; ignore those (auto mode lesson).
    if (/^\^?\(?(python3?|node|ruby|sh|bash|zsh|npm run|npx)\b/.test(src.replace(/\\b/g, "")) && !/\s\S/.test(src)) continue;
    try {
      if (new RegExp(src).test(command)) return { verdict: "allow", rule: "allow:custom", rationale: `Matches your allow pattern /${src}/.` };
    } catch {
      /* ignore bad pattern */
    }
  }

  for (const src of policy.askPatterns) {
    try {
      if (new RegExp(src).test(command)) return { verdict: "ask", rule: `ask:custom`, rationale: `Matches your ask pattern /${src}/.` };
    } catch {
      /* ignore */
    }
  }
  for (const [re, why] of ASK) if (re.test(command)) return { verdict: "ask", rule: `ask:${why}`, rationale: `This command ${why}.` };
  if (!policy.allowNetwork) {
    for (const [re, why] of NETWORK) if (re.test(command)) return { verdict: "ask", rule: `network:${why}`, rationale: `Network is off for this run and this command needs ${why}.` };
  }
  if (SAFE_PREFIX.test(command) && !/[|;&>]/.test(command.replace(/\|\s*(head|tail|grep|wc|sort|uniq|jq|cut|awk|sed)\b/g, "")))
    return { verdict: "allow", rule: "safe:read-only", rationale: "Read-only command." };

  if (policy.mode === "ask") return { verdict: "ask", rule: "mode:ask", rationale: "Ask mode: anything not clearly read-only needs approval." };
  // auto mode: not obviously risky, not obviously safe -> allow, but the
  // classifier (if enabled) gets a say in the loop.
  return { verdict: "allow", rule: "auto:default", rationale: "No risk pattern matched; runs inside the workspace." };
}

/** Confine a model-supplied path to the workspace. Lexical check plus realpath of the parent. */
export function confinePath(workspace: string, p: string): { ok: true; abs: string } | { ok: false; reason: string } {
  const abs = path.resolve(workspace, p);
  const inside = (candidate: string, root: string) => {
    const rel = path.relative(root, candidate);
    return !(rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel));
  };
  if (!inside(abs, workspace)) return { ok: false, reason: `path escapes the workspace: ${p}` };
  // A symlink inside the workspace can point outside it: resolve the deepest
  // existing ancestor and check again against the real workspace.
  try {
    const realRoot = fs.realpathSync(workspace);
    let probe = abs;
    while (!fs.existsSync(probe)) probe = path.dirname(probe);
    const realProbe = fs.realpathSync(probe);
    if (!inside(realProbe, realRoot)) return { ok: false, reason: `path resolves outside the workspace through a symlink: ${p}` };
  } catch {
    /* unreadable path: the lexical check stands */
  }
  return { ok: true, abs };
}

/** Commands that mention absolute paths outside the workspace get flagged. */
export function mentionsOutsidePaths(command: string, workspace: string): string | null {
  const matches = command.match(/(?:^|\s)(\/[\w./-]+|~\/[\w./-]*)/g) ?? [];
  for (const raw of matches) {
    const p = raw.trim().replace(/^~/, process.env.HOME ?? "~");
    if (p.startsWith("/dev/") || p.startsWith("/usr/") || p.startsWith("/bin/") || p.startsWith("/opt/") || p.startsWith("/tmp/") || p.startsWith("/private/tmp/")) continue;
    if (!p.startsWith(workspace)) return p;
  }
  return null;
}
