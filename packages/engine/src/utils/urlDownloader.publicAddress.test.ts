import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const answers = vi.hoisted(() => ({ list: [] as Array<{ address: string; family: number }> }));
vi.mock("node:dns", () => {
  const lookup = (
    _host: string,
    _options: unknown,
    callback: (error: null, addresses: typeof answers.list) => void,
  ) => callback(null, answers.list);
  return { default: { lookup }, lookup };
});

import { downloadToTemp, fetchPublicHttpsText, UrlDownloadError } from "./urlDownloader.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("downloads refuse hosts that resolve to private addresses", () => {
  it.each([
    ["a private IPv4 answer", [{ address: "10.1.2.3", family: 4 }]],
    [
      "a link-local answer among public ones",
      [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    ],
    ["a loopback IPv6 answer", [{ address: "::1", family: 6 }]],
  ])("downloadToTemp rejects %s without retrying", async (_, list) => {
    answers.list = list;
    const dir = mkdtempSync(join(tmpdir(), "hf-public-address-"));
    dirs.push(dir);
    const error = await downloadToTemp("https://assets.example.test/a.png", dir).catch((e) => e);
    expect(error).toBeInstanceOf(UrlDownloadError);
    expect(error).toMatchObject({ kind: "http_rejected", retryable: false });
  });

  it("fetchPublicHttpsText rejects the same way", async () => {
    answers.list = [{ address: "192.168.0.7", family: 4 }];
    await expect(
      fetchPublicHttpsText("https://assets.example.test/x.html", { maxBytes: 1024 }),
    ).rejects.toMatchObject({
      kind: "http_rejected",
    });
  });

  it("keeps Node's own fetch when it goes through an env proxy, which resolves the name", async () => {
    answers.list = [{ address: "10.1.2.3", family: 4 }];
    vi.stubEnv("HTTPS_PROXY", "http://proxy.test:3128");
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    const viaProxy = vi.fn(async () => new Response("<html></html>"));
    vi.stubGlobal("fetch", viaProxy);
    try {
      await expect(
        fetchPublicHttpsText("https://assets.example.test/x.html", { maxBytes: 1024 }),
      ).resolves.toBe("<html></html>");
      expect(viaProxy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
