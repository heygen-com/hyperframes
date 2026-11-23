import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { LeftOutReference } from "./leftOutReference.js";
import { stagePublishFiles } from "./publishProject.js";

let dir: string;
const locked: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-publish-unreadable-"));
});

afterEach(() => {
  for (const path of locked.splice(0)) chmodSync(path, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content = "x"): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content, "utf-8");
}

function lock(path: string): void {
  chmodSync(join(dir, path), 0o000);
  locked.push(join(dir, path));
}

function stage(): { keys: string[]; leftOut: LeftOutReference[]; warnings: string[] } {
  const leftOut: LeftOutReference[] = [];
  const warnings: string[] = [];
  const staged = stagePublishFiles(dir, Infinity, (warning, reference) => {
    warnings.push(warning);
    leftOut.push(reference);
  });
  return { keys: [...staged.keys()].sort(), leftOut, warnings };
}

const page = (body = "") =>
  `<!doctype html><html><body><div data-composition-id="main">${body}</div></body></html>`;

// chmod does not deny reads on Windows, and root reads through it.
const canDenyReads = process.platform !== "win32" && process.getuid?.() !== 0;

describe("a project file the upload cannot read", () => {
  it.skipIf(process.platform === "win32")(
    "is left out with its cause when it is a link to a file that is gone",
    () => {
      write("index.html", page());
      symlinkSync(join(dir, "nowhere.mp4"), join(dir, "gone.mp4"));

      const { keys, leftOut, warnings } = stage();

      expect(keys).toEqual(["index.html"]);
      expect(leftOut).toEqual([
        expect.objectContaining({
          file: "gone.mp4",
          reference: "gone.mp4",
          reason: "unreadable",
          cause: "missing",
        }),
      ]);
      expect(warnings).toEqual([
        "gone.mp4 could not be read because it was deleted or is a link to a file that is gone; it was left out of the upload.",
      ]);
    },
  );

  it.skipIf(!canDenyReads)(
    "leaves out a folder that cannot be listed, and uploads the rest",
    () => {
      write("index.html", page());
      write("logo.png");
      write("private/notes.txt");
      lock("private");

      const { keys, leftOut } = stage();

      expect(keys).toEqual(["index.html", "logo.png"]);
      expect(leftOut).toEqual([
        expect.objectContaining({ file: "private", reason: "unreadable", cause: "denied" }),
      ]);
    },
  );

  it.skipIf(!canDenyReads)("says so quietly when the video does not use it", () => {
    write("index.html", page('<img src="logo.png">'));
    write("logo.png");
    write("draft.png");
    lock("draft.png");

    const { keys, leftOut } = stage();

    expect(keys).toEqual(["index.html", "logo.png"]);
    expect(leftOut.map(({ file, reference }) => [file, reference])).toEqual([
      ["draft.png", "draft.png"],
    ]);
  });

  it.skipIf(!canDenyReads)("names the page that uses it when the video does", () => {
    write("index.html", page('<img src="assets/logo.png">'));
    write("assets/logo.png");
    lock("assets/logo.png");

    const { keys, leftOut, warnings } = stage();

    expect(keys).toEqual(["index.html"]);
    expect(leftOut).toEqual([
      expect.objectContaining({ file: "assets/logo.png", reference: "assets/logo.png" }),
      expect.objectContaining({
        file: "index.html",
        reference: "assets/logo.png",
        reason: "unreadable",
        cause: "denied",
      }),
    ]);
    expect(warnings[1]).toBe(
      "index.html uses assets/logo.png, which could not be read because this computer does not allow reading it; it was left out of the upload.",
    );
  });

  it.skipIf(!canDenyReads)("names the page that uses a file inside a folder it cannot list", () => {
    write("index.html", page('<video src="media/intro.mp4"></video>'));
    write("media/intro.mp4");
    lock("media");

    const { leftOut } = stage();

    expect(leftOut.map(({ file, reference, cause }) => [file, reference, cause])).toEqual([
      ["media", "media", "denied"],
      ["index.html", "media/intro.mp4", "denied"],
    ]);
  });

  it.skipIf(!canDenyReads)("refuses, naming it, when it is the page the video starts from", () => {
    write("index.html", page());
    lock("index.html");

    expect(() => stage()).toThrow(
      "index.html could not be read because this computer does not allow reading it.",
    );
  });
});
