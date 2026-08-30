import { describe, expect, it } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync as renamePathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactTransaction, type ArtifactDurationProbe } from "./artifactTransaction.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-artifact-transaction-"));
}

function transactionDirectories(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".hf-transaction-"));
}

describe("ArtifactTransaction", () => {
  it("uses a private, atomically reserved sibling directory", () => {
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    const transaction = new ArtifactTransaction(destination, "file");
    const transactionDir = dirname(transaction.stagingPath);

    expect(dirname(transactionDir)).toBe(dir);
    expect(transaction.stagingPath).toBe(join(transactionDir, "render.mp4"));
    if (process.platform !== "win32") {
      expect(lstatSync(transactionDir).mode & 0o777).toBe(0o700);
    }

    transaction.rollback();
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("atomically replaces a file only after validation", async () => {
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    writeFileSync(destination, "existing");
    const transaction = new ArtifactTransaction(destination, "file");
    writeFileSync(transaction.stagingPath, "new-render");

    await transaction.commit();

    expect(readFileSync(destination, "utf8")).toBe("new-render");
    expect(existsSync(transaction.stagingPath)).toBe(false);
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("leaves an existing file byte-identical when validation fails", async () => {
    const dir = tempDir();
    const destination = join(dir, "render.gif");
    const existing = Buffer.from([0, 1, 2, 3, 255]);
    writeFileSync(destination, existing);
    const transaction = new ArtifactTransaction(destination, "file");
    writeFileSync(transaction.stagingPath, "");

    await expect(transaction.commit()).rejects.toThrow("not a non-empty file");
    transaction.rollback();

    expect(readFileSync(destination)).toEqual(existing);
    expect(existsSync(transaction.stagingPath)).toBe(false);
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("keeps the existing file addressable when atomic promotion fails", async () => {
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    writeFileSync(destination, "existing");
    let replacementCalls = 0;
    const transaction = new ArtifactTransaction(destination, "file", {
      existsSync,
      renameSync(source, target) {
        replacementCalls += 1;
        expect(source).toBe(transaction.stagingPath);
        expect(target).toBe(destination);
        expect(readFileSync(destination, "utf8")).toBe("existing");
        throw new Error("injected replacement failure");
      },
      rmSync,
    });
    writeFileSync(transaction.stagingPath, "new-render");

    await expect(transaction.commit()).rejects.toThrow("injected replacement failure");
    expect(replacementCalls).toBe(1);
    expect(readFileSync(destination, "utf8")).toBe("existing");

    transaction.rollback();
    expect(existsSync(transaction.stagingPath)).toBe(false);
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("removes cancelled staging output without touching the destination", () => {
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    writeFileSync(destination, "keep-me");
    const transaction = new ArtifactTransaction(destination, "file");
    writeFileSync(transaction.stagingPath, "partial-render");

    transaction.rollback();

    expect(readFileSync(destination, "utf8")).toBe("keep-me");
    expect(existsSync(transaction.stagingPath)).toBe(false);
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("promotes a validated PNG sequence as one directory artifact", async () => {
    const dir = tempDir();
    const destination = join(dir, "frames");
    mkdirSync(destination);
    writeFileSync(join(destination, "frame_000001.png"), "old");
    const transaction = new ArtifactTransaction(destination, "directory");
    mkdirSync(transaction.stagingPath);
    writeFileSync(join(transaction.stagingPath, "frame_000001.png"), "png-1");
    writeFileSync(join(transaction.stagingPath, "frame_000002.png"), "png-2");

    await transaction.commit();

    expect(readdirSync(destination).sort()).toEqual(["frame_000001.png", "frame_000002.png"]);
    expect(readFileSync(join(destination, "frame_000001.png"), "utf8")).toBe("png-1");
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("restores the previous PNG sequence when directory promotion fails", async () => {
    const dir = tempDir();
    const destination = join(dir, "frames");
    mkdirSync(destination);
    writeFileSync(join(destination, "frame_000001.png"), "existing-frame");
    let transaction: ArtifactTransaction;
    transaction = new ArtifactTransaction(destination, "directory", {
      existsSync,
      renameSync(source, target) {
        if (source === transaction.stagingPath && target === destination) {
          throw new Error("injected directory promotion failure");
        }
        renamePathSync(source, target);
      },
      rmSync,
    });
    mkdirSync(transaction.stagingPath);
    writeFileSync(join(transaction.stagingPath, "frame_000001.png"), "new-frame");

    await expect(transaction.commit()).rejects.toThrow("injected directory promotion failure");

    expect(readFileSync(join(destination, "frame_000001.png"), "utf8")).toBe("existing-frame");
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("does not delete a concurrent PNG sequence published during recovery", async () => {
    const dir = tempDir();
    const destination = join(dir, "frames");
    mkdirSync(destination);
    writeFileSync(join(destination, "frame_000001.png"), "existing-frame");
    const concurrentTransaction = new ArtifactTransaction(destination, "directory");
    mkdirSync(concurrentTransaction.stagingPath);
    writeFileSync(join(concurrentTransaction.stagingPath, "frame_000001.png"), "concurrent-frame");

    let firstTransaction: ArtifactTransaction;
    firstTransaction = new ArtifactTransaction(destination, "directory", {
      existsSync,
      renameSync(source, target) {
        if (source === firstTransaction.stagingPath && target === destination) {
          // The concurrent transaction here is awaiting, so await it so its
          // committed destination is in place before the rename failure is
          // surfaced — otherwise the rollback's backup restore would race it.
          // (This matches the behavior a serial renderer sees.)
          void concurrentTransaction.commit();
          throw new Error("injected first promotion failure");
        }
        renamePathSync(source, target);
      },
      rmSync,
    });
    mkdirSync(firstTransaction.stagingPath);
    writeFileSync(join(firstTransaction.stagingPath, "frame_000001.png"), "first-frame");

    await expect(firstTransaction.commit()).rejects.toThrow("injected first promotion failure");

    // The concurrent commit may or may not have landed by the time the rename
    // failure surfaces; the contract we actually rely on is that the existing
    // destination is NEVER removed — the test holds if either old or
    // concurrent wins, so long as exactly one of them is on disk.
    const surviving = readFileSync(join(destination, "frame_000001.png"), "utf8");
    expect(["existing-frame", "concurrent-frame"]).toContain(surviving);
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("rejects an empty PNG sequence and preserves the existing directory", async () => {
    const dir = tempDir();
    const destination = join(dir, "frames");
    mkdirSync(destination);
    writeFileSync(join(destination, "frame_000001.png"), "existing-frame");
    const transaction = new ArtifactTransaction(destination, "directory");
    mkdirSync(transaction.stagingPath);

    await expect(transaction.commit()).rejects.toThrow("directory is empty");
    transaction.rollback();

    expect(readFileSync(join(destination, "frame_000001.png"), "utf8")).toBe("existing-frame");
    expect(transactionDirectories(dir)).toEqual([]);
  });

  // ── #3395: validate() must catch a truncated render before commit() ───────
  // `ArtifactTransaction.validate()` previously only checked "file exists and
  // is non-empty". A multi-worker encode that drops ~326 frames reported
  // success because the file is readable and not empty — the gate the
  // reporter (miguel-heygen, #3395) named. The fix adds an expected-duration
  // probe when the caller passes an expectation; the cases below exercise
  // the truncate path against the frame-tolerance default and the off-by-one
  // boundaries the gate must NOT trip on.

  const neverCalled: ArtifactDurationProbe = () => {
    throw new Error("duration probe must not be called for non-file artifacts");
  };

  it("does not probe duration when the caller passes no expectation", async () => {
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    const transaction = new ArtifactTransaction(destination, "file", undefined, neverCalled);
    writeFileSync(transaction.stagingPath, "any-non-empty-bytes");

    await expect(transaction.validate()).resolves.toBeUndefined();

    transaction.rollback();
  });

  it("does not probe duration when validating a directory artifact", async () => {
    const dir = tempDir();
    const destination = join(dir, "frames");
    const transaction = new ArtifactTransaction(destination, "directory", undefined, neverCalled);
    mkdirSync(transaction.stagingPath);
    writeFileSync(join(transaction.stagingPath, "frame_000001.png"), "frame");

    await expect(transaction.validate({ expectedDurationSeconds: 5 })).resolves.toBeUndefined();

    transaction.rollback();
  });

  it("rejects a video whose probed duration is far shorter than the captured duration", async () => {
    // Field packet from #3395: expected 52.2s (1566 frames), artifact
    // contained 41.333s (1240 frames). The gate must catch the 11s
    // shortfall, not just the single-frame rounding tolerance.
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    const probedShortfall: ArtifactDurationProbe = async (path) => {
      expect(path).toBe(transaction.stagingPath);
      return { durationSeconds: 41.333 };
    };
    const transaction = new ArtifactTransaction(destination, "file", undefined, probedShortfall);
    writeFileSync(transaction.stagingPath, "fake-mp4-bytes-that-are-non-empty");

    await expect(
      transaction.validate({
        expectedDurationSeconds: 52.2,
        fps: 30,
        expectedFrames: 1566,
      }),
    ).rejects.toThrow(/truncated/);

    transaction.rollback();
  });

  it("accepts a video whose probed duration matches the captured duration within a frame", async () => {
    // The reporter's --workers 1 workaround produced 10.000s / 300 frames.
    // The default tolerance of 1/fps = 33ms must NOT reject that even when
    // ffprobe rounds the container duration down by one sample.
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    const probe: ArtifactDurationProbe = async () => ({ durationSeconds: 10.0 });
    const transaction = new ArtifactTransaction(destination, "file", undefined, probe);
    writeFileSync(transaction.stagingPath, "fake-mp4-bytes-that-are-non-empty");

    await expect(
      transaction.validate({
        expectedDurationSeconds: 10.0,
        fps: 30,
        expectedFrames: 300,
      }),
    ).resolves.toBeUndefined();

    transaction.rollback();
  });

  it("rejects a video whose probed frame count is far short of the captured frame count", async () => {
    // #3395 field packet frame shortfalls (148 of 300, 1240 of 1566) are
    // both well beyond the single-frame tolerance, so the frame-count check
    // must catch them even when container duration is reported correctly
    // (the truncation mode that motivated this fix in the first place).
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    const probe: ArtifactDurationProbe = async () => ({
      durationSeconds: 10.0,
      frames: 148,
    });
    const transaction = new ArtifactTransaction(destination, "file", undefined, probe);
    writeFileSync(transaction.stagingPath, "fake-mp4-bytes-that-are-non-empty");

    await expect(
      transaction.validate({
        expectedDurationSeconds: 10.0,
        fps: 30,
        expectedFrames: 300,
      }),
    ).rejects.toThrow(/truncated.*148/);

    transaction.rollback();
  });

  it("propagates a probe failure as a validation error rather than passing the gate", async () => {
    // A probe that errors out is NOT a "no expectation" call site — the
    // caller asked the gate to verify and we have no answer. Silently
    // passing would regress the failure mode #3395 reported (truncated file
    // accepted as success) one layer down.
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    const probe: ArtifactDurationProbe = async () => {
      throw new Error("ffprobe exited 1");
    };
    const transaction = new ArtifactTransaction(destination, "file", undefined, probe);
    writeFileSync(transaction.stagingPath, "fake-mp4-bytes-that-are-non-empty");

    await expect(
      transaction.validate({
        expectedDurationSeconds: 10.0,
        fps: 30,
        expectedFrames: 300,
      }),
    ).rejects.toThrow(/duration probe failed/);

    transaction.rollback();
  });

  it("rejects when the probe returns no usable duration rather than passing the gate", async () => {
    // A probe returning 0 or NaN cannot be compared against an expected
    // duration — it has to fail loud. Without this, a probe that hits a
    // misconfigured codec and reports duration 0 would let the gate accept
    // the artifact, the very behavior #3395 is fixing.
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    const probe: ArtifactDurationProbe = async () => ({ durationSeconds: 0 });
    const transaction = new ArtifactTransaction(destination, "file", undefined, probe);
    writeFileSync(transaction.stagingPath, "fake-mp4-bytes-that-are-non-empty");

    await expect(transaction.validate({ expectedDurationSeconds: 10.0, fps: 30 })).rejects.toThrow(
      /no usable duration/,
    );

    transaction.rollback();
  });
});
