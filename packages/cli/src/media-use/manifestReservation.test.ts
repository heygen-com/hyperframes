import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAtomicTempPath } from "@hyperframes/core/atomic-file";
import { allocateId, typeDirPath, withReservedFileSync } from "./lib/manifest.mjs";

// Studio's project history commits outside changes after a quiet time but skips atomic temp
// names (core isAtomicTempPath); a reserved-but-empty asset it commits comes back 0-byte on undo.
describe("media-use id reservation", () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "hf-media-reserve-"));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("shows only a temp name until the asset is written, and still holds the id", () => {
    const typeDir = typeDirPath(project, "bgm");
    const kept = withReservedFileSync(project, "bgm", ".wav", (reservation) => {
      expect(readdirSync(typeDir).filter((name) => !isAtomicTempPath(name))).toEqual([]);
      expect(allocateId(project, "bgm", ".wav").id).toBe("bgm_002");
      writeFileSync(reservation.fullPath, "completed asset");
      return reservation;
    });

    expect(kept.id).toBe("bgm_001");
    expect(readdirSync(typeDir).filter((name) => name.startsWith("bgm_001"))).toEqual([
      "bgm_001.wav",
    ]);
  });

  it("leaves nothing behind when the download fails partway", () => {
    expect(() =>
      withReservedFileSync(project, "image", ".jpg", (reservation) => {
        writeFileSync(reservation.fullPath, "partial");
        throw new Error("download failed");
      }),
    ).toThrow("download failed");
    expect(readdirSync(typeDirPath(project, "image"))).toEqual([]);
  });
});
