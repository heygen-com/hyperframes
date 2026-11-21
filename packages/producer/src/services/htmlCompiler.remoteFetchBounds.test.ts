import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gsapCdnDist } from "@hyperframes/core/gsap-cdn";
import { _setDownloadFetchForTests } from "@hyperframes/engine";
import { bundledScript, GSAP_VENDOR_DIR_ENV } from "./bundledScripts.js";
import {
  compileForRender,
  inlineExternalScripts,
  localizeRemoteFontFaces,
  MAX_REMOTE_FETCHES,
  REMOTE_FETCH_DEADLINE_MS,
} from "./htmlCompiler.js";

// The real loader, counted: how many times a compile reads the host's own copy.
vi.mock("./bundledScripts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./bundledScripts.js")>();
  return { ...real, bundledScript: vi.fn(real.bundledScript) };
});

/** Answers each request after `holdMs` unless its signal aborts first; records both. */
function serve(body: string, { holdMs = 0, onRequest = () => {} } = {}) {
  const seen = { requests: [] as string[], aborted: 0 };
  _setDownloadFetchForTests(async (url: string, init?: RequestInit) => {
    seen.requests.push(url);
    onRequest();
    await new Promise<void>((resolve) => {
      const stop = () => {
        clearTimeout(timer);
        seen.aborted += 1;
        resolve();
      };
      const timer = setTimeout(resolve, holdMs);
      if (init?.signal?.aborted) stop();
      else init?.signal?.addEventListener("abort", stop);
    });
    init?.signal?.throwIfAborted();
    return new Response(body);
  });
  return seen;
}

const urls = (count: number, ext: string) =>
  Array.from({ length: count }, (_, i) => `https://cdn.example.com/f${i}.${ext}`);
const scriptTags = (srcs: string[]) =>
  `<html><body>${srcs.map((src) => `<script src="${src}"></script>`).join("")}</body></html>`;
const linkTags = (hrefs: string[]) =>
  hrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n");
const FONT_CSS = '@font-face { font-family: "F"; src: local("F"); }';

function project(head: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-remote-fetch-"));
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><head>${head}</head><body>
  <div data-composition-id="root" data-width="320" data-height="180" data-duration="1"></div>
</body></html>`,
  );
  return dir;
}

const realVendorDir = process.env[GSAP_VENDOR_DIR_ENV];
afterEach(() => {
  _setDownloadFetchForTests();
  vi.restoreAllMocks();
  if (realVendorDir === undefined) delete process.env[GSAP_VENDOR_DIR_ENV];
  else process.env[GSAP_VENDOR_DIR_ENV] = realVendorDir;
});
const deadlineStarts = () =>
  vi.mocked(AbortSignal.timeout).mock.calls.filter(([ms]) => ms === REMOTE_FETCH_DEADLINE_MS)
    .length;

describe("remote downloads at compile time", () => {
  // fails without the fix: every distinct address was downloaded, however many.
  it("refuses more distinct remote scripts than it downloads, before any request", async () => {
    const seen = serve("void 0;");
    await expect(
      inlineExternalScripts(scriptTags(urls(MAX_REMOTE_FETCHES + 1, "js"))),
    ).rejects.toThrow(`links ${MAX_REMOTE_FETCHES + 1} remote scripts`);
    expect(seen.requests).toEqual([]);
  });

  // fails without the fix: the host's copy that fails its tag's integrity is downloaded but was not counted.
  it("counts a bundled script whose integrity sends it to the network", async () => {
    const vendor = mkdtempSync(join(tmpdir(), "hf-gsap-vendor-"));
    writeFileSync(join(vendor, "gsap.min.js"), "var gsap = 1;");
    process.env[GSAP_VENDOR_DIR_ENV] = vendor;
    const seen = serve("void 0;");
    const html = scriptTags(urls(MAX_REMOTE_FETCHES, "js")).replace(
      "<body>",
      `<body><script src="${gsapCdnDist()}gsap.min.js" integrity="sha384-YQ=="></script>`,
    );
    await expect(inlineExternalScripts(html)).rejects.toThrow(
      `links ${MAX_REMOTE_FETCHES + 1} remote scripts`,
    );
    expect(seen.requests).toEqual([]);
  });

  // fails without the fix: each tag read and held its own copy of the host's bytes before any charge.
  it("reads the host's copy of a script once however many tags name it", async () => {
    const vendor = mkdtempSync(join(tmpdir(), "hf-gsap-vendor-"));
    writeFileSync(join(vendor, "gsap.min.js"), "var gsap = 1;");
    process.env[GSAP_VENDOR_DIR_ENV] = vendor;
    vi.mocked(bundledScript).mockClear();
    const tag = `<script src="${gsapCdnDist()}gsap.min.js"></script>`;

    const inlined = await inlineExternalScripts(`<html><body>${tag.repeat(5)}</body></html>`);

    expect(vi.mocked(bundledScript)).toHaveBeenCalledTimes(1);
    expect(inlined.match(/var gsap = 1;/g)).toHaveLength(5);
  });

  // fails without the fix: every distinct stylesheet was downloaded, however many.
  it("refuses more distinct remote font stylesheets than it downloads, before any request", async () => {
    const seen = serve(FONT_CSS);
    await expect(
      localizeRemoteFontFaces(linkTags(urls(MAX_REMOTE_FETCHES + 1, "css")), tmpdir()),
    ).rejects.toThrow(`links ${MAX_REMOTE_FETCHES + 1} remote stylesheets`);
    expect(seen.requests).toEqual([]);
  });

  // fails without the fix: the downloads ignored the deadline and ran to their own timeouts.
  it("stops pending script downloads once its time is up and leaves their tags", async () => {
    const deadline = new AbortController();
    const seen = serve("void 0;", { holdMs: 2_000, onRequest: () => deadline.abort() });
    const html = scriptTags(urls(8, "js"));

    const inlined = await inlineExternalScripts(html, undefined, deadline.signal);

    expect(seen.aborted).toBeGreaterThan(0);
    expect(seen.requests.length).toBeLessThan(8);
    expect(inlined.match(/<script src=/g)).toHaveLength(8);
  });

  // fails without the fix: compile kept downloading after the render was cancelled.
  it.each([
    ["a script", '<script src="https://cdn.example.com/a.js"></script>', "void 0;"],
    ["a font stylesheet", '<link rel="stylesheet" href="https://cdn.example.com/a.css">', FONT_CSS],
  ])("stops a compile whose render is cancelled while it downloads %s", async (_, head, body) => {
    const cancel = new AbortController();
    const seen = serve(body, {
      holdMs: 2_000,
      onRequest: () => cancel.abort(new Error("cancelled")),
    });
    const dir = project(head);

    await expect(
      compileForRender(dir, join(dir, "index.html"), dir, { abortSignal: cancel.signal }),
    ).rejects.toThrow("cancelled");
    expect(seen.aborted).toBe(1);
  });

  // fails without the fix: the shared deadline started when compile began, downloads or not.
  it("starts the shared deadline with the first download, never for a page without one", async () => {
    vi.spyOn(AbortSignal, "timeout");
    let startsAtRequest = -1;
    serve("void 0;", { onRequest: () => (startsAtRequest = deadlineStarts()) });
    const local = project("");
    await compileForRender(local, join(local, "index.html"), local);
    expect(deadlineStarts()).toBe(0);

    const remote = project('<script src="https://cdn.example.com/a.js"></script>');
    await compileForRender(remote, join(remote, "index.html"), remote);
    expect([startsAtRequest, deadlineStarts()]).toEqual([1, 1]);
  });
});
