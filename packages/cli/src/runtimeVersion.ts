const MINIMUM_NODE_MAJOR = 22;

export function runtimeVersionError(version: string): string | null {
  const major = Number.parseInt(version.split(".", 1)[0] ?? "", 10);
  if (Number.isFinite(major) && major >= MINIMUM_NODE_MAJOR) return null;
  return `HyperFrames requires Node.js >= ${MINIMUM_NODE_MAJOR} (current: ${version}). Switch Node versions and retry.`;
}
