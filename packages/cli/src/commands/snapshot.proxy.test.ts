import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StaticProjectServer } from "../utils/staticProjectServer.js";

const mocks = vi.hoisted(() => ({
  injectMediaCodecMap: vi.fn(async (html: string) => html),
  resolveProxy: vi.fn(async () => "/unused-proxy-path"),
}));

vi.mock("../utils/compositionServer.js", () => ({
  injectMediaCodecMap: mocks.injectMediaCodecMap,
}));
vi.mock("@hyperframes/studio-server/proxy-transcoder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/studio-server/proxy-transcoder")>()),
  resolveProxy: mocks.resolveProxy,
}));

import { serveCapturePage } from "./snapshot.js";

let server: StaticProjectServer | undefined;
let dir: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  vi.clearAllMocks();
});

/** A project whose hyperframes.json turns media proxies on, with an iPhone-style HEVC clip. */
function hostileClipProject(): string {
  dir = mkdtempSync(join(tmpdir(), "hf-snapshot-proxy-"));
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ media: { autoProxy: true } }));
  writeFileSync(join(dir, "clip.mov"), "fake hevc bytes");
  return dir;
}

const html = '<html><head></head><body><video src="clip.mov"></video></body></html>';

describe("serveCapturePage", () => {
  it("starts no transcode of a hostile clip by default, whatever hyperframes.json says", async () => {
    server = await serveCapturePage(hostileClipProject(), html, undefined);
    const proxy = await fetch(`${server.url}clip.mov?hf-proxy=h264`);

    expect(proxy.status).toBe(404);
    expect(mocks.injectMediaCodecMap).not.toHaveBeenCalled();
    expect(mocks.resolveProxy).not.toHaveBeenCalled();
  });

  it("serves copies when --proxy asks for them", async () => {
    server = await serveCapturePage(hostileClipProject(), html, true);

    expect(mocks.injectMediaCodecMap).toHaveBeenCalledTimes(1);
  });
});
