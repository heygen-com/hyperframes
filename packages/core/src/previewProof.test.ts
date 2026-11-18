import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  newPreviewNonce,
  previewProof,
  previewToken,
  previewTokenDir,
  previewTokenPath,
  provesPreviewOwner,
} from "./previewProof";

const KNOWN = "a".repeat(64);
const posix = process.platform !== "win32";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-preview-proof-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const endpoint = { address: "127.0.0.1", port: 3002 };
const config = { isHyperframes: true, projectDir: "/tmp/video", pid: 7 };

describe("preview token", () => {
  it("is made once in a file only this user can read, and kept", () => {
    const dir = tempDir();
    const token = previewToken(dir);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(previewToken(dir)).toBe(token);
    if (posix) expect(statSync(previewTokenPath(dir)).mode & 0o077).toBe(0);
  });

  it("lives in the user's home, not in a cache folder that may be shared", () => {
    const cache = tempDir();
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", cache);
    onTestFinished(() => vi.unstubAllEnvs());

    expect(previewTokenDir().startsWith(cache)).toBe(false);
  });

  it.runIf(posix)(
    "is refused, never adopted, when the file is a link or others can read it",
    () => {
      const known = join(tempDir(), "known");
      writeFileSync(known, KNOWN, { mode: 0o644 });
      chmodSync(known, 0o644);
      const linked = tempDir();
      symlinkSync(known, previewTokenPath(linked));
      const readable = tempDir();
      writeFileSync(previewTokenPath(readable), KNOWN, { mode: 0o644 });
      chmodSync(previewTokenPath(readable), 0o644);
      const hardLinked = tempDir();
      const privateKnown = join(tempDir(), "private");
      writeFileSync(privateKnown, KNOWN, { mode: 0o600 });
      linkSync(privateKnown, previewTokenPath(hardLinked));

      for (const dir of [linked, readable, hardLinked]) expect(previewToken(dir)).toBeNull();
    },
  );
});

describe("preview proof", () => {
  it("checks out only for the same nonce, endpoint, config and token", () => {
    const token = previewToken(tempDir())!;
    const nonce = newPreviewNonce();
    const answered = { ...config, proof: previewProof(nonce, endpoint, config, token) };

    expect(provesPreviewOwner(nonce, endpoint, answered, token)).toBe(true);
    expect(
      provesPreviewOwner(nonce, { address: "::ffff:127.0.0.1", port: 3002 }, answered, token),
    ).toBe(true);
    expect(provesPreviewOwner(newPreviewNonce(), endpoint, answered, token)).toBe(false);
    expect(provesPreviewOwner(nonce, { ...endpoint, port: 3003 }, answered, token)).toBe(false);
    expect(provesPreviewOwner(nonce, { ...endpoint, address: "::1" }, answered, token)).toBe(false);
    expect(provesPreviewOwner(nonce, endpoint, { ...answered, projectDir: "/forged" }, token)).toBe(
      false,
    );
    expect(provesPreviewOwner(nonce, endpoint, answered, previewToken(tempDir())!)).toBe(false);
    for (const proof of [undefined, "", "0".repeat(64), `${answered.proof}0`]) {
      expect(provesPreviewOwner(nonce, endpoint, { ...config, proof }, token)).toBe(false);
    }
  });

  it("answers no malformed challenge", () => {
    const token = previewToken(tempDir())!;
    for (const nonce of [null, "", "short", "../x", "G".repeat(32)]) {
      expect(previewProof(nonce, endpoint, config, token)).toBeNull();
    }
  });
});
