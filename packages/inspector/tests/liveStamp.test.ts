import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bundleToSingleHtml,
  type BundleScriptProvenance,
} from "../../core/src/compiler/htmlBundler";
import { fingerprint, prepareLiveInspection } from "../src/live";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((path: unknown, ...rest: unknown[]) =>
    path instanceof URL && path.pathname.endsWith("/inspection.js")
      ? ""
      : Reflect.apply(fs.readFileSync, fs, [path, ...rest])) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, readFileSync }, readFileSync };
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function project(html: string) {
  const dir = mkdtempSync(join(tmpdir(), "hf-live-stamp-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(join(dir, "scene.js"), "window.__scene = 1;");
  const provenance: BundleScriptProvenance[] = [];
  const bundled = await bundleToSingleHtml(dir, {
    runtime: "inline",
    scriptProvenance: (p) => provenance.push(p),
  });
  return { dir, bundled, provenance };
}

const composition = `<!doctype html><html><head><title>t</title></head><body>
<main data-composition-id="c" data-start="0" data-duration="2" data-width="1920" data-height="1080"><h1 id="t">Hi</h1></main>
<script src="scene.js"></script></body></html>`;

function stampOf(html: string): unknown {
  const window: { __hfLiveInspection?: unknown } = {};
  const script = /<head[^>]*><script>([\s\S]*?)<\/script>/i.exec(html)?.[1] ?? "";
  runInNewContext(script, { window });
  return window.__hfLiveInspection;
}

describe("prepareLiveInspection page stamp", () => {
  it("gives the page only the generation id", async () => {
    const { dir, bundled, provenance } = await project(composition);
    const live = prepareLiveInspection(dir, bundled, provenance, fingerprint(dir));
    expect(stampOf(live.html)).toEqual({ generation: live.generation });
    expect(live.html).not.toContain(dir);
    expect(live.html).not.toContain(realpathSync(dir));
    expect(live.html).not.toContain(JSON.stringify(realpathSync(dir)).slice(1, -1));
  });

  it("leaves neither the given nor the real path in the page for a symlinked project", async () => {
    const { dir, bundled, provenance } = await project(composition);
    const link = `${dir}-link`;
    symlinkSync(dir, link);
    dirs.push(link);
    const live = prepareLiveInspection(link, bundled, provenance, fingerprint(link));
    expect(stampOf(live.html)).toEqual({ generation: live.generation });
    expect(live.html).not.toContain(link);
    expect(live.html).not.toContain(realpathSync(dir));
  });

  it("keeps the authored document and a fresh generation per preparation", async () => {
    const { dir, bundled, provenance } = await project(composition);
    const version = fingerprint(dir);
    const first = prepareLiveInspection(dir, bundled, provenance, version);
    const second = prepareLiveInspection(dir, bundled, provenance, version);
    expect(first.generation).not.toBe(second.generation);
    expect(first.html).toContain(`"generation":"${first.generation}"`);
    expect(first.html).toContain('<h1 id="t">Hi</h1>');
    expect(first.html).toContain("window.__scene = 1;");
    const start = first.html.indexOf("<script>");
    const end = first.html.indexOf("</script>", start) + "</script>".length;
    expect(first.html.slice(0, start) + first.html.slice(end)).toBe(bundled);
  });

  it("still refuses a stale source version or a page without a head", async () => {
    const { dir, bundled, provenance } = await project(composition);
    expect(() => prepareLiveInspection(dir, bundled, provenance, "stale")).toThrow(
      "source_changed_during_load",
    );
    expect(() =>
      prepareLiveInspection(dir, "<html><body></body></html>", provenance, fingerprint(dir)),
    ).toThrow("preview_head_missing");
  });
});
