import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * macOS Seatbelt sandbox for agent shell commands. Mirrors the two rules the
 * sandboxing post found had to go together: filesystem isolation (writes
 * only inside the workspace and temp) and network isolation (off unless the
 * run allows it). Reads stay open so builds and tests keep working.
 */
export const SANDBOX_BIN = "/usr/bin/sandbox-exec";

export function sandboxAvailable(): boolean {
  return process.platform === "darwin" && fs.existsSync(SANDBOX_BIN);
}

function lit(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

export function seatbeltProfile(workspace: string, allowNetwork: boolean): string {
  const home = os.homedir();
  const realWs = fs.existsSync(workspace) ? fs.realpathSync(workspace) : workspace;
  const tmp = process.env.TMPDIR ? path.resolve(process.env.TMPDIR) : "/tmp";
  const writable = [
    realWs,
    workspace,
    "/tmp",
    "/private/tmp",
    "/dev",
    "/private/var/folders",
    "/var/folders",
    tmp,
    path.join(home, ".npm"),
    path.join(home, ".cache"),
    path.join(home, "Library", "Caches"),
    path.join(home, ".cargo", "registry"),
    path.join(home, "go", "pkg"),
  ];
  const rules = [
    "(version 1)",
    "(allow default)",
    // Reads stay open for builds, except the places credentials live.
    `(deny file-read* ${[".ssh", ".aws", ".git-credentials", ".config/gh", ".netrc", ".npmrc", ".reins/settings.json"].map((p) => `(subpath ${lit(path.join(home, p))})`).join(" ")})`,
    allowNetwork ? "" : "(deny network*)",
    "(deny file-write*)",
    `(allow file-write* ${[...new Set(writable)].map((p) => `(subpath ${lit(p)})`).join(" ")})`,
    // sockets some tools create for IPC
    `(allow file-write* (regex #"^/private/var/run/"))`,
  ];
  return rules.filter(Boolean).join("\n");
}

/** Wrap a shell command so it runs under the profile. */
export function sandboxArgs(command: string, workspace: string, allowNetwork: boolean): { file: string; args: string[] } {
  return { file: SANDBOX_BIN, args: ["-p", seatbeltProfile(workspace, allowNetwork), "/bin/zsh", "-lc", command] };
}
