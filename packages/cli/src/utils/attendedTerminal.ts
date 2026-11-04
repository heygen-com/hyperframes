import { isAgentDriven } from "../telemetry/agent_runtime.js";

export function envFlagEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return Boolean(value && value !== "0" && value !== "false" && value !== "no");
}

export function isCI(): boolean {
  const value = process.env["CI"]?.trim().toLowerCase();
  return Boolean(value) && value !== "0" && value !== "false";
}

/** A person can answer here: stdin and stdout are both terminals and this is not CI. */
export function isAttendedTerminal(): boolean {
  return !isCI() && process.stdin.isTTY === true && process.stdout.isTTY === true;
}

let agentDetected: boolean | undefined;

/** Nobody is at the keyboard: no terminal, CI, a coding agent, or HYPERFRAMES_AGENT=1. Never prompt then. */
export function isUnattended(): boolean {
  if (!isAttendedTerminal() || process.env["HYPERFRAMES_AGENT"] === "1") return true;
  agentDetected ??= isAgentDriven();
  return agentDetected;
}
