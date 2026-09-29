import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captionImagesWithGemini } from "./contentExtractor.js";

const hooks = vi.hoisted(() => ({
  afterStat: () => {},
  beforeRead: () => {},
  descriptor: -1,
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
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    sentBody = typeof init?.body === "string" ? init.body : "";
    return new Response(JSON.stringify({ choices: [{ message: { content: "A hero." } }] }));
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), "hf-caption-read-"));
    fs.mkdirSync(join(dir, "assets"));
    file = join(dir, "assets", "hero.png");
    fs.writeFileSync(file, "original image");
    hooks.afterStat = () => {};
    hooks.beforeRead = () => {};
    hooks.descriptor = -1;
    sentBody = "";
    fetchMock.mockClear();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    hooks.afterStat = () => {};
    hooks.beforeRead = () => {};
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function expectClosed() {
    const actual = await vi.importActual<typeof fs>("node:fs");
    expect(hooks.descriptor).toBeGreaterThanOrEqual(0);
    expect(() => actual.fstatSync(hooks.descriptor)).toThrow(/EBADF/);
  }

  it("reads the checked image when its directory entry is replaced", async () => {
    hooks.afterStat = () => {
      fs.renameSync(file, join(dir, "original.png"));
      fs.writeFileSync(file, "replacement image");
    };
    expect(await captionImagesWithGemini(dir, () => {}, [])).toEqual({ "hero.png": "A hero." });
    expect(sentBody).toContain(Buffer.from("original image").toString("base64"));
    expect(sentBody).not.toContain(Buffer.from("replacement image").toString("base64"));
    await expectClosed();
  });

  it.each([4_000_000, 4_000_001])("preserves the inline size limit for %i bytes", async (size) => {
    fs.writeFileSync(file, Buffer.alloc(size));
    const read = vi.fn();
    hooks.beforeRead = read;
    const captions = await captionImagesWithGemini(dir, () => {}, []);
    expect(captions).toEqual(size === 4_000_000 ? { "hero.png": "A hero." } : {});
    expect(fetchMock).toHaveBeenCalledTimes(size === 4_000_000 ? 1 : 0);
    expect(read).toHaveBeenCalledTimes(size === 4_000_000 ? 1 : 0);
    await expectClosed();
  });

  it.each(["stat", "read"])("closes the image and reports a failed %s", async (step) => {
    const fail = () => {
      throw new Error("Injected file failure");
    };
    if (step === "stat") hooks.afterStat = fail;
    else hooks.beforeRead = fail;
    const warnings: string[] = [];
    expect(await captionImagesWithGemini(dir, () => {}, warnings)).toEqual({});
    expect(warnings).toEqual(["OpenRouter vision failed for 1 asset(s); captions omitted."]);
    expect(fetchMock).not.toHaveBeenCalled();
    await expectClosed();
  });
});
