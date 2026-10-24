// Plain-language one-liners for tool calls. Shared so the replay engine and
// the live engine produce identical stage text.

function short(s: unknown, n = 70): string {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "");
  const one = str.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

export function narrateToolCall(name: string, input: any): string {
  switch (name) {
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
    case "tool_search_tool_regex":
      return `Looking for a tool matching /${short(input?.pattern ?? input?.query, 40)}/`;
    default:
      return `Calling ${name}`;
  }
}
