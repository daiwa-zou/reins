import { describe, expect, it } from "vitest";
import { detectSource, describeSource } from "../../shared/intakeInput.js";

// One box: whatever is pasted is read as a web page, a git repository, a
// configured MCP server or plain text, so the form needs no tabs.

const servers = ["llm-wiki", "docs"];

describe("detectSource", () => {
  it("a web address is a page unless it points at a repository", () => {
    expect(detectSource("https://www.anthropic.com/engineering/post", servers)).toEqual({ kind: "url", url: "https://www.anthropic.com/engineering/post" });
    expect(detectSource("  https://example.com/x?y=1 ", servers)).toEqual({ kind: "url", url: "https://example.com/x?y=1" });
    expect(detectSource("https://github.com/acme/platform", servers)).toEqual({ kind: "repo", repo: "https://github.com/acme/platform" });
    expect(detectSource("https://github.com/acme/platform/", servers)).toEqual({ kind: "repo", repo: "https://github.com/acme/platform" });
    expect(detectSource("https://github.com/acme/platform.git#release-2", servers)).toEqual({ kind: "repo", repo: "https://github.com/acme/platform.git", ref: "release-2" });
    expect(detectSource("https://gitlab.com/group/sub/repo#main", servers)).toEqual({ kind: "repo", repo: "https://gitlab.com/group/sub/repo", ref: "main" });
    // A page inside a repository is still a page.
    expect(detectSource("https://github.com/acme/platform/blob/main/README.md", servers)).toEqual({ kind: "url", url: "https://github.com/acme/platform/blob/main/README.md" });
    expect(detectSource("https://github.com/acme/platform/issues/12", servers)).toEqual({ kind: "url", url: "https://github.com/acme/platform/issues/12" });
  });

  it("git addresses and folders are repositories, with an optional #ref", () => {
    expect(detectSource("git@github.com:acme/platform.git", servers)).toEqual({ kind: "repo", repo: "git@github.com:acme/platform.git" });
    expect(detectSource("ssh://git@host/x/y.git#v2", servers)).toEqual({ kind: "repo", repo: "ssh://git@host/x/y.git", ref: "v2" });
    expect(detectSource("~/Developer/sample-cli", servers)).toEqual({ kind: "repo", repo: "~/Developer/sample-cli" });
    expect(detectSource("/Users/me/code/app", servers)).toEqual({ kind: "repo", repo: "/Users/me/code/app" });
    expect(detectSource("./here", servers)).toEqual({ kind: "repo", repo: "./here" });
  });

  it("a configured server's name, or mcp://name, is that server", () => {
    expect(detectSource("llm-wiki", servers)).toEqual({ kind: "mcp", name: "llm-wiki" });
    expect(detectSource("Docs", servers)).toEqual({ kind: "mcp", name: "docs" });
    expect(detectSource("mcp://llm-wiki", servers)).toEqual({ kind: "mcp", name: "llm-wiki" });
    expect(detectSource("mcp://other", servers)).toEqual({ kind: "mcp", name: "other" });
  });

  it("anything else is text, and nothing is nothing", () => {
    expect(detectSource("Deploys fail at the handoff between migration and rollout.", servers)).toEqual({ kind: "text", text: "Deploys fail at the handoff between migration and rollout." });
    expect(detectSource("line one\nline two", servers)).toEqual({ kind: "text", text: "line one\nline two" });
    expect(detectSource("   ", servers)).toBeNull();
    expect(detectSource("", [])).toBeNull();
  });

  it("describeSource says how the box will be read", () => {
    expect(describeSource({ kind: "url", url: "https://e.com/p" })).toBe("Web page, read whole");
    expect(describeSource({ kind: "repo", repo: "https://github.com/a/b", ref: "main" })).toBe("Git repository at main, explored for what you ask");
    expect(describeSource({ kind: "repo", repo: "~/code/app" })).toBe("Folder on this machine, explored for what you ask");
    expect(describeSource({ kind: "mcp", name: "llm-wiki" })).toBe("MCP server llm-wiki, explored for what you ask");
    expect(describeSource({ kind: "text", text: "x".repeat(1234) })).toBe("Pasted text, 1,234 characters, read whole");
  });
});
