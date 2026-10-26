// Plain-language one-liners for tool calls. Shared so the replay engine, the
// direct-API engine and the Claude Code engine produce identical stage text.

function short(s: unknown, n = 70): string {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "");
  const one = str.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function rel(p: unknown): string {
  if (typeof p !== "string") return "a file";
  const parts = p.split("/");
  return parts.length > 4 ? "…/" + parts.slice(-3).join("/") : p;
}

export function narrateToolCall(name: string, input: any): string {
  const base = name.replace(/^mcp__reins__/, "");
  switch (base) {
    // Reins tools
    case "bash":
      return `Running \`${short(input?.command, 80)}\``;
    case "read_file":
      return `Reading ${input?.path ?? "a file"}`;
    case "write_file":
      return `Writing ${input?.path ?? "a file"}`;
    case "edit_file":
      return `Editing ${input?.path ?? "a file"}`;
    case "list_files":
      return `Listing files matching ${input?.pattern ?? "*"}`;
    case "search":
      return `Searching for "${short(input?.query, 40)}"`;
    case "think":
      return `Thinking: ${short(input?.thought, 90)}`;
    case "update_progress":
      return `Updating progress notes`;
    case "propose_contract":
      return `Proposing a definition of done (${Array.isArray(input?.criteria) ? input.criteria.length : "?"} criteria)`;
    case "propose_breakdown":
      return `Slicing the plan into ${Array.isArray(input?.packages) ? input.packages.length : "?"} work packages`;
    case "review_contract":
      return input?.accept ? `Accepting the contract` : `Revising the contract`;
    case "report_evaluation":
      return `Reporting evaluation results`;
    case "finish":
      return `Finishing: ${short(input?.summary, 80)}`;
    case "git_status":
      return `Checking git status`;
    case "git_diff":
      return `Reviewing the diff`;
    case "git_commit":
      return `Committing: ${short(input?.message, 60)}`;
    case "http_fetch":
      return `Fetching ${short(input?.url, 60)}`;
    case "read_lesson":
      return `Consulting the lesson "${input?.slug}"`;
    case "list_lessons":
      return `Browsing the lesson library`;
    case "read_skill":
      return `Reading the skill "${input?.name}"`;
    case "delegate_scout":
      return `Sending a scout to find out: ${short(input?.question, 70)}`;
    case "tool_search_tool_regex":
      return `Looking for a tool matching /${short(input?.pattern ?? input?.query, 40)}/`;
    // Claude Code built-in tools
    case "Bash":
      return `Running \`${short(input?.command, 80)}\``;
    case "Read":
      return `Reading ${rel(input?.file_path)}`;
    case "Write":
      return `Writing ${rel(input?.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `Editing ${rel(input?.file_path)}`;
    case "Glob":
      return `Listing files matching ${input?.pattern ?? "*"}`;
    case "Grep":
      return `Searching for "${short(input?.pattern, 40)}"`;
    case "TodoWrite":
      return `Updating the to-do list`;
    case "Task":
    case "Agent":
      return `Delegating: ${short(input?.description ?? input?.prompt, 70)}`;
    case "WebFetch":
      return `Fetching ${short(input?.url, 60)}`;
    case "WebSearch":
      return `Searching the web for "${short(input?.query, 50)}"`;
    case "ToolSearch":
      return `Looking for a tool: ${short(input?.query, 50)}`;
    case "Skill":
      return `Using the skill "${input?.skill}"`;
    default:
      return `Calling ${base}`;
  }
}
