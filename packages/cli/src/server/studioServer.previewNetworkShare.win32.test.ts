import { afterEach, describe, expect, it, vi } from "vitest";

// The server starts under this host's path rules; only the preview transform runs under Windows rules.
const host = vi.hoisted(() => ({ windows: false, touched: [] as string[] }));
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  const rules = () => (host.windows ? path.win32 : path.posix);
  const switched = Object.fromEntries(
    Object.entries(path.posix).map(([name, value]) => [
      name,
      typeof value === "function"
        ? (...args: unknown[]) => Reflect.apply(Reflect.get(rules(), name), undefined, args)
        : value,
    ]),
  );
  return { ...switched, default: switched };
});
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const record =
    <Args extends unknown[], Result>(look: (...args: Args) => Result) =>
    (...args: Args): Result => {
      if (host.windows) host.touched.push(String(args[0]));
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

vi.mock("../utils/receivedRender.js", () => ({ outsideAssetsAllowed: () => true }));

const { createStudioServer } = await import("./studioServer.js");
const { cleanupStudioServerRoot, makeStudioServerRoot } =
  await import("./studioServerTestFixture.js");

const SHARES = [
  "\\\\host\\share\\a.gif",
  "/\\host\\share\\b.gif",
  "\\/host/share/c.heic",
  "//host/share/d.gif",
  "\\\\?\\UNC\\host\\share\\e.gif",
  "\\\\.\\pipe\\g.gif",
  "\\\\.\\UNC\\host\\share\\h.heic",
];
const onAShare = (path: string) => /^[\\/]{2}[^\\/]/.test(path);

let cleanup: (() => void) | undefined;
afterEach(() => {
  host.windows = false;
  host.touched.length = 0;
  cleanup?.();
  cleanup = undefined;
});

describe("studio preview image preparation under Windows path rules", () => {
  it("looks only at local paths for image srcs on another computer's share", async () => {
    const { root, projectDir } = makeStudioServerRoot("hf-preview-share-");
    const server = createStudioServer({ projectDir });
    cleanup = () => cleanupStudioServerRoot(server, root);
    const html = `${SHARES.map((src) => `<img src="${src}">`).join("")}<img src="local.gif">`;

    host.windows = true;
    await server.adapter.transformPreviewHtml?.({
      html,
      project: { id: "p", dir: "C:\\project" },
      activeCompositionPath: "index.html",
    });
    host.windows = false;

    expect(host.touched.filter(onAShare)).toEqual([]);
    expect(host.touched).toContain("C:\\project\\local.gif");
  });
});
