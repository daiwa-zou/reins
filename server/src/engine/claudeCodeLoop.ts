import { createSdkMcpServer, query, tool, type CanUseTool, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { RoleId, RunConfig, Usage } from "../../../shared/types.js";
import { CONTEXT_LIMIT_TOKENS } from "../../../shared/components.js";
import { narrateToolCall } from "../../../shared/narrate.js";
import { RunBus } from "./bus.js";
import type { LoopControl, LoopOptions, LoopResult } from "./loop.js";
import { addUsage, costUsd, emptyUsage } from "./pricing.js";
import { ALL_TOOLS, scrubbedEnv } from "../tools/registry.js";
import { classifyBash, confinePath, mentionsOutsidePaths } from "../guardrails/policy.js";
import { sniffInjection } from "../guardrails/classifier.js";
import path from "node:path";

/**
 * The same role loop, driven by the Claude Agent SDK (Claude Code's own
 * harness and built-in tools) instead of the Messages API directly. It uses
 * the local Claude Code login, so it runs without an API key. Reins keeps its
 * guardrails (canUseTool), its structured end-of-phase tools (an in-process
 * MCP server) and its event log; the SDK keeps the context management.
 */
export class ClaudeCodeLoop {
  private usage = emptyUsage();
  private cost = 0;
  private turn = 0;
  private sessionId: string | undefined;
  private terminal: { name: string; input: any } | null = null;
  /** The API response currently being streamed (several SDK messages share one message.id). */
  private open: { id: string; usage: Usage; model: string; stopReason: string } | null = null;
  /** tool_use ids of Reins MCP calls seen in assistant blocks, by tool name, consumed by the handler. */
  private mcpIds = new Map<string, string[]>();
  private pending = new Map<string, { name: string; input: unknown; started: number; gated?: boolean }>();

  constructor(
    private config: RunConfig,
    private bus: RunBus,
    private control: LoopControl,
    private opts: LoopOptions & { resumeSessionId?: string },
  ) {
    this.sessionId = opts.resumeSessionId;
  }

  get session() {
    return this.sessionId;
  }

  private mcpServer() {
    const role = this.opts.role;
    const defs = [];
    const structured = ["propose_contract", "review_contract", "report_evaluation", "finish", "update_progress", "think", "list_lessons", "read_lesson", "read_skill", "delegate_scout", "propose_lesson"];
    for (const name of structured) {
      // Terminal tools arrive in opts.terminal, not opts.tools; both must be exposed.
      if (!this.opts.tools.includes(name) && !this.opts.terminal.includes(name)) continue;
      const def = ALL_TOOLS[name];
      if (!def) continue;
      if (name === "think" && !this.config.components.thinkTool) continue;
      if (name === "read_skill" && !this.config.components.skills) continue;
      if (name === "delegate_scout") continue; // scouts need the direct API client
      const schema = def.schema as any;
      defs.push(
        tool(
          name,
          schema.description,
          zodShape(schema.input_schema),
          async (args: any) => {
            const input = args;
            const started = Date.now();
            // Reuse the id the assistant block carried, so Guardrails and the Inspector pair up.
            const id = this.mcpIds.get(name)?.shift() ?? `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
            this.bus.emitEvent({ type: "tool.called", role, toolUseId: id, name, input, narration: narrateToolCall(name, input) });
            try {
              const out = await def.run(input, {
                workspace: this.config.workspace,
                role,
                allowNetwork: this.config.guardrail.allowNetwork,
                sandbox: false,
                signal: this.control.signal,
                handlers: this.opts.handlers,
              });
              this.bus.emitEvent({ type: "tool.result", role, toolUseId: id, name, ok: true, output: out, truncated: false, durationMs: Date.now() - started });
              const isTerminal = this.opts.terminal.includes(name);
              if (isTerminal && !this.terminal) this.terminal = { name, input };
              return { content: [{ type: "text", text: isTerminal ? `${out} This phase is complete: end your turn now without further tool calls.` : out }] };
            } catch (err) {
              const msg = (err as Error).message;
              this.bus.emitEvent({ type: "tool.result", role, toolUseId: id, name, ok: false, output: msg, truncated: false, durationMs: Date.now() - started });
              return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
            }
          },
        ),
      );
    }
    // alwaysLoad: the SDK defers MCP tools behind tool search by default; the
    // structured end-of-phase tools must always be in the prompt.
    return createSdkMcpServer({ name: "reins", version: "0.2.0", tools: defs, alwaysLoad: true });
  }

  /** Find the tool.called id for this permission request (same name, same input, not yet gated). */
  private callId(toolName: string, input: unknown): string {
    const key = JSON.stringify(input);
    for (const [id, p] of this.pending) {
      if (!p.gated && p.name === toolName && JSON.stringify(p.input) === key) {
        p.gated = true;
        return id;
      }
    }
    return `perm_${Date.now().toString(36)}`;
  }

  private canUseTool: CanUseTool = async (toolName, input) => {
    await this.control.waitIfPaused(); // pause takes effect before the next tool, like the direct engine
    const role = this.opts.role;
    const id = this.callId(toolName, input);
    const emit = (verdict: "allow" | "ask" | "deny", source: "rule" | "policy" | "user" | "classifier", rule: string, rationale: string) =>
      this.bus.emitEvent({ type: "guardrail.decision", role, toolUseId: id, tool: toolName, verdict, source, rule, rationale });
    const ws = this.config.workspace;
    const trust = this.config.guardrail.mode === "trust";
    // File tools: confine writes to the workspace; reads outside it ask.
    if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) {
      const p = String((input as any).file_path ?? (input as any).notebook_path ?? "");
      const c = confinePath(ws, p);
      if (!c.ok) {
        emit("deny", "policy", "outside-workspace", c.reason);
        return { behavior: "deny", message: c.reason };
      }
      return { behavior: "allow", updatedInput: input };
    }
    if (["Read", "Glob", "Grep"].includes(toolName)) {
      const p = String((input as any).file_path ?? (input as any).path ?? "");
      const c = p ? confinePath(ws, p) : { ok: true as const, abs: ws };
      if (!c.ok && !trust) {
        emit("ask", "policy", "outside-workspace", `Reads a path outside the workspace: ${p}`);
        const { approved, note } = await this.control.requestApproval("action", narrateToolCall(toolName, input), `Reads outside the workspace (${p}).`, { tool: toolName, input });
        emit(approved ? "allow" : "deny", "user", "approval", note || (approved ? "Approved by you." : "Rejected by you."));
        return approved ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: `The operator declined reading ${p}${note ? `: ${note}` : "."}` };
      }
      return { behavior: "allow", updatedInput: input };
    }
    if (toolName === "Bash") {
      const cmd = String((input as any).command ?? "");
      const rule = classifyBash(cmd, this.config.guardrail);
      const outside = mentionsOutsidePaths(cmd, ws);
      if (rule.verdict === "deny") {
        emit("deny", "rule", rule.rule, rule.rationale);
        return { behavior: "deny", message: `Denied by guardrails: ${rule.rationale}` };
      }
      if (outside && rule.verdict === "allow" && !trust) {
        rule.verdict = "ask";
        rule.rule = "outside-workspace";
        rule.rationale = `Mentions a path outside the workspace (${outside}).`;
      }
      if (rule.verdict === "ask" && this.config.components.actionClassifier && this.config.guardrail.mode === "auto") {
        const c = await classifyViaClaudeCode(this.config, cmd, rule.rationale, this.control.signal);
        emit(c.verdict, "classifier", rule.rule, c.rationale);
        if (c.verdict === "allow") return { behavior: "allow", updatedInput: input };
        if (c.verdict === "deny") return { behavior: "deny", message: `Denied by the action classifier: ${c.rationale}` };
        rule.rationale = c.rationale;
      }
      if (rule.verdict === "ask") {
        emit("ask", "rule", rule.rule, rule.rationale);
        const { approved, note } = await this.control.requestApproval("action", narrateToolCall("Bash", input), rule.rationale, { tool: "bash", input });
        emit(approved ? "allow" : "deny", "user", "approval", note || (approved ? "Approved by you." : "Rejected by you."));
        return approved ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: `The operator declined this action${note ? `: ${note}` : "."}` };
      }
      emit("allow", "rule", rule.rule, rule.rationale);
      return { behavior: "allow", updatedInput: input };
    }
    if (["WebFetch", "WebSearch"].includes(toolName) && !this.config.guardrail.allowNetwork) {
      emit("deny", "policy", "network", "Network is off for this run.");
      return { behavior: "deny", message: "Network is off for this run." };
    }
    return { behavior: "allow", updatedInput: input };
  };

  async run(firstUserMessage?: string): Promise<LoopResult> {
    const role = this.opts.role;
    const s = this.config.roles[role as "planner"] ?? this.config.roles.planner;
    const steer = this.control.drainSteer();
    const prompt = [firstUserMessage ?? "Continue.", ...steer.map((n) => `Operator note: ${n}`)].join("\n\n");
    for (const n of steer) this.bus.emitEvent({ type: "steer.delivered", text: n, role });

    // The subprocess gets a scrubbed environment plus what the SDK itself needs to authenticate.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(scrubbedEnv())) if (v !== undefined) env[k] = v;
    for (const k of ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) if (process.env[k]) env[k] = process.env[k]!;

    const canWrite = this.opts.tools.includes("write_file");
    const canShell = this.opts.tools.includes("bash");
    const allowed = ["Read", "Glob", "Grep", "TodoWrite"];
    if (canShell) allowed.push("Bash");
    if (canWrite) allowed.push("Edit", "Write", "MultiEdit");
    if (this.config.guardrail.allowNetwork) allowed.push("WebFetch", "WebSearch");
    const options: Options = {
      cwd: this.config.workspace,
      model: s.model,
      effort: s.effort,
      maxTurns: this.opts.maxTurns,
      maxBudgetUsd: Math.max(0.01, this.control.remainingBudget()),
      systemPrompt:
        this.opts.system +
        (canWrite ? "" : "\n\nYou may read" + (canShell ? " and run commands" : "") + " but must not create or edit files in this phase.") +
        "\n\nThe Reins tools (propose_contract, review_contract, report_evaluation, finish, update_progress, think, read_skill, lessons) are available as mcp__reins__* tools and are always loaded; call them directly." +
        "\n\nShell commands run in the user's login shell, where cat, mv, cp and rm may be aliased to interactive or colourising variants that hang or garble output without a tty. Use the Read, Write and Edit tools for files, and in shell commands write \\cat, \\mv, \\cp, \\rm (or /bin/ paths) to bypass aliases. Never run interactive commands.",
      // Restrict the built-in tool set with `tools`, and keep allowedTools empty so
      // every call (built-in and mcp__reins__*) falls through to canUseTool.
      tools: allowed,
      allowedTools: [],
      disallowedTools: canWrite ? [] : ["Edit", "Write", "MultiEdit", "NotebookEdit"],
      permissionMode: "default",
      canUseTool: this.canUseTool,
      mcpServers: { reins: this.mcpServer() },
      // Only Reins' own server: the user's MCP servers, connectors and hooks stay out of the harness.
      settingSources: [],
      strictMcpConfig: true,
      ...(this.config.components.osSandbox
        ? { sandbox: { enabled: true, autoAllowBashIfSandboxed: false, ...(this.config.guardrail.allowNetwork ? {} : { network: { allowedDomains: [], strictAllowlist: true } }) } }
        : {}),
      env,
      abortController: new AbortController(),
      resume: this.sessionId,
      includePartialMessages: false,
    };
    const onAbort = () => options.abortController?.abort();
    this.control.signal.addEventListener("abort", onAbort, { once: true });

    let finalText = "";
    let reason: LoopResult["reason"] = "end_turn";
    try {
      await this.control.waitIfPaused();
      const q = query({ prompt, options });
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        if (this.control.signal.aborted) {
          reason = "aborted";
          break;
        }
        await this.control.waitIfPaused();
        this.handle(msg, (t) => (finalText = t));
        if (msg.type === "result") {
          if (msg.subtype === "error_max_turns") reason = "max_turns";
          else if (msg.subtype === "error_max_budget_usd") reason = "budget";
          else if (msg.subtype !== "success") reason = "error";
          break;
        }
        if (this.control.remainingBudget() <= 0) {
          this.bus.emitEvent({ type: "error", message: `Budget of $${this.config.budgetUsd} exhausted`, recoverable: false });
          reason = "budget";
          await q.interrupt().catch(() => {});
          break;
        }
      }
    } catch (err) {
      if (this.control.signal.aborted) reason = "aborted";
      else {
        reason = "error";
        this.bus.emitEvent({ type: "error", message: `Claude Code engine failed: ${(err as Error).message}`, recoverable: false, detail: (err as Error).stack });
      }
    } finally {
      this.closeTurn();
      this.control.signal.removeEventListener("abort", onAbort);
    }
    if (this.terminal) reason = "terminal";
    return { reason, terminalTool: this.terminal?.name, terminalInput: this.terminal?.input, messages: [], usage: this.usage, costUsd: this.cost, turns: this.turn, finalText };
  }

  /** Emit turn.finished and the context snapshot for the API response being streamed, priced from its usage. */
  private closeTurn() {
    const o = this.open;
    if (!o) return;
    this.open = null;
    const role = this.opts.role;
    const turnCost = costUsd(o.model, o.usage);
    this.usage = addUsage(this.usage, o.usage);
    this.cost += turnCost;
    this.bus.emitEvent({ type: "turn.finished", role, turn: this.turn, usage: o.usage, costUsd: turnCost, stopReason: o.stopReason, model: o.model });
    const prompt = o.usage.input + o.usage.cacheRead + o.usage.cacheWrite;
    if (prompt > 0)
      this.bus.emitEvent({
        type: "context.snapshot",
        snapshot: { role, promptTokens: prompt, limit: CONTEXT_LIMIT_TOKENS, composition: { system: Math.round(prompt * 0.12), tools: Math.round(prompt * 0.1), history: Math.round(prompt * 0.4), toolResults: Math.round(prompt * 0.33), thinking: Math.round(prompt * 0.05) }, turn: this.turn },
      });
  }

  private handle(msg: SDKMessage, setFinal: (t: string) => void) {
    const role = this.opts.role;
    switch (msg.type) {
      case "system": {
        if ((msg as any).subtype === "init") {
          this.sessionId = (msg as any).session_id;
          const servers = ((msg as any).mcp_servers ?? []).map((x: any) => `${x.name}:${x.status}`).join(", ");
          this.bus.emitEvent({ type: "note", level: "info", text: `Claude Code ${(msg as any).claude_code_version} session for the ${role} (${(msg as any).model}); credentials: ${(msg as any).apiKeySource}; tools: ${((msg as any).tools ?? []).length}; mcp: ${servers || "none"}.` });
        } else if ((msg as any).subtype === "compact_boundary") {
          const cm = (msg as any).compact_metadata ?? {};
          this.bus.emitEvent({ type: "context.compacted", role, beforeTokens: cm.pre_tokens ?? 0, afterTokens: cm.post_tokens ?? 0, summary: `Compacted by Claude Code (${cm.trigger ?? "auto"}).` });
        }
        break;
      }
      case "assistant": {
        if ((msg as any).parent_tool_use_id) return; // subagent chatter stays out of the stage
        const m = (msg as any).message;
        const id = String(m?.id ?? `anon_${this.turn + 1}`);
        if (!this.open || this.open.id !== id) {
          this.closeTurn();
          this.turn++;
          this.open = { id, usage: emptyUsage(), model: m?.model ?? (this.config.roles[role as "planner"] ?? this.config.roles.planner).model, stopReason: "" };
          this.bus.emitEvent({ type: "turn.started", role, turn: this.turn });
        }
        const u = m?.usage ?? {};
        // Streamed messages of one response repeat the same usage; keep the latest, do not sum.
        this.open.usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
        if (m?.stop_reason) this.open.stopReason = m.stop_reason;
        if ((msg as any).error) this.bus.emitEvent({ type: "error", message: `Claude Code reported ${(msg as any).error}.`, recoverable: (msg as any).error === "rate_limit" || (msg as any).error === "overloaded" });
        for (const b of m?.content ?? []) {
          if (b.type === "text" && b.text?.trim()) {
            setFinal(b.text);
            this.bus.emitEvent({ type: "text", role, text: b.text });
          } else if (b.type === "thinking" && b.thinking?.trim()) this.bus.emitEvent({ type: "thinking", role, text: b.thinking });
          else if (b.type === "tool_use") {
            if (String(b.name).startsWith("mcp__reins__")) {
              const short = String(b.name).replace(/^mcp__reins__/, "");
              this.mcpIds.set(short, [...(this.mcpIds.get(short) ?? []), b.id]);
            } else {
              this.pending.set(b.id, { name: b.name, input: b.input, started: Date.now() });
              this.bus.emitEvent({ type: "tool.called", role, toolUseId: b.id, name: b.name, input: b.input, narration: narrateToolCall(b.name, b.input) });
            }
          }
        }
        break;
      }
      case "user": {
        if ((msg as any).parent_tool_use_id) return;
        const content = (msg as any).message?.content;
        if (!Array.isArray(content)) return;
        for (const b of content) {
          if (b.type !== "tool_result") continue;
          const p = this.pending.get(b.tool_use_id);
          if (!p) continue;
          this.pending.delete(b.tool_use_id);
          const text = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: any) => (x.type === "text" ? x.text : `[${x.type}]`)).join("\n") : "";
          const sniff = sniffInjection(text);
          if (sniff) this.bus.emitEvent({ type: "note", level: "warn", text: `Tool output from ${p.name} contains instruction-shaped text (${sniff}).` });
          this.bus.emitEvent({ type: "tool.result", role, toolUseId: b.tool_use_id, name: p.name, ok: !b.is_error, output: text.slice(0, 24_000), truncated: text.length > 24_000, durationMs: Date.now() - p.started });
        }
        break;
      }
      case "result": {
        this.closeTurn();
        const r = msg as any;
        if (r.is_error && r.subtype !== "error_max_turns" && r.subtype !== "error_max_budget_usd")
          this.bus.emitEvent({ type: "error", message: `Claude Code ended with ${r.subtype}: ${String(r.result ?? r.errors?.join?.("; ") ?? "").slice(0, 300)}`, recoverable: true });
        if (r.subtype === "error_max_budget_usd") this.bus.emitEvent({ type: "error", message: `Budget of $${this.config.budgetUsd} exhausted`, recoverable: false });
        break;
      }
      default:
        break;
    }
  }
}

/**
 * The action classifier for the Claude Code engine: a single-turn query with a
 * small model through the same login, no tools, that sees only the task and
 * the command (never the agent's prose).
 */
export async function classifyViaClaudeCode(config: RunConfig, command: string, ruleHint: string, signal: AbortSignal): Promise<{ verdict: "allow" | "ask" | "deny"; rationale: string }> {
  const prompt = `You are the action classifier inside an agent harness. An autonomous coding agent is working on this task:\n\n${config.task}\n\nIt wants to run this shell command inside the project workspace ${config.workspace}:\n\n${command.slice(0, 3000)}\n\nA rule flagged it: ${ruleHint}\n\nDecide whether a reasonable developer who gave that task would consent to this command. Allow ordinary builds, tests, scratch files under /tmp, edits inside the project. Deny anything that exfiltrates data, reaches unrelated hosts, touches credentials, modifies the system outside the project, or is irreversible and unrelated to the task. If genuinely unsure, answer ask.\n\nReply with exactly one line of JSON: {"verdict":"allow"|"ask"|"deny","rationale":"<one sentence>"}`;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(scrubbedEnv())) if (v !== undefined) env[k] = v;
  for (const k of ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) if (process.env[k]) env[k] = process.env[k]!;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    let text = "";
    for await (const msg of query({ prompt, options: { model: config.roles.classifier.model, maxTurns: 1, tools: [], allowedTools: [], settingSources: [], strictMcpConfig: true, systemPrompt: "Answer with one line of JSON only.", env, abortController: ac, permissionMode: "dontAsk" } }) as AsyncIterable<SDKMessage>) {
      if (msg.type === "assistant") for (const b of (msg as any).message?.content ?? []) if (b.type === "text") text += b.text;
      if (msg.type === "result") break;
    }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { verdict: "ask", rationale: "Classifier gave no parseable answer." };
    const parsed = JSON.parse(m[0]);
    const verdict = ["allow", "ask", "deny"].includes(parsed.verdict) ? parsed.verdict : "ask";
    return { verdict, rationale: String(parsed.rationale ?? "").slice(0, 300) || "No rationale given." };
  } catch (err) {
    return { verdict: "ask", rationale: `Classifier unavailable (${(err as Error).message.slice(0, 100)}); asking you instead.` };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function workspaceRelative(workspace: string, p: string): string {
  return path.isAbsolute(p) ? path.relative(workspace, p) : p;
}

/** Enough of JSON Schema to express the Reins tool inputs as a zod shape for the SDK's MCP server. */
export function zodShape(schema: any): Record<string, z.ZodTypeAny> {
  const out: Record<string, z.ZodTypeAny> = {};
  const required = new Set<string>(schema?.required ?? []);
  for (const [k, v] of Object.entries<any>(schema?.properties ?? {})) {
    let t = zodOf(v);
    if (v.description) t = t.describe(v.description);
    out[k] = required.has(k) ? t : t.optional();
  }
  return out;
}

function zodOf(v: any): z.ZodTypeAny {
  switch (v?.type) {
    case "string":
      return Array.isArray(v.enum) ? z.enum(v.enum as [string, ...string[]]) : z.string();
    case "integer":
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(zodOf(v.items ?? {}));
    case "object":
      return z.object(zodShape(v));
    default:
      return z.any();
  }
}
