import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeUnresolvedFontUse, unresolvedFontFamilies } from "./fontFailure.js";

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "hf-font-failure-"));
  mkdirSync(join(project, "compositions"));
  mkdirSync(join(project, "node_modules", "pkg"), { recursive: true });
  writeFileSync(
    join(project, "index.html"),
    '<div data-composition-src="compositions/title.html">',
  );
  writeFileSync(
    join(project, "compositions", "title.html"),
    '<style>.a { font: 500 16px/1 "PingFang SC", sans-serif; }</style>',
  );
  writeFileSync(
    join(project, "compositions", "lower.html"),
    "<style>p { font-family: Inter; }</style>",
  );
  writeFileSync(join(project, "node_modules", "pkg", "x.css"), 'b { font-family: "PingFang SC"; }');
});

afterEach(() => rmSync(project, { recursive: true, force: true }));

describe("unresolvedFontFamilies", () => {
  it.each([
    ["fonts that could not be resolved: PingFang SC", ["PingFang SC"]],
    [
      'font localization failed (FontFetchError): unresolved font families: "PingFang SC", "Hiragino Sans" (+1 more)',
      ["PingFang SC", "Hiragino Sans"],
    ],
    [
      "[Compiler] Unresolved fonts in fail-closed mode: PingFang SC, Geeza Pro. Distributed renders require all fonts to be resolvable.",
      ["PingFang SC", "Geeza Pro"],
    ],
    ["Chrome crashed while capturing frame 12", []],
  ])("reads %s", (message, families) => {
    expect(unresolvedFontFamilies(message)).toEqual(families);
  });
});

describe("describeUnresolvedFontUse", () => {
  it("names the composition file that uses the font the cloud refused", () => {
    const said = describeUnresolvedFontUse(
      "Render failed: fonts that could not be resolved: PingFang SC, Missing Face",
      project,
    );

    expect(said).toContain(`PingFang SC: used in ${join("compositions", "title.html")}`);
    expect(said).not.toContain("lower.html");
    expect(said).not.toContain("node_modules");
    expect(said).toContain("Missing Face: not found in the project files");
  });

  it("adds nothing to a failure that is not about fonts", () => {
    expect(describeUnresolvedFontUse("Chrome crashed", project)).toBeUndefined();
  });
});
