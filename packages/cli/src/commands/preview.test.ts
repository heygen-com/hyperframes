import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { studioLandingSearch } from "./preview.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectWith(storyboard: string | null, frameFiles: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-preview-landing-"));
  tempDirs.push(dir);
  if (storyboard !== null) writeFileSync(join(dir, "STORYBOARD.md"), storyboard);
  for (const file of frameFiles) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), "<div></div>");
  }
  return dir;
}

const FRAME = (n: number, status: string) =>
  `## Frame ${n} — F${n}\n- status: ${status}\n- src: compositions/frames/0${n}.html\n\nBeat.\n`;

describe("studioLandingSearch", () => {
  it("returns no search without a storyboard", () => {
    expect(studioLandingSearch(projectWith(null))).toBe("");
  });

  it("lands on the board while sketches are under review (any built frame)", () => {
    const dir = projectWith(`${FRAME(1, "built")}${FRAME(2, "outline")}`, [
      "compositions/frames/01.html",
    ]);
    expect(studioLandingSearch(dir)).toBe("?view=storyboard");
  });

  it("lands on the board during pure planning (srcs declared, none exist)", () => {
    const dir = projectWith(`${FRAME(1, "outline")}${FRAME(2, "outline")}`);
    expect(studioLandingSearch(dir)).toBe("?view=storyboard");
  });

  it("lands on the timeline once frames exist without a built status", () => {
    const dir = projectWith(`${FRAME(1, "outline")}`, ["compositions/frames/01.html"]);
    expect(studioLandingSearch(dir)).toBe("");
  });

  it("lands on the timeline for fully animated boards", () => {
    const dir = projectWith(`${FRAME(1, "animated")}`, ["compositions/frames/01.html"]);
    expect(studioLandingSearch(dir)).toBe("");
  });
});
