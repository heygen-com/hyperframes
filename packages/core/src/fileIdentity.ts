import { statSync, type BigIntStats } from "node:fs";

/**
 * Which file a path is. Windows file ids exceed 2^53, so number stats can give two different
 * files one `ino`; every dev/ino comparison goes through here, with bigint stats.
 */
export type FileIdentity = Pick<BigIntStats, "dev" | "ino">;

const identity = (path: string): FileIdentity | undefined =>
  statSync(path, { bigint: true, throwIfNoEntry: false });

export function sameIdentity(
  left: FileIdentity | undefined,
  right: FileIdentity | undefined,
): boolean {
  return !!left && !!right && left.dev === right.dev && left.ino === right.ino;
}

/** Whether both paths exist and are one file, through symlinks. */
export function sameFile(left: string, right: string): boolean {
  return sameIdentity(identity(left), identity(right));
}
