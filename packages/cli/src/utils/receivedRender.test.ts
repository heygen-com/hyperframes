import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  write(join(dir, "unused.html"), `<img src="../outside/pic.png">`);
  if (record !== undefined) write(join(dir, ".hyperframes", "received-files.json"), record);
  return dir;
}

const received = (...files: string[]) => JSON.stringify({ files });

async function decide(dir: string, entry?: string) {
  const warn = vi.fn();
  const allowed = await outsideAssetsAllowed(dir, entry, warn);
  return { allowed, warn, line: String(warn.mock.calls[0]?.[0] ?? "") };
}

describe("outsideAssetsAllowed", () => {
  it("refuses outside files for a received entry and names every reference it leaves out", async () => {
    const { allowed, warn, line } = await decide(project(received("index.html")));
    expect(allowed).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
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

  it("refuses outside files when the own entry plays a received composition, and names it", async () => {
    const dir = project(received("compositions/scene.html"));
    for (const entry of ["compositions/scene.html", undefined]) {
      const { allowed, line } = await decide(dir, entry);
      expect(allowed).toBe(false);
      expect(line).toContain("compositions/scene.html came from someone else");
    }
  });

  it("refuses outside files when a linked stylesheet was received", async () => {
    const { allowed, line } = await decide(project(received("style.css")));
    expect(allowed).toBe(false);
    expect(line).toContain("style.css came from someone else");
  });

  it("refuses outside files when a stylesheet @imports a received stylesheet", async () => {
    const dir = project(received("theme.css"));
    write(join(dir, "style.css"), `@import "theme.css";\nbody { color: red; }`);
    write(join(dir, "theme.css"), `body { background: url(../outside/bg.png); }`);
    const { allowed } = await decide(dir);
    expect(allowed).toBe(false);
  });

  it("refuses outside files when a received composition sits past the scan limit", async () => {
    const dir = project(received("compositions/scene.html"));
    write(
      join(dir, "index.html"),
      `<p>${"a".repeat(2_200_000)}</p><div data-composition-src="compositions/scene.html"></div>`,
    );
    const { allowed, line } = await decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain("compositions/scene.html came from someone else");
  });

  it("keeps outside files when the received file is one the render never opens", async () => {
    const { allowed, warn } = await decide(project(received("unused.html")));
    expect(allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps outside files when the record lists no files", async () => {
    expect((await decide(project(received()))).allowed).toBe(true);
  });

  it("keeps outside files for a project with no received-files record", async () => {
    const { allowed, warn } = await decide(project());
    expect(allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== "win32")(
    "renders an owned project with a symlink loop normally",
    async () => {
      const dir = project();
      symlinkSync("loop", join(dir, "loop"));
      write(
        join(dir, "index.html"),
        `<link rel="stylesheet" href="loop/a.css"><a href="loop">x</a>`,
      );
      expect((await decide(dir)).allowed).toBe(true);
      write(join(dir, ".hyperframes", "received-files.json"), received("unused.html"));
      await expect(decide(dir)).resolves.toMatchObject({ allowed: true });
    },
  );

  it.each(["{not json", "", "{}"])(
    "refuses outside files and names the record when it cannot be read: %j",
    async (record) => {
      const dir = project(record);
      const { allowed, warn, line } = await decide(dir);
      expect(allowed).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(line).toContain(
        `Could not read ${join(realpathSync(dir), ".hyperframes", "received-files.json")}`,
      );
      expect(line).toContain("../outside/secret.js");
    },
  );

  it("says the render stops on a composition outside the project", async () => {
    const dir = project(received("index.html"));
    write(join(dir, "..", "outside", "shared.html"), "<div></div>");
    write(join(dir, "index.html"), `<div data-composition-src="../outside/shared.html"></div>`);
    const { allowed, line } = await decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain("stops on the compositions ../outside/shared.html");
  });

  it.runIf(process.platform !== "win32")(
    "skips a stylesheet it cannot read instead of failing",
    async () => {
      const dir = project(received("index.html"));
      write(join(dir, "locked.css"), "body { background: url(../outside/bg.png); }");
      chmodSync(join(dir, "locked.css"), 0o000);
      write(join(dir, "index.html"), `<link href="locked.css"><img src="../outside/pic.png">`);
      const { allowed, line } = await decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain("../outside/pic.png");
    },
  );

  it("refuses outside files when the compiler cannot say what it reads", async () => {
    const { allowed, line } = await decide(project(received("index.html")), "missing.html");
    expect(allowed).toBe(false);
    expect(line).toContain("Could not tell which files missing.html reads");
  });

  it("scans a long unclosed url( run in linear time", async () => {
    const dir = project("{not json");
    write(join(dir, "style.css"), "url(".repeat(1_000_000));
    const started = performance.now();
    await decide(dir);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
