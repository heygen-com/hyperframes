import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outsideAssetsAllowed } from "./receivedRender.js";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function project(record?: string): string {
  root = mkdtempSync(join(tmpdir(), "hf-received-render-"));
  for (const name of ["secret.js", "pic.png", "clip.mp4", "bg.png"]) {
    write(join(root, "outside", name), "x");
  }
  const dir = join(root, "project");
  write(
    join(dir, "index.html"),
    `<link rel="stylesheet" href="style.css">
<script src="../outside/secret.js"></script>
<script src="https://cdn.example/lib.js"></script>
<img src="../outside/pic.png"><img src="assets/in.png">
<div data-composition-src="compositions/scene.html"></div>`,
  );
  write(join(dir, "compositions", "scene.html"), `<video src="../../outside/clip.mp4"></video>`);
  write(join(dir, "style.css"), `body { background: url(../outside/bg.png); }`);
  write(join(dir, "assets", "in.png"), "x");
  if (record !== undefined) write(join(dir, ".hyperframes", "received-files.json"), record);
  return dir;
}

const received = (...files: string[]) => JSON.stringify({ files });

describe("outsideAssetsAllowed", () => {
  it("refuses outside files for a received entry and names every reference it leaves out", () => {
    const warn = vi.fn();
    expect(outsideAssetsAllowed(project(received("index.html")), undefined, warn)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("index.html came from someone else");
    expect(line).toContain("It leaves out");
    expect(line).not.toContain("compositions");
    for (const ref of [
      "../outside/secret.js",
      "../outside/pic.png",
      "../../outside/clip.mp4",
      "../outside/bg.png",
    ]) {
      expect(line).toContain(ref);
    }
    expect(line).not.toContain("assets/in.png");
    expect(line).not.toContain("cdn.example");
  });

  it("refuses outside files when the own entry plays a received composition, and names it", () => {
    const dir = project(received("compositions/scene.html"));
    for (const entry of ["compositions/scene.html", undefined]) {
      const warn = vi.fn();
      expect(outsideAssetsAllowed(dir, entry, warn)).toBe(false);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain("compositions/scene.html came from someone else");
      expect(line).toContain("../../outside/clip.mp4");
    }
  });

  it("refuses outside files when a received stylesheet is pulled in", () => {
    const warn = vi.fn();
    expect(outsideAssetsAllowed(project(received("style.css")), undefined, warn)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("style.css came from someone else"));
  });

  it("keeps outside files when the received file is one the render never opens", () => {
    const dir = project(received("unused.html"));
    write(join(dir, "unused.html"), `<img src="../outside/pic.png">`);
    const warn = vi.fn();
    expect(outsideAssetsAllowed(dir, undefined, warn)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps outside files for the person's own entry", () => {
    const warn = vi.fn();
    expect(outsideAssetsAllowed(project(received("assets/in.png")), undefined, warn)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps outside files for a project with no received-files record", () => {
    const warn = vi.fn();
    expect(outsideAssetsAllowed(project(), undefined, warn)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["{not json", "", "{}"])(
    "refuses outside files and names the record when it cannot be read: %j",
    (record) => {
      const dir = project(record);
      const warn = vi.fn();
      expect(outsideAssetsAllowed(dir, undefined, warn)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain(
        `Could not read ${join(realpathSync(dir), ".hyperframes", "received-files.json")}`,
      );
      expect(line).toContain("../outside/secret.js");
    },
  );

  it("says the render stops on a composition outside the project", () => {
    const dir = project(received("index.html"));
    write(join(dir, "..", "outside", "shared.html"), "<div></div>");
    write(join(dir, "index.html"), `<div data-composition-src="../outside/shared.html"></div>`);
    const warn = vi.fn();
    expect(outsideAssetsAllowed(dir, undefined, warn)).toBe(false);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("stops on the compositions ../outside/shared.html");
    expect(line).not.toContain("leaves out");
  });

  it("skips a stylesheet it cannot read instead of failing", () => {
    const dir = project(received("index.html"));
    rmSync(join(dir, "style.css"));
    mkdirSync(join(dir, "style.css"));
    if (process.platform !== "win32") {
      write(join(dir, "locked.css"), "body { background: url(../outside/bg.png); }");
      chmodSync(join(dir, "locked.css"), 0o000);
      write(join(dir, "index.html"), `<link href="locked.css"><img src="../outside/pic.png">`);
    }
    const warn = vi.fn();
    expect(() => outsideAssetsAllowed(dir, undefined, warn)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("../outside/pic.png"));
  });

  it("scans a long unclosed url( run in linear time", () => {
    const dir = project(received("index.html"));
    write(join(dir, "style.css"), "url(".repeat(1_000_000));
    const started = performance.now();
    outsideAssetsAllowed(dir, undefined, vi.fn());
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
