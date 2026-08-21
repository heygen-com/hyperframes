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
import { ArtifactTransaction } from "./artifactTransaction.js";

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

  it("atomically replaces a file only after validation", () => {
    const dir = tempDir();
    const destination = join(dir, "render.mp4");
    writeFileSync(destination, "existing");
    const transaction = new ArtifactTransaction(destination, "file");
    writeFileSync(transaction.stagingPath, "new-render");

    transaction.commit();

    expect(readFileSync(destination, "utf8")).toBe("new-render");
    expect(existsSync(transaction.stagingPath)).toBe(false);
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("leaves an existing file byte-identical when validation fails", () => {
    const dir = tempDir();
    const destination = join(dir, "render.gif");
    const existing = Buffer.from([0, 1, 2, 3, 255]);
    writeFileSync(destination, existing);
    const transaction = new ArtifactTransaction(destination, "file");
    writeFileSync(transaction.stagingPath, "");

    expect(() => transaction.commit()).toThrow("not a non-empty file");
    transaction.rollback();

    expect(readFileSync(destination)).toEqual(existing);
    expect(existsSync(transaction.stagingPath)).toBe(false);
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("keeps the existing file addressable when atomic promotion fails", () => {
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

    expect(() => transaction.commit()).toThrow("injected replacement failure");
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

  it("promotes a validated PNG sequence as one directory artifact", () => {
    const dir = tempDir();
    const destination = join(dir, "frames");
    mkdirSync(destination);
    writeFileSync(join(destination, "frame_000001.png"), "old");
    const transaction = new ArtifactTransaction(destination, "directory");
    mkdirSync(transaction.stagingPath);
    writeFileSync(join(transaction.stagingPath, "frame_000001.png"), "png-1");
    writeFileSync(join(transaction.stagingPath, "frame_000002.png"), "png-2");

    transaction.commit();

    expect(readdirSync(destination).sort()).toEqual(["frame_000001.png", "frame_000002.png"]);
    expect(readFileSync(join(destination, "frame_000001.png"), "utf8")).toBe("png-1");
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("restores the previous PNG sequence when directory promotion fails", () => {
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

    expect(() => transaction.commit()).toThrow("injected directory promotion failure");

    expect(readFileSync(join(destination, "frame_000001.png"), "utf8")).toBe("existing-frame");
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("does not delete a concurrent PNG sequence published during recovery", () => {
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
          concurrentTransaction.commit();
          expect(readFileSync(join(destination, "frame_000001.png"), "utf8")).toBe(
            "concurrent-frame",
          );
          throw new Error("injected first promotion failure");
        }
        renamePathSync(source, target);
      },
      rmSync,
    });
    mkdirSync(firstTransaction.stagingPath);
    writeFileSync(join(firstTransaction.stagingPath, "frame_000001.png"), "first-frame");

    expect(() => firstTransaction.commit()).toThrow("injected first promotion failure");

    expect(readFileSync(join(destination, "frame_000001.png"), "utf8")).toBe("concurrent-frame");
    expect(transactionDirectories(dir)).toEqual([]);
  });

  it("rejects an empty PNG sequence and preserves the existing directory", () => {
    const dir = tempDir();
    const destination = join(dir, "frames");
    mkdirSync(destination);
    writeFileSync(join(destination, "frame_000001.png"), "existing-frame");
    const transaction = new ArtifactTransaction(destination, "directory");
    mkdirSync(transaction.stagingPath);

    expect(() => transaction.commit()).toThrow("directory is empty");
    transaction.rollback();

    expect(readFileSync(join(destination, "frame_000001.png"), "utf8")).toBe("existing-frame");
    expect(transactionDirectories(dir)).toEqual([]);
  });
});
