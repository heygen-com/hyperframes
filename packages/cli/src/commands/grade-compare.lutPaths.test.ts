import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  paths: [] as string[],
  openedInos: [] as number[],
  onLstat: null as ((path: string) => void) | null,
  onOpen: null as ((path: string) => void) | null,
}));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const watched = <F extends (path: fs.PathLike, ...rest: never[]) => unknown>(fn: F) =>
    ((path: fs.PathLike, ...rest: never[]) => {
      if (typeof path !== "number") calls.paths.push(String(path));
      return fn(path, ...rest);
    }) as F;
  return {
    ...real,
    existsSync: watched(real.existsSync),
    statSync: watched(real.statSync as never),
    openSync: ((path: fs.PathLike, ...rest: never[]) => {
      calls.paths.push(String(path));
      const fd = (real.openSync as (...args: unknown[]) => number)(path, ...rest);
      calls.openedInos.push(real.fstatSync(fd).ino);
      calls.onOpen?.(String(path));
      return fd;
    }) as typeof real.openSync,
    readFileSync: watched(real.readFileSync as never),
    copyFileSync: watched(real.copyFileSync as never),
    lstatSync: ((path: fs.PathLike, ...rest: never[]) => {
      const result = (real.lstatSync as (...args: unknown[]) => unknown)(path, ...rest);
      calls.onLstat?.(String(path));
      return result;
    }) as typeof real.lstatSync,
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
  fs.writeFileSync(outside, `# outside-secret\n${CUBE}`);
  calls.paths.length = 0;
  calls.openedInos.length = 0;
  calls.onLstat = null;
  calls.onOpen = null;
});

afterEach(() => {
  calls.onLstat = null;
  calls.onOpen = null;
  fs.rmSync(base, { recursive: true, force: true });
});

function prepareResult(src: string, lutPathsTypedWithLutsFlag?: boolean) {
  return prepareGradeCompareTempProject({
    projectDir: project,
    framePath: join(project, "frame.png"),
    frameBuffer: Buffer.from("fake-png"),
    cells: [{ label: "sent", grading: { lut: { src } } }],
    frameWidth: 64,
    frameHeight: 36,
    lutPathsTypedWithLutsFlag,
  });
}

function prepare(src: string, lutPathsTypedWithLutsFlag?: boolean) {
  return prepareResult(src, lutPathsTypedWithLutsFlag).then((prepared) =>
    fs.rmSync(prepared.tempDir, { recursive: true, force: true }),
  );
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

  // fails without the fix: the link was checked with calls that follow it to its target first.
  it("refuses a link in the project that leads out of it, reading only the link", async () => {
    fs.symlinkSync(outside, join(project, "linked.cube"));
    await expect(prepare("linked.cube")).rejects.toThrow(/must be a file inside the project/);
    expect(calls.paths).not.toContain(join(project, "linked.cube"));
  });

  it.skipIf(process.platform === "win32")(
    "refuses a FIFO in the project without reading it",
    async () => {
      execFileSync("mkfifo", [join(project, "pipe.cube")]);
      await expect(prepare("pipe.cube")).rejects.toThrow(/must be a file inside the project/);
    },
  );

  // fails without the fix: the check returned the destination, then grade-compare opened the original link.
  it("opens the verified destination, not the original link, if the link is swapped after the check", async () => {
    const looksDir = join(project, "looks");
    const realLut = join(looksDir, "real.cube");
    const link = join(project, "linked.cube");
    const insideCube = `# inside-real\n${CUBE}`;
    fs.mkdirSync(looksDir);
    fs.writeFileSync(realLut, insideCube);
    fs.symlinkSync(join("looks", "real.cube"), link);

    let swapped = false;
    calls.onLstat = (p) => {
      if (!swapped && p === realLut) {
        swapped = true;
        fs.unlinkSync(link);
        fs.symlinkSync(outside, link);
      }
    };

    const prepared = await prepareResult("linked.cube");
    try {
      expect(swapped).toBe(true);
      expect(fs.readFileSync(join(prepared.tempDir, "lut-0.cube"), "utf-8")).toBe(insideCube);
      expect(calls.paths).not.toContain(link);
      expect(calls.paths).not.toContain(outside);
    } finally {
      fs.rmSync(prepared.tempDir, { recursive: true, force: true });
    }
  });

  // fails without the fix: the link walk collapsed sub/.. lexically without reading sub first.
  it("refuses a link whose target climbs through an outside directory link with ..", async () => {
    const outerNested = join(base, "outer", "nested");
    fs.mkdirSync(outerNested, { recursive: true });
    fs.writeFileSync(join(base, "outer", "look.cube"), `# outside-secret\n${CUBE}`);
    fs.symlinkSync(outerNested, join(project, "sub"), "dir");
    fs.symlinkSync("sub/../look.cube", join(project, "sneaky.cube"));
    await expect(prepare("sneaky.cube")).rejects.toThrow(/must be a file inside the project/);
    expect(calls.paths).not.toContain(join(project, "sneaky.cube"));
  });

  // fails without the fix: O_NOFOLLOW only guards the final component, so swapping a parent dir let open follow it out.
  it("refuses when a parent directory is swapped to an outside link between check and open", async () => {
    const looksDir = join(project, "looks");
    const realLut = join(looksDir, "real.cube");
    const outsideDir = join(base, "outside-looks");
    fs.mkdirSync(looksDir);
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(realLut, `# inside-real\n${CUBE}`);
    fs.writeFileSync(join(outsideDir, "real.cube"), `# outside-secret\n${CUBE}`);

    let swapped = false;
    calls.onLstat = (p) => {
      if (!swapped && p === realLut) {
        swapped = true;
        fs.renameSync(looksDir, join(project, "looks-moved"));
        fs.symlinkSync(outsideDir, looksDir, "dir");
      }
    };

    await expect(prepare("looks/real.cube")).rejects.toThrow(/must be a file inside the project/);
    expect(swapped).toBe(true);
  });

  // fails without the fix: swapping the parent dir before leaf open lets an
  // absolute-path open contact the outside file.
  it.skipIf(process.platform === "win32")(
    "refuses when a parent directory is swapped right before the leaf file is opened",
    async () => {
      const looksDir = join(project, "looks");
      const realLut = join(looksDir, "real.cube");
      const outsideDir = join(base, "outside-looks-late");
      const outsideCube = join(outsideDir, "real.cube");
      fs.mkdirSync(looksDir);
      fs.mkdirSync(outsideDir);
      fs.writeFileSync(realLut, `# inside-real\n${CUBE}`);
      fs.writeFileSync(outsideCube, `# outside-secret\n${CUBE}`);
      const outsideIno = fs.statSync(outsideCube).ino;

      let swapped = false;
      calls.onOpen = (p) => {
        if (!swapped && (p === looksDir || p.endsWith("/looks"))) {
          swapped = true;
          fs.renameSync(looksDir, join(project, "looks-moved"));
          fs.symlinkSync(outsideDir, looksDir, "dir");
        }
      };

      await expect(prepare("looks/real.cube")).rejects.toThrow(/must be a file inside the project/);
      expect(swapped).toBe(true);
      if (process.platform === "linux") {
        expect(calls.openedInos).not.toContain(outsideIno);
      }
    },
  );

  it("still stages a LUT inside the project", async () => {
    await expect(prepare("look.cube")).resolves.toBeUndefined();
  });

  it("keeps a typed --luts path as given", async () => {
    await expect(prepare(outside, true)).resolves.toBeUndefined();
  });
});
