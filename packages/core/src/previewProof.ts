import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
const NONCE_SHAPE = /^[0-9a-f]{32}$/;

/** The address and port a preview accepted a connection on, or that the CLI dialed. */
export interface PreviewEndpoint {
  address: string;
  port: number;
}

/** The token's folder: always in the user's own home, never a cache folder another user may share. */
export function previewTokenDir(): string {
  if (process.platform === "win32")
    return join(
      process.env["LOCALAPPDATA"]?.trim() || join(homedir(), "AppData", "Local"),
      "hyperframes",
    );
  return join(homedir(), ".local", "state", "hyperframes", "auth");
}

export const previewTokenPath = (dir = previewTokenDir()) => join(dir, "preview-token");

// ponytail: Windows relies on the user-only ACL of LOCALAPPDATA; check the ACL itself if that folder can be shared.
function isPrivateFile(fd: number): boolean {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1) return false;
  if (process.platform === "win32") return true;
  return stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0;
}

function readToken(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    if (!isPrivateFile(fd)) return null;
    const bytes = Buffer.alloc(65);
    const token = bytes.subarray(0, readSync(fd, bytes, 0, bytes.length, 0)).toString("utf-8");
    return TOKEN_SHAPE.test(token) ? token : null;
  } finally {
    closeSync(fd);
  }
}

/** This user's preview token, made on first use; null when the file is missing, unsafe or unreadable. */
export function previewToken(dir = previewTokenDir()): string | null {
  const path = previewTokenPath(dir);
  const existing = readToken(path);
  if (existing) return existing;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const flags =
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
    const fd = openSync(path, flags, 0o600);
    const token = randomBytes(32).toString("hex");
    try {
      writeSync(fd, token);
    } finally {
      closeSync(fd);
    }
    return token;
  } catch {
    // expected: the file exists (made by another process, or unsafe); only a safe one is used
    return readToken(path);
  }
}

export const newPreviewNonce = () => randomBytes(16).toString("hex");

/** Carries the CLI's challenge; a custom header also makes a browser preflight any cross-site probe. */
export const PREVIEW_NONCE_HEADER = "x-hyperframes-nonce";

const endpointKey = ({ address, port }: PreviewEndpoint) =>
  `${address.replace(/^\[(.*)\]$/, "$1").replace(/^::ffff:/i, "")}:${port}`;

/** The answer to `nonce` from the preview at `endpoint` serving `config`. It binds all three, so an answer
 * relayed from another preview, or with its config altered, does not check out. */
export function previewProof(
  nonce: unknown,
  endpoint: PreviewEndpoint,
  config: Record<string, unknown>,
  token = previewToken(),
): string | null {
  if (!token || typeof nonce !== "string" || !NONCE_SHAPE.test(nonce)) return null;
  const { proof: _proof, ...signed } = config;
  const fields = JSON.stringify(signed, Object.keys(signed).sort());
  return createHmac("sha256", token)
    .update(`${nonce}\n${endpointKey(endpoint)}\n${fields}`)
    .digest("hex");
}

/** Whether `config`, read from `endpoint` in answer to `nonce`, carries this user's proof. */
export function provesPreviewOwner(
  nonce: string,
  endpoint: PreviewEndpoint,
  config: Record<string, unknown>,
  token = previewToken(),
): boolean {
  const expected = previewProof(nonce, endpoint, config, token);
  const proof = config["proof"];
  if (!expected || typeof proof !== "string" || proof.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(proof));
}
