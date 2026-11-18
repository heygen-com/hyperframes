import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRenderRefusal } from "../services/publicNetwork/captureProxy.js";
import { getFfmpegBinary } from "./ffmpegBinaries.js";
import { declareContentAddressedUrl, runFfprobe } from "./ffprobe.js";
import { runFfmpeg } from "./runFfmpeg.js";
import { urlInputArgs, withPublicOnlyProxy } from "./urlInput.js";

const HAS_FF = spawnSync(getFfmpegBinary(), ["-version"]).status === 0;
const HAS_CA_BUNDLE = (() => {
  try {
    return urlInputArgs("https://example.com/clip.mp4").length > 0;
  } catch {
    return false;
  }
})();

/** A local service the render must never reach: it counts every request it gets. */
async function localService(): Promise<{ server: Server; url: string; hits: () => number }> {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/clip.mp4`, hits: () => hits };
}

function refusals(): { classes: string[]; stop: () => void } {
  const classes: string[] = [];
  const stop = onRenderRefusal((hostClass) => classes.push(hostClass));
  return { classes, stop };
}

describe("media inputs with PRODUCER_RESTRICT_PAGE_NETWORK on", () => {
  beforeEach(() => vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "true"));
  afterEach(() => vi.unstubAllEnvs());

  // fails without the fix: an http input got no protocol limit and no proxy, so ffprobe fetched the local service.
  it.skipIf(!HAS_FF)("never lets ffprobe reach a local address", { timeout: 60_000 }, async () => {
    const service = await localService();
    const seen = refusals();
    try {
      await expect(runFfprobe(service.url, ["-show_format"])).rejects.toThrow();
      expect(service.hits()).toBe(0);
      expect(seen.classes).toContain("loopback");
    } finally {
      seen.stop();
      service.server.close();
    }
  });

  // fails without the fix: ffmpeg was handed the URL directly, with no public-only proxy in front of it.
  it.skipIf(!HAS_FF)("refuses the cloud metadata address", { timeout: 60_000 }, async () => {
    const seen = refusals();
    try {
      await expect(
        runFfprobe("http://169.254.169.254/latest/meta-data/", ["-show_format"]),
      ).rejects.toThrow();
      expect(seen.classes).toContain("link-local");
    } finally {
      seen.stop();
    }
  });

  // Without a CA bundle (Windows) an https input is refused before ffmpeg starts.
  it.skipIf(!HAS_FF || !HAS_CA_BUNDLE)(
    "refuses a private https host",
    { timeout: 60_000 },
    async () => {
      const seen = refusals();
      try {
        await expect(runFfprobe("https://10.0.0.1/clip.mp4", ["-show_format"])).rejects.toThrow();
        expect(seen.classes).toContain("private");
      } finally {
        seen.stop();
      }
    },
  );

  // fails without the fix: a read that skips urlInputArgs handed its URL to ffmpeg as is.
  it.skipIf(!HAS_FF)(
    "puts the proxy in front of a URL any ffmpeg read names",
    { timeout: 60_000 },
    async () => {
      const service = await localService();
      try {
        const result = await runFfmpeg(["-i", service.url, "-f", "null", "-"]);
        expect(result.success).toBe(false);
        expect(service.hits()).toBe(0);
      } finally {
        service.server.close();
      }
    },
  );

  it("refuses a URL scheme other than http and https", () => {
    for (const input of [
      "rtsp://10.0.0.1/live",
      "ftp://10.0.0.1/a.mp4",
      "concat:/a.mp4|/b.mp4",
      "data:,x",
      "subfile,,start,0,end,0,,:https://10.0.0.1/a.mp4",
    ])
      expect(() => urlInputArgs(input)).toThrow(/not read with a restricted page network/);
  });

  // fails without the fix: FFmpeg before 4.4 ignores -http_proxy for https and reads only the http_proxy variable.
  it("gives the child the proxy in http_proxy too, and no no_proxy", async () => {
    vi.stubEnv("no_proxy", "10.0.0.1");
    vi.stubEnv("NO_PROXY", "10.0.0.1");
    const routed = await withPublicOnlyProxy(["-i", "https://10.0.0.1/clip.mp4"], [1]);
    try {
      const proxy = routed!.args[routed!.args.indexOf("-http_proxy") + 1];
      expect(proxy).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(routed!.env.http_proxy).toBe(proxy);
      expect(routed!.env).not.toHaveProperty("no_proxy");
      expect(routed!.env).not.toHaveProperty("NO_PROXY");
    } finally {
      await routed?.close();
    }
  });

  it("reads a local file and a URL the render declared as before, with no proxy", () => {
    expect(urlInputArgs("/renders/clip.mp4")).not.toContain("-protocol_whitelist");
    expect(urlInputArgs("C:\\renders\\clip.mp4")).not.toContain("-protocol_whitelist");
    const declared = "https://bucket.s3.amazonaws.com/renders/abc.mp4";
    declareContentAddressedUrl(declared, "a".repeat(64));
    const args = urlInputArgs(`${declared}?X-Amz-Signature=deadbeef`, {
      caBundles: [import.meta.filename],
    });
    expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("https,tls,tcp");
    expect(args).not.toContain("-http_proxy");
  });
});
