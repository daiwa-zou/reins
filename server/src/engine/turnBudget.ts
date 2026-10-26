/**
 * Turn-budget awareness for phases that must end with a structured tool
 * (report_evaluation, finish, propose_contract, review_contract). Agents are
 * blind to the turn cap: an evaluator with many criteria will happily spend
 * its whole budget checking and be cut off mid-check, and the phase then ends
 * with nothing to hand on. Both engines share these messages so the Stage
 * reads the same on either.
 */

/** Once this many turns (or fewer) remain in a phase, every model call is preceded by a nudge to report now. */
export const TURNS_REMAINING_NUDGE_AT = 5;

/** The operator-authority message injected before a model call when `remaining` turns are left. */
export function turnsRemainingNudge(remaining: number, terminal: string[]): string {
  const tool = terminal.join(" or ");
  const n = remaining === 1 ? "This is your last turn in this phase." : `You have ${remaining} turns left in this phase, including this one.`;
  return `Turn budget: ${n} Call ${tool} now with what you have verified so far. Do not start another check. Anything you could not verify is reported as unverified (pass false, unverified true), not as failed, with a note of what was left unchecked.`;
}

/** The message for the one extra call made at the cap, where the terminal tool is the only one offered. */
export function forcedTerminalMessage(maxTurns: number, terminal: string[]): string {
  const tool = terminal.join(" or ");
  return `Turn budget exhausted: the ${maxTurns}-turn cap for this phase has been reached and no other tool is available. Call ${tool} now from what you already know. Report what you verified as verified, and everything else as unverified (pass false, unverified true); do not guess.`;
}

/** The warn note shown on the Stage when a nudge is delivered. */
export function turnsRemainingNote(role: string, remaining: number, terminal: string[]): string {
  return `The ${role} has ${remaining} turn${remaining === 1 ? "" : "s"} left in this phase and has been told to call ${terminal.join(" or ")} now with what it has.`;
}

/** The warn note shown on the Stage when the forced call is made. */
export function forcedCallNote(role: string, maxTurns: number, terminal: string[]): string {
  return `The ${role} reached the ${maxTurns}-turn cap without calling ${terminal.join(" or ")}; making one final call that offers only that tool.`;
}
