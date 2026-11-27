import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GSAP_CDN_VERSION, gsapCdnDist } from "@hyperframes/core/gsap-cdn";
import { _setDownloadFetchForTests } from "@hyperframes/engine";
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

/** The host's copy of `version`, laid out as the CLI ships it: `<root>/gsap@<version>/dist`. */
const ship = (version: string, file: string, bytes: string) => {
  const at = join(root, `gsap@${version}`, "dist");
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, file), bytes);
  return at;
};

let root: string;
const realEnv = process.env[GSAP_VENDOR_DIR_ENV];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gsap-vendor-"));
  process.env[GSAP_VENDOR_DIR_ENV] = ship(GSAP_CDN_VERSION, "gsap.min.js", BYTES);
});
afterEach(() => {
  _setDownloadFetchForTests();
  if (realEnv === undefined) delete process.env[GSAP_VENDOR_DIR_ENV];
  else process.env[GSAP_VENDOR_DIR_ENV] = realEnv;
  rmSync(root, { recursive: true, force: true });
});

describe("the host's own GSAP needs no network", () => {
  // fails without the fix: with the network gone the script stayed an external tag and the render failed.
  it("inlines the default CDN's gsap.min.js from the host's copy when fetch fails", async () => {
    const fetch = failingFetch();
    _setDownloadFetchForTests(fetch);
    expect(await inlineExternalScripts(page(URL_))).toContain(BYTES);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads as before when the host ships no copy", async () => {
    delete process.env[GSAP_VENDOR_DIR_ENV];
    _setDownloadFetchForTests(mock(async () => new Response("var net = 1;")));
    expect(await inlineExternalScripts(page(URL_))).toContain("var net = 1;");
  });

  it("leaves a version the host does not ship, and a mirror's URL, to the network", async () => {
    _setDownloadFetchForTests(mock(async () => new Response("var net = 1;")));
    for (const other of [
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",
      `https://mirror.example.com/gsap@${GSAP_CDN_VERSION}/dist/gsap.min.js`,
    ]) {
      expect(await inlineExternalScripts(page(other))).toContain("var net = 1;");
    }
  });

  // fails without the fix: our caption templates write gsap@3.14.2, and with jsDelivr blocked every export failed.
  it("inlines another version the host ships, and its plugins, with no network", async () => {
    ship("3.14.2", "gsap.min.js", "var gsap = 3142;");
    ship("3.14.2", "CustomEase.min.js", "var ease = 3142;");
    const fetch = failingFetch();
    _setDownloadFetchForTests(fetch);
    const old = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/";
    const html = await inlineExternalScripts(
      `<html><body><script src="${old}gsap.min.js"></script><script src="${old}CustomEase.min.js"></script></body></html>`,
    );
    expect(html).toContain("var gsap = 3142;");
    expect(html).toContain("var ease = 3142;");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("a GSAP 3 file the CDN cannot bring", () => {
  const other = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js";

  // fails without the fix: the tag stayed external, so the render browser failed on the blocked CDN too.
  it("is inlined as the host's own GSAP", async () => {
    _setDownloadFetchForTests(failingFetch());
    expect(await inlineExternalScripts(page(other))).toContain(BYTES);
  });

  it("stays the CDN's file when the CDN answers", async () => {
    _setDownloadFetchForTests(mock(async () => new Response("var gsap = 3125;")));
    const html = await inlineExternalScripts(page(other));
    expect(html).toContain("var gsap = 3125;");
    expect(html).not.toContain(BYTES);
  });

  it("is never replaced when its tag pins its bytes, nor when it is not GSAP 3 from the default CDN", async () => {
    _setDownloadFetchForTests(failingFetch());
    for (const html of [
      page(other, ' integrity="sha384-AAAA"'),
      page("https://cdn.jsdelivr.net/npm/gsap@2.1.3/dist/gsap.min.js"),
      page("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"),
      page(`https://mirror.example.com/gsap@3.12.5/dist/gsap.min.js`),
    ]) {
      expect(await inlineExternalScripts(html)).not.toContain(BYTES);
    }
  });

  it("downloads when the host's copy fails the tag's integrity metadata", async () => {
    const fresh = "var fresh = 2;";
    const digest = `sha256-${createHash("sha256").update(fresh).digest("base64")}`;
    _setDownloadFetchForTests(mock(async () => new Response(fresh)));
    const result = await inlineExternalScripts(page(URL_, ` integrity="${digest}"`));
    expect(result).toContain(fresh);
    expect(result).not.toContain(BYTES);
  });
});
