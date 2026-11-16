import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { namedCacheDir } from "./cacheDir.js";

const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
const NONCE_SHAPE = /^[0-9a-f]{32}$/;

/** Where this user's preview records live: sessions, logs and the preview token. */
export function previewStateHome(): string {
  const localAppData =
    process.platform === "win32" ? process.env["LOCALAPPDATA"]?.trim() || undefined : undefined;
  return (
    namedCacheDir("state") ||
    process.env["XDG_STATE_HOME"] ||
    localAppData ||
    join(homedir(), ".local", "state")
  );
}

export const previewTokenPath = (stateHome = previewStateHome()) =>
  join(stateHome, "hyperframes", "preview-token");

function readToken(path: string): string | null {
  try {
    const token = readFileSync(path, "utf-8").trim();
    return TOKEN_SHAPE.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** This user's preview token, made on first use in a file only this user can read; null when it cannot be had. */
export function previewToken(stateHome = previewStateHome()): string | null {
  const path = previewTokenPath(stateHome);
  const existing = readToken(path);
  if (existing) return existing;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const token = randomBytes(32).toString("hex");
    try {
      writeSync(fd, token);
    } finally {
      closeSync(fd);
    }
    return token;
  } catch {
    // expected: another process made the file first; its token is the one to use
    return readToken(path);
  }
}

export const newPreviewNonce = () => randomBytes(16).toString("hex");

/** A preview's answer to `nonce`: only a process that can read this user's token can give it. */
export function previewProof(nonce: unknown, token = previewToken()): string | null {
  if (!token || typeof nonce !== "string" || !NONCE_SHAPE.test(nonce)) return null;
  return createHmac("sha256", token).update(nonce).digest("hex");
}

export function provesPreviewOwner(nonce: string, proof: unknown, token = previewToken()): boolean {
  const expected = previewProof(nonce, token);
  if (!expected || typeof proof !== "string" || proof.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(proof));
}
