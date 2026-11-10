import { isAgentDriven } from "../telemetry/agent_runtime.js";

export function envFlagEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return Boolean(value && value !== "0" && value !== "false" && value !== "no");
}

export function isCI(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env["CI"]?.trim().toLowerCase();
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

/** No browser opens for a sign-in here: SSH, a cloud container, BROWSER=none, or no terminal outside an agent on this machine. */
export function isRemoteOrHeadless(): boolean {
  const remoteEnvironment = [
    "CODESPACES",
    "GITHUB_CODESPACES",
    "REMOTE_CONTAINERS",
    "GITPOD_WORKSPACE_ID",
    "container",
  ].some(envFlagEnabled);
  return Boolean(
    process.env["SSH_CONNECTION"] ||
    process.env["SSH_CLIENT"] ||
    process.env["SSH_TTY"] ||
    process.env["BROWSER"] === "none" ||
    process.env["HF_NO_BROWSER"] === "1" ||
    remoteEnvironment ||
    (process.stdout.isTTY !== true && !agentShellOnThisMachine()),
  );
}

function agentShellOnThisMachine(): boolean {
  return !isCI() && isAgentDriven();
}
