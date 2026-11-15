import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("checks the composition being rendered, not index.html", () => {
    const dir = project(received("compositions/scene.html"));
    const warn = vi.fn();
    expect(outsideAssetsAllowed(dir, "compositions/scene.html", warn)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("../../outside/clip.mp4"));
    expect(outsideAssetsAllowed(dir, undefined, warn)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
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

  it("treats an unreadable record as received", () => {
    expect(outsideAssetsAllowed(project("{not json"), undefined, vi.fn())).toBe(false);
  });
});
