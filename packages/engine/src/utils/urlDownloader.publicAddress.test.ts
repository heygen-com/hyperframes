import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const answers = vi.hoisted(() => ({
  list: [] as Array<{ address: string; family: number }>,
  errorCode: undefined as string | undefined,
  hang: false,
}));
vi.mock("node:dns", () => {
  const lookup = (
    _host: string,
    _options: unknown,
    callback: (error: NodeJS.ErrnoException | null, addresses: typeof answers.list) => void,
  ) =>
    answers.hang
      ? undefined
      : answers.errorCode
        ? callback(Object.assign(new Error("lookup failed"), { code: answers.errorCode }), [])
        : callback(null, answers.list);
  return { default: { lookup }, lookup };
});

import { downloadToTemp, fetchPublicHttpsText, UrlDownloadError } from "./urlDownloader.js";

const dirs: string[] = [];
afterEach(() => {
  answers.errorCode = undefined;
  answers.hang = false;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

  function useEnvProxy() {
    vi.stubEnv("HTTPS_PROXY", "http://proxy.test:3128");
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    const viaProxy = vi.fn(async () => new Response("<html></html>"));
    vi.stubGlobal("fetch", viaProxy);
    return viaProxy;
  }

  it.each([
    ["a NO_PROXY host", { NO_PROXY: "corp.example.test" }],
    ["a proxied host", {}],
  ])("refuses %s that resolves to a private address behind an env proxy", async (_, env) => {
    answers.list = [{ address: "10.1.2.3", family: 4 }];
    const viaProxy = useEnvProxy();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const dir = mkdtempSync(join(tmpdir(), "hf-public-address-"));
    dirs.push(dir);
    const error = await downloadToTemp("https://jira.corp.example.test/a.gif", dir).catch((e) => e);
    expect(error).toBeInstanceOf(UrlDownloadError);
    expect(error).toMatchObject({ kind: "http_rejected", retryable: false });
    expect(viaProxy).not.toHaveBeenCalled();
  });

  it("goes through the env proxy for a host that resolves to a public address", async () => {
    answers.list = [{ address: "93.184.216.34", family: 4 }];
    const viaProxy = useEnvProxy();
    await expect(
      fetchPublicHttpsText("https://assets.example.test/x.html", { maxBytes: 1024 }),
    ).resolves.toBe("<html></html>");
    expect(viaProxy).toHaveBeenCalledOnce();
  });

  it("ends a proxied download whose local lookup never answers when the request times out", async () => {
    answers.hang = true;
    const viaProxy = useEnvProxy();
    await expect(
      fetchPublicHttpsText("https://assets.example.test/x.html", { maxBytes: 1024, timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(viaProxy).not.toHaveBeenCalled();
  });

  it.each(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"])(
    "leaves a name this machine cannot resolve (%s) to the env proxy",
    async (code) => {
      answers.errorCode = code;
      const viaProxy = useEnvProxy();
      await expect(
        fetchPublicHttpsText("https://assets.example.test/x.html", { maxBytes: 1024 }),
      ).resolves.toBe("<html></html>");
      expect(viaProxy).toHaveBeenCalledOnce();
    },
  );

  it("leaves a name this machine cannot resolve to the env proxy", async () => {
    answers.errorCode = "ENOTFOUND";
    const viaProxy = useEnvProxy();
    await expect(
      fetchPublicHttpsText("https://assets.example.test/x.html", { maxBytes: 1024 }),
    ).resolves.toBe("<html></html>");
    expect(viaProxy).toHaveBeenCalledOnce();
  });
});
