import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import info, { orientation, durationFromHtml } from "./info.js";

describe("orientation", () => {
  it("is landscape when width > height", () => {
    expect(orientation(1920, 1080)).toBe("landscape");
  });

  it("is portrait when height > width", () => {
    expect(orientation(1080, 1920)).toBe("portrait");
  });

  it("is square when width === height", () => {
    expect(orientation(1080, 1080)).toBe("square");
  });
});

describe("durationFromHtml", () => {
  it("reads data-duration from the root composition element", () => {
    const html = `<div data-composition-id="comp" data-width="1920" data-height="1080" data-start="0" data-duration="6"></div>`;
    expect(durationFromHtml(html, 5)).toBe(6);
  });

  it("reads data-duration regardless of attribute order", () => {
    const html = `<div data-duration="8" data-composition-id="comp"></div>`;
    expect(durationFromHtml(html, 5)).toBe(8);
  });

  it("falls back to the computed timeline duration when no data-duration", () => {
    const html = `<div data-composition-id="comp"></div>`;
    expect(durationFromHtml(html, 5)).toBe(5);
  });
});

describe("info", () => {
  it.each([
    {
      name: "quoted attributes",
      html: '<div data-composition-id="main" data-width="64" data-height="96" data-duration=".2"></div>',
    },
    {
      name: "whitespace around attribute assignments",
      html: '<div data-composition-id = "main" data-width = "64" data-height\n= "96" data-duration = ".2"></div>',
    },
    {
      name: "unquoted attributes",
      html: "<div data-composition-id=main data-width=64 data-height=96 data-duration=.2></div>",
    },
    {
      name: "commented composition before the root",
      html: `<!-- <div data-composition-id="example" data-width="1920" data-height="1080" data-duration="8"></div> -->
        <div data-composition-id="main" data-width="64" data-height="96" data-duration=".2"></div>`,
    },
    {
      name: "composition markup inside a script string",
      html: `<script>const example = '<div data-composition-id="example" data-width="1920" data-height="1080" data-duration="8"></div>';</script>
        <div data-composition-id="main" data-width="64" data-height="96" data-duration=".2"></div>`,
    },
    {
      name: "explicit root after another composition",
      html: `<div data-composition-id="other" data-width="1920" data-height="1080" data-duration="8"></div>
        <div data-composition-id="main" data-root="true" data-width="64" data-height="96" data-duration=".2"></div>`,
    },
  ])("reports the root metadata with $name", async ({ html }) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-info-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      writeFileSync(join(dir, "index.html"), html);
      await info.run?.({ args: { _: [], dir, json: true }, rawArgs: [], cmd: info });

      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
        resolution: "portrait",
        width: 64,
        height: 96,
        duration: 0.2,
      });
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the inferred resolution and timeline duration when root metadata is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-info-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      writeFileSync(
        join(dir, "index.html"),
        `<html data-resolution="landscape"><body><div data-composition-id="main">
          <div class="clip" data-start="1" data-duration="2"></div>
        </div></body></html>`,
      );
      await info.run?.({ args: { _: [], dir, json: true }, rawArgs: [], cmd: info });

      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
        resolution: "landscape",
        width: 1920,
        height: 1080,
        duration: 3,
      });
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
