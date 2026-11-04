import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captionImagesWithGemini } from "./contentExtractor.js";

const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }));

vi.mock("../utils/optionalPackages.js", () => ({
  loadSharp: async () => (await import("sharp")).default,
  loadOptionalPackage: vi.fn(async () => ({
    GoogleGenAI: class {
      models = { generateContent: generateContentMock };
    },
  })),
}));

const hooks = vi.hoisted(() => ({
  afterStat: () => {},
  beforeRead: () => {},
  descriptor: -1,
  closed: [] as number[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    statSync: (path: fs.PathLike) => {
      const stat = actual.statSync(path);
      hooks.afterStat();
      return stat;
    },
    fstatSync: (fd: number) => {
      hooks.descriptor = fd;
      const stat = actual.fstatSync(fd);
      hooks.afterStat();
      return stat;
    },
    closeSync: (fd: number) => {
      actual.closeSync(fd);
      hooks.closed.push(fd);
    },
    readFileSync: (path: fs.PathOrFileDescriptor) => {
      hooks.beforeRead();
      return actual.readFileSync(path);
    },
  };
});

describe("caption image file reads", () => {
  let dir: string;
  let file: string;
  let sentBody: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), "hf-caption-read-"));
    fs.mkdirSync(join(dir, "assets"));
    file = join(dir, "assets", "hero.png");
    fs.writeFileSync(file, "original image");
    hooks.afterStat = () => {};
    hooks.beforeRead = () => {};
    hooks.descriptor = -1;
    hooks.closed = [];
    sentBody = "";
    generateContentMock.mockReset();
    generateContentMock.mockImplementation(async (request: unknown) => {
      sentBody = JSON.stringify(request);
      return { text: "A hero." };
    });
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("HYPERFRAMES_VERTEX_PROJECT_ID", "");
    vi.stubEnv("HYPERFRAMES_VERTEX_SERVICE_ACCOUNT", "");
  });

  afterEach(() => {
    hooks.afterStat = () => {};
    hooks.beforeRead = () => {};
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Probing the number with fstat races its reuse by any file opened after the close.
  function expectClosed() {
    expect(hooks.descriptor).toBeGreaterThanOrEqual(0);
    expect(hooks.closed).toEqual([hooks.descriptor]);
  }

  it("reads the checked image when its directory entry is replaced", async () => {
    hooks.afterStat = () => {
      fs.renameSync(file, join(dir, "original.png"));
      fs.writeFileSync(file, "replacement image");
    };
    expect(await captionImagesWithGemini(dir, () => {}, [])).toEqual({ "hero.png": "A hero." });
    expect(sentBody).toContain(Buffer.from("original image").toString("base64"));
    expect(sentBody).not.toContain(Buffer.from("replacement image").toString("base64"));
    expectClosed();
  });

  it.each([4_000_000, 4_000_001])("preserves the inline size limit for %i bytes", async (size) => {
    fs.writeFileSync(file, Buffer.alloc(size));
    const read = vi.fn();
    hooks.beforeRead = read;
    const captions = await captionImagesWithGemini(dir, () => {}, []);
    expect(captions).toEqual(size === 4_000_000 ? { "hero.png": "A hero." } : {});
    expect(generateContentMock).toHaveBeenCalledTimes(size === 4_000_000 ? 1 : 0);
    expect(read).toHaveBeenCalledTimes(size === 4_000_000 ? 1 : 0);
    expectClosed();
  });

  it.each(["stat", "read"])("closes the image and reports a failed %s", async (step) => {
    const fail = () => {
      throw new Error("Injected file failure");
    };
    if (step === "stat") hooks.afterStat = fail;
    else hooks.beforeRead = fail;
    const warnings: string[] = [];
    expect(await captionImagesWithGemini(dir, () => {}, warnings)).toEqual({});
    expect(warnings).toEqual(["Gemini vision failed for 1 asset(s); captions omitted."]);
    expect(generateContentMock).not.toHaveBeenCalled();
    expectClosed();
  });
});
