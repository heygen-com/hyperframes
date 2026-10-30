import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readToolContext, reportArtifacts } from "./toolContext.js";

const directories: string[] = [];
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), "hf-tool-context-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const context = (capabilities: unknown, version: unknown = 1) =>
  JSON.stringify({ version, capabilities });
const eventsAt = (path: string) => ({ transport: { type: "ndjson-file", path } });

describe("readToolContext", () => {
  it("is empty without a valid version 1 declaration", () => {
    for (const raw of [
      undefined,
      "",
      "not json",
      "[]",
      context({ events: eventsAt("/tmp/e") }, 2),
      context(["events"]),
    ])
      expect(readToolContext(raw)).toEqual({});
  });

  it("keeps each valid capability and ignores invalid or unknown ones", () => {
    const raw = context({
      events: eventsAt("/tmp/events.ndjson"),
      "project-lock": { waitMs: -1 },
      "future-capability": { anything: true },
    });
    expect(readToolContext(raw)).toEqual({ events: { path: "/tmp/events.ndjson" } });
    expect(readToolContext(context({ "project-lock": { waitMs: 500 } }))).toEqual({
      projectLock: { waitMs: 500 },
    });
    expect(readToolContext(context({ events: eventsAt("relative.ndjson") }))).toEqual({});
    expect(
      readToolContext(context({ events: { transport: { type: "http", path: "/x" } } })),
    ).toEqual({});
  });

  it("reads check-review switches as booleans that default to false", () => {
    expect(
      readToolContext(context({ "check-review": { skipContrastInMotion: true, other: 1 } })),
    ).toEqual({
      checkReview: { skipContrastInMotion: true, findingFrames: false, inspect: false },
    });
    expect(
      readToolContext(
        context({ "check-review": { skipContrastInMotion: 1, findingFrames: true } }),
      ),
    ).toEqual({
      checkReview: { skipContrastInMotion: false, findingFrames: true, inspect: false },
    });
    expect(
      readToolContext(context({ "check-review": { findingFrames: true, inspect: true } })),
    ).toEqual({ checkReview: { skipContrastInMotion: false, findingFrames: true, inspect: true } });
    expect(readToolContext(context({ "check-review": { inspect: "yes" } }))).toEqual({
      checkReview: { skipContrastInMotion: false, findingFrames: false, inspect: false },
    });
    expect(readToolContext(context({ "check-review": true }))).toEqual({});
  });
});

describe("reportArtifacts", () => {
  it("appends one artifact.created line per path, with absolute paths and media types", () => {
    const path = join(temporary(), "events.ndjson");
    const events = { events: { path } };
    reportArtifacts("snapshot", "contact-sheet", ["/p/contact-sheet.jpg"], events);
    reportArtifacts("check", "finding", ["/p/crop.bin", "/p/crop.png"], events);
    const lines = readFileSync(path, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        version: 1,
        type: "artifact.created",
        command: "snapshot",
        artifact: {
          role: "contact-sheet",
          path: resolve("/p/contact-sheet.jpg"),
          mediaType: "image/jpeg",
        },
      },
      {
        version: 1,
        type: "artifact.created",
        command: "check",
        artifact: {
          role: "finding",
          path: resolve("/p/crop.bin"),
          mediaType: "application/octet-stream",
        },
      },
      {
        version: 1,
        type: "artifact.created",
        command: "check",
        artifact: { role: "finding", path: resolve("/p/crop.png"), mediaType: "image/png" },
      },
    ]);
  });

  it("writes nothing without the events capability, and only warns when the file is unwritable", () => {
    expect(() => reportArtifacts("snapshot", "frame", ["/p/a.png"], {})).not.toThrow();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportArtifacts("snapshot", "frame", ["/p/a.png"], {
      events: { path: join(temporary(), "missing", "events.ndjson") },
    });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
