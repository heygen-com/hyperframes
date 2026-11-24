import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { admitsFilmSource, refuseUnadmittedFilmSources } from "./filmSources.js";
import type { AudioTarget } from "./targets.js";

const base = mkdtempSync(join(tmpdir(), "hf-film-sources-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const project = join(base, "project");
const outside = join(base, "secret.wav");
for (const dir of ["audio", ".hyperframes", "folder.wav"])
  mkdirSync(join(project, dir), { recursive: true });
for (const file of ["audio/vo.wav", ".hyperframes/state.wav", ".env.wav"])
  writeFileSync(join(project, file), "x");
writeFileSync(outside, "x");
symlinkSync(outside, join(project, "audio", "linked.wav"));

const never = () => {
  throw new Error("the render rule is only asked about files outside the project");
};

describe("admitsFilmSource", () => {
  it("admits a regular, non-private file inside the project without asking the render rule", () => {
    expect(admitsFilmSource(project, join(project, "audio/vo.wav"), never)).toBe(true);
  });

  it("refuses private files and folders inside the project", () => {
    for (const path of [".hyperframes/state.wav", ".env.wav", "folder.wav"]) {
      expect(admitsFilmSource(project, join(project, path), never), path).toBe(false);
    }
  });

  it("admits a file outside the project, or a link to one, only when the render rule does", () => {
    for (const path of [outside, join(project, "audio/linked.wav")]) {
      expect(
        admitsFilmSource(project, path, () => false),
        path,
      ).toBe(false);
      expect(
        admitsFilmSource(project, path, () => true),
        path,
      ).toBe(true);
    }
  });

  it("lets a missing file through, to be reported as missing", () => {
    expect(admitsFilmSource(project, join(project, "gone.wav"), never)).toBe(true);
  });
});

describe("refuseUnadmittedFilmSources", () => {
  const target = (path: string, file = path): AudioTarget => ({
    path,
    file,
    ref: null,
    kind: "audio",
    placement: null,
  });

  it("marks refused sources and asks the render rule once", () => {
    let asked = 0;
    const targets = refuseUnadmittedFilmSources(
      project,
      [
        target(join(project, "audio/vo.wav")),
        target(outside),
        target(join(project, "../secret.wav")),
        target(join(project, ".hyperframes/state.wav")),
      ],
      () => (asked++, false),
    );
    expect(targets.map((t) => t.refused ?? false)).toEqual([false, true, true, true]);
    expect(asked).toBe(1);
  });

  it("leaves remote sources to their own refusal", () => {
    const [remote] = refuseUnadmittedFilmSources(
      project,
      [target("/remote", "https://cdn.example/a.mp3")],
      never,
    );
    expect(remote!.refused).toBeUndefined();
  });
});
