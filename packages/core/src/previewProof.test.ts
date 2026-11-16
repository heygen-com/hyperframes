import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  newPreviewNonce,
  previewProof,
  previewToken,
  previewTokenPath,
  provesPreviewOwner,
} from "./previewProof";

function stateHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-preview-proof-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("preview proof", () => {
  it("makes one token per user, in a file only that user can read, and keeps it", () => {
    const home = stateHome();
    const token = previewToken(home);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(previewToken(home)).toBe(token);
    if (process.platform !== "win32") expect(statSync(previewTokenPath(home)).mode & 0o077).toBe(0);
  });

  it("accepts the answer made with the token and refuses any other", () => {
    const token = previewToken(stateHome())!;
    const nonce = newPreviewNonce();
    const proof = previewProof(nonce, token);

    expect(provesPreviewOwner(nonce, proof, token)).toBe(true);
    expect(provesPreviewOwner(newPreviewNonce(), proof, token)).toBe(false);
    expect(provesPreviewOwner(nonce, previewProof(nonce, previewToken(stateHome())), token)).toBe(
      false,
    );
    for (const forged of [undefined, "", "0".repeat(64), proof + "0"]) {
      expect(provesPreviewOwner(nonce, forged, token)).toBe(false);
    }
  });

  it("answers no malformed challenge", () => {
    const token = previewToken(stateHome())!;
    for (const nonce of [null, "", "short", "../x", "G".repeat(32)]) {
      expect(previewProof(nonce, token)).toBeNull();
    }
  });
});
