import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RESPONSE_RECORD_FILENAME,
  writeResponseRecord,
  type CaptureResponseRecord,
} from "./responseRecord.js";

describe("writeResponseRecord", () => {
  let extractedDir: string;
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-response-record-"));
    extractedDir = join(projectDir, "extracted");
    mkdirSync(extractedDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const readBack = (): CaptureResponseRecord =>
    JSON.parse(readFileSync(join(extractedDir, RESPONSE_RECORD_FILENAME), "utf-8"));

  it("records the status the server answered", () => {
    writeResponseRecord(extractedDir, { status: 404 });

    expect(readBack()).toEqual({ status: 404 });
  });

  it("keeps a missing status distinguishable from a status of zero and from success", () => {
    writeResponseRecord(extractedDir, { status: null });
    const record = readBack();

    // The three states a consumer must be able to separate: the server answered, the server
    // answered nothing, and — never — a falsy stand-in that reads as either.
    expect(record.status).toBeNull();
    expect(record.status).not.toBe(0);
    expect("status" in record).toBe(true);
  });
});
