/**
 * True when `v` is a strict semver-shaped string. Registry-supplied versions
 * flow into commands that are displayed AND executed (the `upgrade` command and
 * the background auto-installer both run them), so a poisoned `latest` carrying
 * shell metacharacters must never reach them. This is enforced at the registry
 * boundary in `checkForUpdate` — an unsafe `data.version` is never cached — so
 * every consumer (notice, upgrade, background auto-install, and any future one)
 * is covered by this single gate; the per-consumer checks are defense in depth.
 *
 * Lives in its own module (rather than updateCheck.ts) so utils/projectPin.ts
 * can depend on it without a projectPin.ts <-> updateCheck.ts import cycle —
 * updateCheck.ts imports readPinnedHyperframesVersions from projectPin.ts.
 */
export function isSafeVersion(v: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v);
}
