import { lstatSync, statSync, type BigIntStats } from "node:fs";

/**
 * Which file a path or descriptor is. Windows file ids exceed 2^53, so number stats can give two different
 * files one `ino`; every dev/ino comparison goes through here, with bigint stats.
 */
export type FileIdentity = Pick<BigIntStats, "dev" | "ino">;

/** The identity of `path` (through symlinks unless `follow` is false), or undefined when it does not exist. */
export function fileIdentity(path: string, follow = true): FileIdentity | undefined {
  return (follow ? statSync : lstatSync)(path, { bigint: true, throwIfNoEntry: false });
}

export function sameIdentity(
  left: FileIdentity | undefined,
  right: FileIdentity | undefined,
): boolean {
  return !!left && !!right && left.dev === right.dev && left.ino === right.ino;
}

/** Whether both paths exist and are one file (through symlinks unless `follow` is false). */
export function sameFile(left: string, right: string, follow = true): boolean {
  return sameIdentity(fileIdentity(left, follow), fileIdentity(right, follow));
}
