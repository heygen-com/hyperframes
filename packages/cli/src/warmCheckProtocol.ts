import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

export const WARM_IDLE_MS = 5 * 60_000;
export const HANDSHAKE_TIMEOUT_MS = 2_000;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export const Frame = {
  Stdout: 1,
  Stderr: 2,
  Exit: 3,
  Declined: 4,
  Signal: 5,
  Request: 6,
  Hello: 7,
  Proof: 8,
} as const;
export type Frame = (typeof Frame)[keyof typeof Frame];

export interface WarmRequest {
  argv: string[];
  script: string;
  cwd: string;
  envDigest: string;
  proof: string;
}

export interface WarmEndpoint {
  address: string;
  token: string;
}

const VOLATILE_ENV = new Set(["_", "PWD", "OLDPWD"]);

function privateToMe(path: string, kind: "dir" | "file"): boolean {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink()) return false;
  if (kind === "dir" ? !stat.isDirectory() : !stat.isFile()) return false;
  if (process.platform === "win32") return true;
  return stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0;
}

export function warmCheckDirectory(env = process.env): string | undefined {
  const dir =
    process.platform === "win32"
      ? join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "hyperframes", "warm")
      : env.XDG_RUNTIME_DIR
        ? join(env.XDG_RUNTIME_DIR, "hyperframes-warm")
        : join(homedir(), ".cache", "hyperframes", "warm");
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    return undefined;
  }
  return privateToMe(dir, "dir") ? dir : undefined;
}

function readToken(dir: string): string | undefined {
  const path = join(dir, "token");
  try {
    writeFileSync(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch {}
  if (!privateToMe(path, "file")) return undefined;
  const token = readFileSync(path, "utf8");
  return /^[0-9a-f]{64}$/.test(token) ? token : undefined;
}

export function keyed(token: string, ...parts: string[]): string {
  return createHmac("sha256", token).update(parts.join("\0")).digest("hex");
}

export function sameProof(expected: string, received: unknown): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(typeof received === "string" ? received : "");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function envDigest(token: string, env: Record<string, string | undefined>): string {
  const entries = Object.keys(env)
    .filter((key) => !VOLATILE_ENV.has(key) && env[key] !== undefined)
    .sort()
    .map((key) => `${key}=${env[key]}`);
  return keyed(token, "env", ...entries);
}

export function warmCheckEndpoint(env = process.env): WarmEndpoint | undefined {
  const dir = warmCheckDirectory(env);
  const token = dir && readToken(dir);
  if (!dir || !token) return undefined;
  const self = statSync(fileURLToPath(import.meta.url));
  const build = createHash("sha256")
    .update(
      [import.meta.url, self.size, self.mtimeMs, process.execPath, process.version].join("\0"),
    )
    .digest("hex")
    .slice(0, 12);
  const address =
    process.platform === "win32"
      ? `\\\\.\\pipe\\hyperframes-warm-${keyed(token, "pipe", build).slice(0, 32)}`
      : join(dir, `${build}.sock`);
  return { address, token };
}

export function encodeFrame(type: Frame, data: string | Uint8Array): Buffer {
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  const head = Buffer.alloc(5);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

export function frameReader(
  onFrame: (type: Frame, body: Buffer) => void,
): (chunk: Buffer) => boolean {
  let pending = Buffer.alloc(0);
  let refused = false;
  return (chunk) => {
    if (refused) return false;
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 5) {
      const length = pending.readUInt32BE(1);
      if (length > MAX_FRAME_BYTES) return !(refused = true);
      if (pending.length < 5 + length) return true;
      onFrame(pending.readUInt8(0) as Frame, pending.subarray(5, 5 + length));
      pending = pending.subarray(5 + length);
    }
    return true;
  };
}

export function frameForwarder(
  socket: { write(frame: Buffer): unknown },
  type: Frame,
): typeof process.stdout.write {
  const sink = new Writable({
    write(chunk: Buffer, _encoding, next) {
      socket.write(encodeFrame(type, chunk));
      next();
    },
  });
  return sink.write.bind(sink) as typeof process.stdout.write;
}
