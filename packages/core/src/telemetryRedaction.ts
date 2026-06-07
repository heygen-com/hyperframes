const MAX_TELEMETRY_STRING_LENGTH = 240;

function truncateTelemetryString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function redactUrlQueryStrings(value: string): string {
  return value.replace(/\b(https?:\/\/[^\s?]+)\?[^\s]*/g, "$1?…");
}

function redactFilePaths(value: string): string {
  return value
    .replace(/file:\/\/[^\s'")]+/g, "[file-url]")
    .replace(/\/Users\/[^\s'")]+/g, "[path]")
    .replace(/\/(?:home|root|opt|app|workspace|srv|mnt)\/[^\s'")]+/g, "[path]")
    .replace(/\/(?:private\/)?(?:var|tmp)\/[^\s'")]+/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s'")]+/g, "[path]");
}

export function redactTelemetryString(
  value: string,
  maxLength = MAX_TELEMETRY_STRING_LENGTH,
): string {
  return truncateTelemetryString(redactFilePaths(redactUrlQueryStrings(value)), maxLength);
}
