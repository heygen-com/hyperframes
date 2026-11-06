import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyDirSync } from "./copyDir.js";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function source(): string {
  const dir = mkdtempSync(join(tmpdir(), "copydir-src-"));
  made.push(dir);
  mkdirSync(join(dir, "compositions", "café"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<html></html>");
  writeFileSync(join(dir, "compositions", "café", "scène.html"), "<div></div>");
  return dir;
}

describe("copyDirSync", () => {
  it("copies every file, non-ASCII names included, into a folder that already holds others", () => {
    const dest = mkdtempSync(join(tmpdir(), "copydir-dest-"));
    made.push(dest);
    writeFileSync(join(dest, "hyperframes.json"), "{}");
    copyDirSync(source(), dest);
    expect(readFileSync(join(dest, "index.html"), "utf8")).toBe("<html></html>");
    expect(readFileSync(join(dest, "compositions", "café", "scène.html"), "utf8")).toBe(
      "<div></div>",
    );
    expect(readFileSync(join(dest, "hyperframes.json"), "utf8")).toBe("{}");
  });

  // windows-latest: fs.cpSync into this folder ends the process with 0xC0000409, so this test fails without the fix.
  it.skipIf(process.platform !== "win32")(
    "copies into an existing folder directly under a drive root",
    () => {
      const dest = join(parse(tmpdir()).root, `copydir-root-${process.pid}-${Date.now()}`);
      mkdirSync(dest);
      made.push(dest);
      copyDirSync(source(), dest);
      expect(readFileSync(join(dest, "index.html"), "utf8")).toBe("<html></html>");
    },
  );
});
