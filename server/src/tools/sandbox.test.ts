import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxArgs, sandboxAvailable, seatbeltProfile } from "./sandbox.js";

describe("seatbelt profile", () => {
  it("denies network unless allowed and lists the workspace as writable", () => {
    const p = seatbeltProfile("/w", false);
    expect(p).toContain("(deny network*)");
    expect(p).toContain('(subpath "/w")');
    expect(p).toContain("(deny file-read*");
    expect(p).toContain(".ssh");
    expect(seatbeltProfile("/w", true)).not.toContain("(deny network*)");
  });

  it.skipIf(!sandboxAvailable())("really blocks writes outside the workspace and network", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "reins-sb-"));
    const outside = path.join(os.homedir(), `.reins-sandbox-probe-${process.pid}`);
    const cmd = `echo in > inside.txt && echo ok-inside; (echo x > ${outside}) 2>/dev/null && echo wrote-outside || echo denied-outside; (curl -s -m 2 https://example.com >/dev/null 2>&1) && echo net-ok || echo net-denied`;
    const { file, args } = sandboxArgs(cmd, ws, false);
    const out = execFileSync(file, args, { cwd: ws, encoding: "utf8" });
    expect(out).toContain("ok-inside");
    expect(out).toContain("denied-outside");
    expect(out).toContain("net-denied");
    expect(fs.existsSync(outside)).toBe(false);
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
