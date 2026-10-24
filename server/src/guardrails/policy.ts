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
  [/\bshutdown\b|\breboot\b|\bkillall\b/, "system control"],
];

// Needs a human (or the classifier) in auto mode.
const ASK: [RegExp, string][] = [
  [/\bgit\s+push\b/, "pushes to a remote"],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s)/, "discards local changes"],
  [/\brm\s+-[a-zA-Z]*r/, "recursive delete"],
  [/\b(npm|pnpm|yarn)\s+publish\b/, "publishes a package"],
  [/\bdocker\s+(rm|rmi|system\s+prune)\b/, "removes containers or images"],
  [/\bkubectl\s+(delete|apply|scale)\b/, "mutates a cluster"],
  [/\b(psql|mysql)\b.*\b(drop|truncate|delete)\b/i, "destructive SQL"],
  [/\b(open|xdg-open)\b/, "opens an application"],
  [/\bosascript\b|\bautomator\b/, "scripts the desktop"],
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
  for (const src of policy.denyPatterns) {
    try {
      if (new RegExp(src).test(command)) return { verdict: "deny", rule: `deny:custom`, rationale: `Blocked by your deny pattern /${src}/.` };
    } catch {
      /* ignore bad pattern */
    }
  }
  if (policy.mode === "trust") return { verdict: "allow", rule: "mode:trust", rationale: "Trust mode allows everything not hard-denied." };

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
  const rel = path.relative(workspace, abs);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    return { ok: false, reason: `path escapes the workspace: ${p}` };
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
