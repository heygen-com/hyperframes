/**
 * Unit tests for the distributed format banlist.
 *
 * `plan()` refuses one configuration up front:
 *   - mp4 + HDR (`hdrMode === "force-hdr"`) — chunked HDR pre-extract +
 *     HDR signaling re-apply on the assembled file is not implemented.
 *
 * The banlist must trip BEFORE any other work runs (file server, browser,
 * ffprobe) — otherwise a banned config can leak a partial planDir on disk.
 * The HDR case asserts `existsSync(planDir)` is `false` after the throw
 * to pin the early-exit contract.
 *
 * WebM was previously refused here; v0.7+ supports it via closed-GOP
 * concat-copy. The "accepts webm" tests below pin the contract that
 * `rejectUnsupportedDistributedFormat` no longer trips on webm.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED,
  FormatNotSupportedInDistributedError,
  plan,
  rejectUnsupportedDistributedFormat,
  type DistributedRenderConfig,
} from "./plan.js";

const FIXTURE_HTML = `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1">hi</div>
</body></html>`;

let runRoot: string;
let projectDir: string;

beforeAll(() => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-plan-format-ban-"));
  projectDir = join(runRoot, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "index.html"), FIXTURE_HTML, "utf-8");
});

afterAll(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

describe("rejectUnsupportedDistributedFormat (pure)", () => {
  it("accepts the v1-supported formats (mp4 / mov / png-sequence / webm)", () => {
    expect(() => rejectUnsupportedDistributedFormat({ format: "mp4" })).not.toThrow();
    expect(() => rejectUnsupportedDistributedFormat({ format: "mov" })).not.toThrow();
    expect(() => rejectUnsupportedDistributedFormat({ format: "png-sequence" })).not.toThrow();
    expect(() => rejectUnsupportedDistributedFormat({ format: "webm" })).not.toThrow();
    expect(() =>
      rejectUnsupportedDistributedFormat({ format: "mp4", hdrMode: "auto" }),
    ).not.toThrow();
    expect(() =>
      rejectUnsupportedDistributedFormat({ format: "mp4", hdrMode: "force-sdr" }),
    ).not.toThrow();
    expect(() =>
      rejectUnsupportedDistributedFormat({ format: "webm", hdrMode: "force-sdr" }),
    ).not.toThrow();
  });

  it('rejects HDR mp4 (`hdrMode === "force-hdr"`)', () => {
    let caught: unknown;
    try {
      rejectUnsupportedDistributedFormat({
        format: "mp4",
        hdrMode: "force-hdr" as DistributedRenderConfig["hdrMode"],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FormatNotSupportedInDistributedError);
    expect((caught as FormatNotSupportedInDistributedError).code).toBe(
      FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED,
    );
    expect((caught as FormatNotSupportedInDistributedError).format).toBe("mp4-hdr");
    expect((caught as Error).message).toMatch(/HDR/);
  });

  it("rejects HDR + webm combination (HDR is the trip, not webm)", () => {
    // Belt-and-suspenders: even when webm is the format, force-hdr must
    // still throw — distributed HDR is unimplemented regardless of format.
    let caught: unknown;
    try {
      rejectUnsupportedDistributedFormat({
        format: "webm",
        hdrMode: "force-hdr" as DistributedRenderConfig["hdrMode"],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FormatNotSupportedInDistributedError);
    expect((caught as FormatNotSupportedInDistributedError).format).toBe("mp4-hdr");
  });
});

describe("plan() banlist (end-to-end)", () => {
  it("throws on HDR mp4 and does not create the planDir", async () => {
    const planDir = join(runRoot, "plandir-hdr-bans");
    // Don't pre-create planDir — plan() shouldn't create it on the throw path.
    let caught: unknown;
    try {
      await plan(
        projectDir,
        {
          format: "mp4",
          fps: 30,
          width: 320,
          height: 240,
          hdrMode: "force-hdr" as DistributedRenderConfig["hdrMode"],
        },
        planDir,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FormatNotSupportedInDistributedError);
    expect((caught as FormatNotSupportedInDistributedError).format).toBe("mp4-hdr");
    expect(existsSync(planDir)).toBe(false);
  });
});
