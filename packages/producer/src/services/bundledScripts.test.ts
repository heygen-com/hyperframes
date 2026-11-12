import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gsapCdnDist } from "@hyperframes/core/gsap-cdn";
import { inlineExternalScripts } from "./htmlCompiler.js";
import { GSAP_VENDOR_DIR_ENV } from "./bundledScripts.js";

const URL_ = `${gsapCdnDist()}gsap.min.js`;
const BYTES = "var gsap = 1;";
const page = (src: string, extra = "") =>
  `<html><body><script src="${src}"${extra}></script></body></html>`;
const failingFetch = () =>
  mock(async () => {
    throw new TypeError("net::ERR_INTERNET_DISCONNECTED");
  }) as unknown as typeof fetch;

let dir: string;
const realFetch = globalThis.fetch;
const realEnv = process.env[GSAP_VENDOR_DIR_ENV];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gsap-vendor-"));
  writeFileSync(join(dir, "gsap.min.js"), BYTES);
  process.env[GSAP_VENDOR_DIR_ENV] = dir;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realEnv === undefined) delete process.env[GSAP_VENDOR_DIR_ENV];
  else process.env[GSAP_VENDOR_DIR_ENV] = realEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe("the host's own GSAP needs no network", () => {
  // fails without the fix: with the network gone the script stayed an external tag and the render failed.
  it("inlines the default CDN's gsap.min.js from the host's copy when fetch fails", async () => {
    globalThis.fetch = failingFetch();
    expect(await inlineExternalScripts(page(URL_))).toContain(BYTES);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("downloads as before when the host ships no copy", async () => {
    delete process.env[GSAP_VENDOR_DIR_ENV];
    globalThis.fetch = mock(async () => new Response("var net = 1;")) as unknown as typeof fetch;
    expect(await inlineExternalScripts(page(URL_))).toContain("var net = 1;");
  });

  it("leaves any other URL, including a mirror's, to the network", async () => {
    globalThis.fetch = mock(async () => new Response("var net = 1;")) as unknown as typeof fetch;
    for (const other of [
      "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js",
      "https://mirror.example.com/gsap@3.15.0/dist/gsap.min.js",
    ]) {
      expect(await inlineExternalScripts(page(other))).toContain("var net = 1;");
    }
  });

  it("downloads when the host's copy fails the tag's integrity metadata", async () => {
    const fresh = "var fresh = 2;";
    const digest = `sha256-${createHash("sha256").update(fresh).digest("base64")}`;
    globalThis.fetch = mock(async () => new Response(fresh)) as unknown as typeof fetch;
    const result = await inlineExternalScripts(page(URL_, ` integrity="${digest}"`));
    expect(result).toContain(fresh);
    expect(result).not.toContain(BYTES);
  });
});
