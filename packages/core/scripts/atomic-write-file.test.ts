import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { atomicWriteFileSync } from "./atomic-write-file.js";

type FileSystemError = Error & { syscall: string; path: string; dest: string };

function captureFileSystemError(operation: () => void): FileSystemError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error as FileSystemError;
  }
  assert.fail("expected filesystem operation to fail");
}

test("atomicWriteFileSync replaces the destination with complete contents", () => {
  const directory = mkdtempSync(join(tmpdir(), "hyperframes-atomic-write-"));
  const destination = join(directory, "artifact.js");

  try {
    writeFileSync(destination, "old contents", "utf8");

    atomicWriteFileSync(destination, "new contents", "utf8");

    assert.equal(readFileSync(destination, "utf8"), "new contents");
    assert.deepEqual(readdirSync(directory), ["artifact.js"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("atomicWriteFileSync removes its temporary file when publication fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "hyperframes-atomic-write-failure-"));
  const destination = join(directory, "artifact.js");

  try {
    mkdirSync(destination);

    const firstFailure = captureFileSystemError(() =>
      atomicWriteFileSync(destination, "first contents", "utf8"),
    );
    const secondFailure = captureFileSystemError(() =>
      atomicWriteFileSync(destination, "second contents", "utf8"),
    );

    assert.equal(firstFailure.syscall, "rename");
    assert.equal(secondFailure.syscall, "rename");
    assert.equal(dirname(firstFailure.path), directory);
    assert.equal(dirname(secondFailure.path), directory);
    assert.equal(firstFailure.dest, destination);
    assert.equal(secondFailure.dest, destination);
    assert.notEqual(firstFailure.path, secondFailure.path);
    assert.deepEqual(readdirSync(directory), ["artifact.js"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
