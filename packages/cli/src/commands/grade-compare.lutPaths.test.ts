import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const watched = <F extends (path: fs.PathLike, ...rest: never[]) => unknown>(fn: F) =>
    ((path: fs.PathLike, ...rest: never[]) => {
      calls.paths.push(String(path));
      return fn(path, ...rest);
    }) as F;
  return {
    ...real,
    existsSync: watched(real.existsSync),
    statSync: watched(real.statSync as never),
    readFileSync: watched(real.readFileSync as never),
    copyFileSync: watched(real.copyFileSync as never),
    realpathSync: Object.assign(watched(real.realpathSync as never), {
      native: watched(real.realpathSync.native as never),
    }),
  };
});

const { prepareGradeCompareTempProject } = await import("./grade-compare.js");

const CUBE = `LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

let base = "";
let project = "";
let outside = "";

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "hf-grade-lut-")));
  project = join(base, "project");
  outside = join(base, "outside.cube");
  fs.mkdirSync(project);
  fs.writeFileSync(join(project, "look.cube"), CUBE);
  fs.writeFileSync(outside, CUBE);
  calls.paths.length = 0;
});

afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

function prepare(src: string, lutPathsTypedWithLutsFlag?: boolean) {
  return prepareGradeCompareTempProject({
    projectDir: project,
    framePath: join(project, "frame.png"),
    frameBuffer: Buffer.from("fake-png"),
    cells: [{ label: "sent", grading: { lut: { src } } }],
    frameWidth: 64,
    frameHeight: 36,
    lutPathsTypedWithLutsFlag,
  }).then((prepared) => fs.rmSync(prepared.tempDir, { recursive: true, force: true }));
}

// fails without the fix: a LUT path from a grades file was stat'ed, read and copied wherever it pointed.
describe("LUT paths from a grades file", () => {
  it.each([
    "\\\\attacker\\share\\look.cube",
    "//attacker/share/look.cube",
    "\\\\?\\C:\\look.cube",
    "D:\\look.cube",
    "../outside.cube",
  ])("refuses %s before any file call on it", async (src) => {
    await expect(prepare(src)).rejects.toThrow(/must be a file inside the project/);
    expect(
      calls.paths.filter((path) => path.includes("attacker") || path.includes("outside")),
    ).toEqual([]);
  });

  it("refuses an absolute path outside the project, though the file is a valid .cube", async () => {
    await expect(prepare(outside)).rejects.toThrow(/must be a file inside the project/);
  });

  it("refuses a link in the project that leads out of it", async () => {
    fs.symlinkSync(outside, join(project, "linked.cube"));
    await expect(prepare("linked.cube")).rejects.toThrow(/must be a file inside the project/);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a FIFO in the project without reading it",
    async () => {
      execFileSync("mkfifo", [join(project, "pipe.cube")]);
      await expect(prepare("pipe.cube")).rejects.toThrow(/must be a file inside the project/);
    },
  );

  it("still stages a LUT inside the project", async () => {
    await expect(prepare("look.cube")).resolves.toBeUndefined();
  });

  it("keeps a typed --luts path as given", async () => {
    await expect(prepare(outside, true)).resolves.toBeUndefined();
  });
});
