// One box for lesson intake: read what was pasted as a web page, a git
// repository (or a folder), a configured MCP server, or plain text. Pure, so
// the form and vitest share it.

export type DetectedSource = { kind: "url"; url: string } | { kind: "repo"; repo: string; ref?: string } | { kind: "mcp"; name: string } | { kind: "text"; text: string };

// A repository's front page on a known host: owner/repo (GitLab also nests groups, and marks pages with /-/).
const GIT_HOSTS = /^https?:\/\/(www\.)?((github\.com|bitbucket\.org|codeberg\.org|sr\.ht)\/[^/\s#]+\/[^/\s#]+|gitlab\.com(\/[^/\s#-][^/\s#]*){2,})\/?$/i;
const GIT_ADDRESS = /^(git@[\w.-]+:[^\s#]+|ssh:\/\/[^\s#]+|git:\/\/[^\s#]+|https?:\/\/[^\s#]+\.git)$/i;
const FOLDER = /^(~|\.{1,2})?\/[^\s]*$/;
const MCP_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Split "…#ref" off a repository address; a ref is a branch or tag name. */
function splitRef(s: string): { repo: string; ref?: string } {
  const i = s.lastIndexOf("#");
  if (i <= 0) return { repo: s };
  const ref = s.slice(i + 1);
  return /^[\w./-]+$/.test(ref) ? { repo: s.slice(0, i), ref } : { repo: s };
}

/** What the box holds, by its shape; `servers` are the MCP server names Claude Code has configured. */
export function detectSource(raw: string, servers: string[]): DetectedSource | null {
  const s = raw.trim();
  if (!s) return null;
  const one = !s.includes("\n");
  if (one) {
    const mcp = s.match(/^mcp:\/\/([^\s/]+)\/?$/i);
    if (mcp) return { kind: "mcp", name: mcp[1].toLowerCase() };
    const lower = s.toLowerCase();
    if (MCP_NAME.test(lower) && servers.some((n) => n.toLowerCase() === lower)) return { kind: "mcp", name: servers.find((n) => n.toLowerCase() === lower)!.toLowerCase() };
    const { repo, ref } = splitRef(s);
    if (GIT_ADDRESS.test(repo) || GIT_HOSTS.test(repo)) return { kind: "repo", repo: repo.replace(/\/$/, ""), ...(ref ? { ref } : {}) };
    if (FOLDER.test(s)) return { kind: "repo", repo: s };
    if (/^https?:\/\/\S+$/i.test(s)) return { kind: "url", url: s };
  }
  return { kind: "text", text: s };
}

/** How the box will be read, in one short line. */
export function describeSource(d: DetectedSource): string {
  switch (d.kind) {
    case "url":
      return "Web page, read whole";
    case "repo":
      return /^(https?|ssh|git):\/\/|^git@/i.test(d.repo) ? `Git repository${d.ref ? ` at ${d.ref}` : ""}, explored for what you ask` : "Folder on this machine, explored for what you ask";
    case "mcp":
      return `MCP server ${d.name}, explored for what you ask`;
    case "text":
      return `Pasted text, ${d.text.length.toLocaleString("en-US")} characters, read whole`;
  }
}

/** Explored sources need a focus: the librarian cannot read a repository or a server whole. */
export const needsFocus = (d: DetectedSource | null) => !!d && (d.kind === "repo" || d.kind === "mcp");
