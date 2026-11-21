const MINIMUM_NODE_FOR_UNDICI_8 = { major: 22, minor: 19 };

export function runtimeVersionError(version: string): string | null {
  const [major = Number.NaN, minor = Number.NaN] = version.split(".").map(Number);
  const { major: needMajor, minor: needMinor } = MINIMUM_NODE_FOR_UNDICI_8;
  if (major > needMajor || (major === needMajor && minor >= needMinor)) return null;
  return `HyperFrames requires Node.js >= ${needMajor}.${needMinor} (current: ${version}). Switch Node versions and retry.`;
}

export function runtimeVersionJson(message: string, argv: readonly string[]): string | null {
  if (!argv.includes("--json")) return null;
  return JSON.stringify({ ok: false, error: { code: "node_version_unsupported", message } });
}
