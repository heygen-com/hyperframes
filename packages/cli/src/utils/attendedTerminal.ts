export function envFlagEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return Boolean(value && value !== "0" && value !== "false" && value !== "no");
}

/** A person can answer here: stdin and stdout are both terminals and this is not CI. */
export function isAttendedTerminal(): boolean {
  return !envFlagEnabled("CI") && process.stdin.isTTY === true && process.stdout.isTTY === true;
}
