/**
 * Shared binary-unit byte formatter for the build/verify scripts.
 *
 * The Lambda ZIP-size budget is in mebibytes (Lambda's 250 MB / 248 MiB
 * gate is binary, not decimal), so logs and CI failure messages use
 * KiB / MiB / GiB. This is intentionally a different unit system from
 * `packages/cli/src/ui/format.ts`'s `formatBytes` (KB / MB, decimal) —
 * don't conflate them.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
