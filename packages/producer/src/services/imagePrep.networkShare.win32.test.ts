import { afterEach, describe, expect, it, vi } from "vitest";

// Windows path rules on any host, and a disk that records every path it is asked about.
const touched = vi.hoisted(() => [] as string[]);
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...path.win32, default: path.win32 };
});
// Built workspace packages load outside the path mock; the share test runs from source under it.
vi.mock(
  "@hyperframes/parsers/asset-resolution",
  () => import("../../../parsers/src/assetResolution.js"),
);
for (const fsModule of ["fs", "node:fs"]) {
  vi.doMock(fsModule, async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const record =
      <Args extends unknown[], Result>(look: (...args: Args) => Result) =>
      (...args: Args): Result => {
        touched.push(String(args[0]));
        return look(...args);
      };
    const realpath = record(fs.realpathSync);
    const overrides = {
      existsSync: record(fs.existsSync),
      statSync: record(fs.statSync),
      lstatSync: record(fs.lstatSync),
      readFileSync: record(fs.readFileSync),
      openSync: record(fs.openSync),
      realpathSync: Object.assign(realpath, { native: record(fs.realpathSync.native) }),
    };
    return { ...fs, ...overrides, default: { ...fs, ...overrides } };
  });
}

const { prepareAnimatedGifInputs, resolveLocalImageSourcePath } =
  await import("./animatedGifPrep.js");
const { prepareHeifImageInputs } = await import("./heifImagePrep.js");
const { collectExternalAssets } = await import("./htmlCompiler.js");

const PROJECT = "C:\\project";
const DOWNLOADS = "C:\\project\\.hyperframes\\prepared-assets\\downloads";
const SHARES = [
  "\\\\host\\share\\a.gif",
  "/\\host\\share\\b.gif",
  "\\/host/share/c.gif",
  "//host/share/d.gif",
  "\\\\?\\UNC\\host\\share\\e.gif",
  "\\\\?\\D:\\media\\f.gif",
  "\\\\.\\pipe\\g.gif",
  "\\\\.\\UNC\\host\\share\\h.gif",
  "\\\\host\\share\\i.gif?v=2",
];
// Names a host or device namespace; a bare "\\" (a \\?\ src cut at "?") names neither.
const onAShare = (path: string) => /^[\\/]{2}[^\\/]/.test(path);
const page = (srcs: string[]) => srcs.map((src) => `<img src="${src}">`).join("");

afterEach(() => {
  touched.length = 0;
});

describe("image prep under Windows path rules", () => {
  it.each(SHARES)("never looks at %s when resolving an image src", (src) => {
    const options = { projectDir: PROJECT, downloadDir: DOWNLOADS };
    expect(resolveLocalImageSourcePath(src, options)).toBeNull();
    expect(touched.filter(onAShare)).toEqual([]);
  });

  it("HEIF prep looks only at local paths", async () => {
    await prepareHeifImageInputs(page([...SHARES, "local.gif"]), {
      projectDir: PROJECT,
      downloadDir: DOWNLOADS,
      allowOutsideFiles: true,
    });
    expect(touched.filter(onAShare)).toEqual([]);
    expect(touched).toContain("C:\\project\\local.gif");
  });

  it("GIF prep looks only at local paths", async () => {
    await prepareAnimatedGifInputs(page([...SHARES, "local.gif"]), {
      projectDir: PROJECT,
      downloadDir: DOWNLOADS,
      allowOutsideFiles: true,
    });
    expect(touched.filter(onAShare)).toEqual([]);
    expect(touched).toContain("C:\\project\\local.gif");
  });
});

describe("collectExternalAssets under Windows path rules", () => {
  it("leaves out references on another computer's share before any filesystem call", () => {
    const warn = vi.fn();
    const log = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    const html = `${page(SHARES)}<img src="..\\shared\\local.png">
      <style>.a { background: url("\\\\host\\share\\bg.png"); }</style>
      <div style="background: url('\\\\?\\UNC\\host\\share\\inline.png')"></div>`;

    const { externalAssets } = collectExternalAssets(html, PROJECT, log);

    expect(externalAssets.size).toBe(0);
    expect(touched.filter(onAShare)).toEqual([]);
    expect(touched).toContain("C:\\shared\\local.png");
    const warnings = warn.mock.calls.map(([line]) => String(line));
    expect(warnings.some((line) => line.includes("\\\\host\\share\\a.gif"))).toBe(true);
    expect(warnings.some((line) => line.includes("\\\\host\\share\\bg.png"))).toBe(true);
    expect(warnings.every((line) => line.includes("network share"))).toBe(true);
  });
});
