import { expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types";

const pageParses = vi.hoisted(() => ({ count: 0, minLength: Infinity }));
vi.mock("linkedom", async (actual) => {
  const real = await actual<typeof import("linkedom")>();
  return {
    ...real,
    parseHTML: (html: string, ...rest: unknown[]) => {
      if (html.length >= pageParses.minLength) pageParses.count += 1;
      return (real.parseHTML as (...args: unknown[]) => ReturnType<typeof real.parseHTML>)(
        html,
        ...rest,
      );
    },
  };
});

const { registerPreviewRoutes } = await import("./preview");

it("parses a stamped page once per preview build (the read-tracking walk) when it has no images, <base> or scene parts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-preview-parses-"));
  try {
    const shapes = Array.from(
      { length: 200 },
      (_, i) => `<path data-hf-id="hf-p${i}" d="M${i} 0h1v1z"/>`,
    );
    const page =
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body>` +
      `<div data-hf-id="hf-root" data-composition-id="main"><svg data-hf-id="hf-svg">${shapes.join("")}</svg></div>` +
      `</body></html>`;
    writeFileSync(join(dir, "index.html"), page);
    const adapter = {
      listProjects: () => [],
      resolveProject: async (id: string) => ({ id, dir }),
      bundle: async () => page,
      lint: async () => ({ findings: [] }),
      runtimeUrl: "/api/runtime.js",
      rendersDir: () => "/tmp/renders",
      startRender: () => ({
        id: "job",
        status: "rendering",
        progress: 0,
        outputPath: "/tmp/out.mp4",
      }),
    } as unknown as StudioApiAdapter;
    const app = new Hono();
    registerPreviewRoutes(app, adapter);
    pageParses.minLength = page.length / 2;

    const response = await app.request("http://localhost/projects/demo/preview");

    expect(response.status).toBe(200);
    expect(pageParses.count).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
