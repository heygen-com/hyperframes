const MACH_SERVICE_DENIED = /bootstrap_check_in\b[^\n]*Permission denied/;

/** A process sandbox (an agent's macOS seatbelt) refused Chrome its mach service, so no browser starts here. */
export function sandboxDeniedRemediation(errorMessage: string): string | undefined {
  if (!MACH_SERVICE_DENIED.test(errorMessage)) return undefined;
  return [
    "The browser can't start inside this sandbox: macOS refused Chrome's mach service (bootstrap_check_in: Permission denied).",
    "Rerun this command with escalation, outside the sandbox.",
  ].join("\n");
}
