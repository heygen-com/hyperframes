/**
 * Detect whether we're running from source (monorepo dev) or from the built bundle.
 * In dev: files are .ts (running via tsx). In production: bundled into .js by tsup.
 */
export function isDevMode(): boolean {
  return new URL(import.meta.url).pathname.endsWith(".ts");
}
