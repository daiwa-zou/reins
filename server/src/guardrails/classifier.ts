import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { GuardrailVerdict, RoleSettings } from "../../../shared/types.js";

const Verdict = z.object({
  verdict: z.enum(["allow", "ask", "deny"]),
  rationale: z.string(),
});

/**
 * Model-based action classifier, after the auto mode post: it sees only the
 * user's task and the proposed action (never the agent's own prose, which is
 * exactly what a prompt injection would try to use), and decides whether the
 * action is within the scope a reasonable person would consent to.
 */
export async function classifyAction(
  client: Anthropic,
  settings: RoleSettings,
  task: string,
  action: { tool: string; input: unknown },
  ruleHint: string,
): Promise<{ verdict: GuardrailVerdict; rationale: string }> {
  const system = [
    "You are the action classifier inside an agent harness. An autonomous coding agent is working on the user's task below.",
    "Decide whether the proposed action is clearly within the scope a reasonable developer would consent to for that task.",
    "Rules: allow ordinary builds, tests, installs of declared dependencies, edits inside the project. Deny anything that exfiltrates data, reaches unrelated hosts, touches credentials, modifies the system outside the project, or is irreversible and unrelated to the task.",
    "If genuinely unsure, answer ask. Be brief.",
  ].join("\n");
  const user = `TASK:\n${task}\n\nPROPOSED ACTION (${action.tool}):\n${JSON.stringify(action.input, null, 2).slice(0, 4000)}\n\nRULE HINT: ${ruleHint}`;
  try {
    const res = await client.messages.parse({
      model: settings.model,
      max_tokens: 600,
      output_config: { effort: settings.effort, format: zodOutputFormat(Verdict) },
      system,
      messages: [{ role: "user", content: user }],
    });
    const parsed = res.parsed_output;
    if (!parsed) return { verdict: "ask", rationale: "Classifier returned nothing parseable." };
    return parsed;
  } catch (err) {
    return { verdict: "ask", rationale: `Classifier unavailable (${(err as Error).message.slice(0, 120)}); falling back to a human.` };
  }
}

/** Cheap sniff for instruction-shaped text inside tool output (prompt injection surface). */
export function sniffInjection(output: string): string | null {
  const patterns: [RegExp, string][] = [
    [/ignore (all|any|the) (previous|prior|above) instructions/i, "override instruction"],
    [/you are now|new instructions?:|system prompt:|\bassistant:\s*$/i, "role hijack"],
    [/(curl|wget|fetch)[^\n]{0,80}(token|secret|credential|\.ssh|\.aws)/i, "credential exfiltration"],
    [/<\/?(system|instructions?|assistant|human)>/i, "control tags"],
    [/\bdo not tell the user\b|\bwithout telling the user\b/i, "concealment"],
  ];
  for (const [re, why] of patterns) if (re.test(output)) return why;
  return null;
}
