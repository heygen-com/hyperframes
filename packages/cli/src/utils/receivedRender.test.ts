import { realpath } from "@hyperframes/core/safe-path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileForRender } from "../../../producer/src/services/htmlCompiler.js";
import { outsideAssetsAllowed } from "./receivedRender.js";
import { terminalText } from "@hyperframes/core";

const walk = vi.hoisted(() => ({ maxEntries: undefined as number | undefined }));

vi.mock("./walkBudget.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./walkBudget.js")>();
  const capped = (max: number) => {
    let seen = 0;
    return (entries: number) => (seen += entries) <= max;
  };
  return {
    walkBudget: () => (walk.maxEntries === undefined ? real.walkBudget() : capped(walk.maxEntries)),
  };
});

const SIGNATURES = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]),
  mp4: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom\0\0\0\0")]),
  mp3: Buffer.from("ID3\u0004\0\0\0\0\0\0"),
  woff2: Buffer.from("wOF2\0\u0001\0\0\0\0\0\0"),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
};

let root: string | undefined;

afterEach(() => {
  walk.maxEntries = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function write(path: string, text: string | Buffer): void {
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
  write(join(dir, "assets", "in.png"), SIGNATURES.png);
  write(join(dir, "unused.html"), `<img src="../outside/pic.png">`);
  if (record !== undefined) write(join(dir, ".hyperframes", "received-files.json"), record);
  return dir;
}

const received = (...files: string[]) => JSON.stringify({ files });

function caseInsensitiveDisk(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "hf-case-probe-"));
  try {
    return existsSync(probe.toUpperCase()) && existsSync(probe.toLowerCase());
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

const SOMEONE_ELSE = "came from someone else and is not a media, font or image file";

function decide(dir: string, entry?: string) {
  const warn = vi.fn();
  const allowed = outsideAssetsAllowed(dir, entry, warn);
  return { allowed, warn, line: String(warn.mock.calls[0]?.[0] ?? "") };
}

describe("outsideAssetsAllowed", () => {
  it("refuses outside files for a received entry and names every reference it leaves out", () => {
    const { allowed, warn, line } = decide(project(received("index.html")));
    expect(allowed).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(line).toContain(SOMEONE_ELSE);
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
      const { allowed, line } = decide(dir, entry);
      expect(allowed).toBe(false);
      expect(line).toContain(SOMEONE_ELSE);
    }
  });

  it("refuses outside files when a linked stylesheet was received", () => {
    const { allowed, line } = decide(project(received("style.css")));
    expect(allowed).toBe(false);
    expect(line).toContain(SOMEONE_ELSE);
  });

  it("refuses outside files when a stylesheet @imports a received stylesheet", () => {
    const dir = project(received("theme.css"));
    write(join(dir, "style.css"), `@import "theme.css";\nbody { color: red; }`);
    write(join(dir, "theme.css"), `body { background: url(../outside/bg.png); }`);
    const { allowed } = decide(dir);
    expect(allowed).toBe(false);
  });

  it("refuses outside files when a received composition sits past the scan limit", () => {
    const dir = project(received("compositions/scene.html"));
    write(
      join(dir, "index.html"),
      `<p>${"a".repeat(2_200_000)}</p><div data-composition-src="compositions/scene.html"></div>`,
    );
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain(SOMEONE_ELSE);
  });

  it("refuses outside files whenever the record lists a file, even one the render never opens", () => {
    const { allowed, line } = decide(project(received("unused.html")));
    expect(allowed).toBe(false);
    expect(line).toContain(SOMEONE_ELSE);
    expect(line).toContain("../outside/secret.js");
  });

  it.each([
    ["an image", "assets/in.png", SIGNATURES.png],
    ["a JPEG", "media/photo.jpg", SIGNATURES.jpg],
    ["a video", "media/clip.mp4", SIGNATURES.mp4],
    ["audio", "media/voice.mp3", SIGNATURES.mp3],
    ["a font", "fonts/brand.woff2", SIGNATURES.woff2],
  ])("keeps outside files when only %s was received", (_kind, file, bytes) => {
    const dir = project(received(file));
    write(join(dir, file), bytes);
    const { allowed, warn } = decide(dir);
    expect(allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a media name over HTML", "media/clip.mp4", "<div data-composition-id='x'></div>"],
    ["an image name over a script", "assets/in.png", "window.x = 1;"],
    ["UTF-16 HTML under an unknown name", "scene.dat", Buffer.from("\uFEFF<div></div>", "utf16le")],
    ["an empty media file", "media/empty.mp4", ""],
  ])("refuses outside files for %s", (_kind, file, content) => {
    const dir = project(received(file));
    write(join(dir, file), content);
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain(SOMEONE_ELSE);
  });

  it("refuses outside files when a listed media file is missing", () => {
    expect(decide(project(received("media/gone.mp4"))).allowed).toBe(false);
  });

  it("keeps a received entry listed by an ancestor record for a decomposed-Unicode subfolder", () => {
    root = mkdtempSync(join(tmpdir(), "hf-received-render-"));
    write(join(root, "outside", "pic.png"), SIGNATURES.png);
    const nfd = "Su\u0308bfolder";
    const dir = join(root, nfd);
    write(join(dir, "index.html"), `<img src="../outside/pic.png">`);
    write(
      join(root, ".hyperframes", "received-files.json"),
      received(`${nfd.normalize("NFC")}/index.html`),
    );
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain("../outside/pic.png");
  });

  it.each([
    ["HTML", "notes.txt", "<div><img src='../outside/pic.png'></div>"],
    ["CSS", "theme.dat", "body { background: url(../outside/bg.png); }"],
    ["SVG", "logo.img", "<?xml version='1.0'?><svg></svg>"],
  ])("refuses outside files when a received file sniffs as %s", (_kind, file, text) => {
    const dir = project(received(file));
    write(join(dir, file), text);
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain(`${file} ${SOMEONE_ELSE}`);
  });

  it("refuses outside files when an outer record lists received HTML under an empty nested record", () => {
    root = mkdtempSync(join(tmpdir(), "hf-received-render-"));
    write(join(root, "outside", "pic.png"), SIGNATURES.png);
    const dir = join(root, "sub");
    write(join(dir, "index.html"), `<img src="../outside/pic.png">`);
    write(join(dir, ".hyperframes", "received-files.json"), received());
    write(join(root, ".hyperframes", "received-files.json"), received("sub/index.html"));
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain(`index.html ${SOMEONE_ELSE}`);
  });

  it.each([
    ["a folder", (path: string) => mkdirSync(path, { recursive: true })],
    ["a dangling link", (path: string) => symlinkSync(join(path, "..", "gone.json"), path)],
  ])("refuses outside files when an ancestor's record path holds %s", (_kind, place) => {
    root = mkdtempSync(join(tmpdir(), "hf-received-render-"));
    write(join(root, "outside", "pic.png"), SIGNATURES.png);
    const dir = join(root, "sub");
    write(join(dir, "index.html"), `<img src="../outside/pic.png">`);
    mkdirSync(join(root, ".hyperframes"));
    place(join(root, ".hyperframes", "received-files.json"));
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain("Could not read");
  });

  it.skipIf(!caseInsensitiveDisk())(
    "refuses outside files for a received subfolder named in another letter case",
    () => {
      root = mkdtempSync(join(tmpdir(), "hf-received-render-"));
      write(join(root, "outside", "pic.png"), SIGNATURES.png);
      write(join(root, "Scenes", "Intro", "index.html"), `<img src="../../outside/pic.png">`);
      write(join(root, ".hyperframes", "received-files.json"), received("Scenes/Intro/index.html"));
      const { allowed, line } = decide(join(root, "scenes", "intro"));
      expect(allowed).toBe(false);
      expect(line).toContain(`index.html ${SOMEONE_ELSE}`);
    },
  );

  it("keeps outside files when the record lists no files", () => {
    expect(decide(project(received())).allowed).toBe(true);
  });

  it("refuses outside files for a received entry that an emptied record lost, as the host's kept copy shows", () => {
    const dir = project(received());
    const state = join(root as string, "state.json");
    writeFileSync(state, JSON.stringify({ projects: [{ path: dir, received: "expected" }] }));
    const kept = { project: dir, identity: null, files: ["index.html", "style.css"], seenAt: 1 };
    const name = `${createHash("sha256").update(dir).digest("hex")}.json`;
    write(join(root as string, "received-records", name), JSON.stringify(kept));
    vi.stubEnv("HYPERFRAMES_RECEIVED_STATE_FILE", state);
    try {
      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain(`index.html ${SOMEONE_ELSE}`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps outside files for an empty record in a project with more files than a walk may list", () => {
    walk.maxEntries = 10;
    const dir = project(received());
    const many = join(dir, "node_modules");
    mkdirSync(many);
    for (let i = 0; i <= 10; i++) writeFileSync(join(many, `f${i}`), "");
    const { allowed, warn } = decide(dir);
    expect(allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  describe("a received project copied into a folder of the project", () => {
    const NESTED = join("compositions", "x");
    function withNested(record?: string, files: Record<string, string | Buffer> = {}): string {
      const dir = project();
      write(
        join(dir, "index.html"),
        `<div data-composition-src="compositions/x/index.html"></div>`,
      );
      write(join(dir, NESTED, "index.html"), `<img src="../../../outside/pic.png">`);
      for (const [name, content] of Object.entries(files)) write(join(dir, NESTED, name), content);
      if (record !== undefined)
        write(join(dir, NESTED, ".hyperframes", "received-files.json"), record);
      return dir;
    }

    it("refuses outside files and names what it leaves out", () => {
      const { allowed, warn, line } = decide(withNested(received("index.html")));
      expect(allowed).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(line).toContain(`${join(NESTED, "index.html")} ${SOMEONE_ELSE}`);
      expect(line).toContain("../../../outside/pic.png");
    });

    it("refuses outside files when the copy's entry is the rendered composition", () => {
      const entry = "compositions/x/index.html";
      const { allowed, line } = decide(withNested(received("index.html")), entry);
      expect(allowed).toBe(false);
      expect(line).toContain(SOMEONE_ELSE);
      expect(line).toContain("../../../outside/pic.png");
    });

    it("keeps outside files when the copy's record lists only media", () => {
      const dir = withNested(received("clip.mp4"), { "clip.mp4": SIGNATURES.mp4 });
      const { allowed, warn } = decide(dir);
      expect(allowed).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it("refuses outside files and names the copy's record when it cannot be read", () => {
      const dir = withNested("{not json");
      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      const path = join(realpath(dir), NESTED, ".hyperframes", "received-files.json");
      expect(line).toContain(`Could not read ${path}`);
    });

    it.each(["renders/x", "dist", ".next/x", "coverage/x", ".hyperframes/requests/x"])(
      "refuses outside files when the copy sits in %s",
      (folder) => {
        const dir = project();
        write(join(dir, "index.html"), `<div data-composition-src="${folder}/index.html"></div>`);
        const up = "../".repeat(folder.split("/").length + 1);
        write(join(dir, folder, "index.html"), `<img src="${up}outside/pic.png">`);
        write(join(dir, folder, ".hyperframes", "received-files.json"), received("index.html"));
        const { allowed, line } = decide(dir);
        expect(allowed).toBe(false);
        expect(line).toContain(`${join(folder, "index.html")} ${SOMEONE_ELSE}`);
        expect(line).toContain(`${up}outside/pic.png`);
      },
    );

    it("keeps outside files for a folder with no record of its own", () => {
      const { allowed, warn } = decide(withNested());
      expect(allowed).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it("keeps outside files for a project whose tool folders hold more folders than a walk may list", () => {
      walk.maxEntries = 25;
      const dir = withNested();
      for (const tool of ["node_modules", "renders", ".git"]) {
        mkdirSync(join(dir, tool));
        for (let i = 0; i <= 10; i++) mkdirSync(join(dir, tool, `d${i}`));
      }
      const { allowed, warn } = decide(dir);
      expect(allowed).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it("refuses outside files when the project has too many folders to search", () => {
      walk.maxEntries = 10;
      const dir = withNested();
      const many = join(dir, "folders");
      mkdirSync(many);
      for (let i = 0; i <= 10; i++) mkdirSync(join(many, `d${i}`));
      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain("Could not check every project folder");
    });
  });

  describe("content of a received file that left the record", () => {
    const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");
    function withLeftContent(text: string): string {
      const dir = project(received());
      write(
        join(dir, ".hyperframes", "received-content.json"),
        JSON.stringify({ hashes: [hashOf(text)] }),
      );
      return dir;
    }

    it("refuses outside files when a project file holds it, and names that file", () => {
      const dir = withLeftContent(`<video src="../../outside/clip.mp4"></video>`);
      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain(
        `${join("compositions", "scene.html")} holds the content of a file that came from someone else`,
      );
    });

    it("refuses outside files and names the received content when it cannot be read", () => {
      const dir = project(received());
      write(join(dir, ".hyperframes", "received-content.json"), "{not json");
      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain(
        `Could not read ${join(realpath(dir), ".hyperframes", "received-content.json")}`,
      );
    });

    it("keeps outside files when only Studio's backups hold it", () => {
      const dir = withLeftContent("<p>theirs</p>");
      write(join(dir, ".hyperframes", "backup", "scene.html"), "<p>theirs</p>");
      expect(decide(dir).allowed).toBe(true);
    });
  });

  it("keeps outside files for a project with no received-files record", () => {
    const { allowed, warn } = decide(project());
    expect(allowed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== "win32")(
    "renders an owned project with a symlink loop normally",
    () => {
      const dir = project();
      symlinkSync("loop", join(dir, "loop"));
      write(
        join(dir, "index.html"),
        `<link rel="stylesheet" href="loop/a.css"><a href="loop">x</a>`,
      );
      expect(decide(dir).allowed).toBe(true);
      write(join(dir, ".hyperframes", "received-files.json"), received("unused.html"));
      expect(() => decide(dir)).not.toThrow();
    },
  );

  it.each(["{not json", "", "{}"])(
    "refuses outside files and names the record when it cannot be read: %j",
    (record) => {
      const dir = project(record);
      const { allowed, warn, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(line).toContain(
        `Could not read ${join(realpath(dir), ".hyperframes", "received-files.json")}`,
      );
      expect(line).toContain("../outside/secret.js");
    },
  );

  it("says the render stops on a composition outside the project", () => {
    const dir = project(received("index.html"));
    write(join(dir, "..", "outside", "shared.html"), "<div></div>");
    write(join(dir, "index.html"), `<div data-composition-src="../outside/shared.html"></div>`);
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toContain("stops on the compositions ../outside/shared.html");
  });

  it("prints references and file names from the project without their control characters", () => {
    const dir = project(received("notes\u001b[31m\u009b2J.txt"));
    write(join(dir, "..", "outside", "café.png"), SIGNATURES.png);
    write(
      join(dir, "index.html"),
      `<img src="../outside/pic.png?\u001b[2K\u001b[1Aspoof\u0007">
<img src="../outside/café.png">
<div style="background: url('../outside/bg.png#\u009b31m\u007f')"></div>`,
    );
    const { allowed, line } = decide(dir);
    expect(allowed).toBe(false);
    expect(line).toBe(terminalText(line));
    expect(line).toContain("notes\\x1b[31m\\x9b2J.txt");
    expect(line).toContain("../outside/pic.png?\\x1b[2K\\x1b[1Aspoof\\x07");
    expect(line).toContain("../outside/bg.png#\\x9b31m\\x7f");
    expect(line).toContain("../outside/café.png");
  });

  it.runIf(process.platform !== "win32")(
    "skips a stylesheet it cannot read instead of failing",
    () => {
      const dir = project(received("index.html"));
      write(join(dir, "locked.css"), "body { background: url(../outside/bg.png); }");
      chmodSync(join(dir, "locked.css"), 0o000);
      write(join(dir, "index.html"), `<link href="locked.css"><img src="../outside/pic.png">`);
      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain("../outside/pic.png");
    },
  );

  it("scans a long unclosed url( run in linear time", () => {
    const dir = project("{not json");
    write(join(dir, "style.css"), "url(".repeat(1_000_000));
    const started = performance.now();
    decide(dir);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  describe("parity with the render compiler", () => {
    const scene = (id: string) =>
      `<template><div data-composition-id="${id}" data-width="320" data-height="180" data-duration="1">` +
      `<p>${id}-marker</p><img src="../../outside/pic.png"></div></template>`;

    it.each([
      {
        name: "a root-relative reference with a leading slash",
        files: { "compositions/scene.html": scene("received-scene") },
        src: "/compositions/scene.html",
        receivedFile: "compositions/scene.html",
        consumed: "received-scene-marker",
      },
      {
        name: "a percent-encoded reference",
        files: { "compositions/my scene.html": scene("received-scene") },
        src: "compositions/my%20scene.html",
        receivedFile: "compositions/my scene.html",
        consumed: "received-scene-marker",
      },
      {
        name: "a nested reference resolved from the project root",
        files: {
          "compositions/outer.html":
            `<template><div data-composition-id="outer" data-width="320" data-height="180" data-duration="1">` +
            `<div data-composition-src="compositions/inner.html"></div></div></template>`,
          "compositions/inner.html": scene("received-scene"),
        },
        src: "compositions/outer.html",
        receivedFile: "compositions/inner.html",
        consumed: "received-scene-marker",
      },
      {
        name: "an owned scene's received stylesheet",
        files: {
          "compositions/scene.html":
            `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
            `<link rel="stylesheet" href="scene.css"><p>received-scene-marker</p><img src="../../outside/pic.png"></div></template>`,
          "compositions/scene.css": "body { color: red; }",
        },
        src: "compositions/scene.html",
        receivedFile: "compositions/scene.css",
        consumed: "scene.css",
      },
      {
        name: "a received stylesheet of an owned scene nested in an owned scene",
        files: {
          "compositions/outer.html":
            `<template><div data-composition-id="outer" data-width="320" data-height="180" data-duration="1">` +
            `<div data-composition-src="compositions/scene.html"></div></div></template>`,
          "compositions/scene.html":
            `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
            `<link rel="stylesheet" href="scene.css"><p>received-scene-marker</p><img src="../../outside/pic.png"></div></template>`,
          "compositions/scene.css": "body { color: red; }",
        },
        src: "compositions/outer.html",
        receivedFile: "compositions/scene.css",
        consumed: "scene.css",
      },
      {
        name: "an owned scene's received script",
        files: {
          "compositions/scene.html":
            `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
            `<script src="scene.js"></script><p>received-scene-marker</p><img src="../../outside/pic.png"></div></template>`,
          "compositions/scene.js": "window.sceneLoaded = true;",
        },
        src: "compositions/scene.html",
        receivedFile: "compositions/scene.js",
        consumed: "scene.js",
      },
      {
        name: "a received script of an owned scene nested in an owned scene",
        files: {
          "compositions/outer.html":
            `<template><div data-composition-id="outer" data-width="320" data-height="180" data-duration="1">` +
            `<div data-composition-src="compositions/scene.html"></div></div></template>`,
          "compositions/scene.html":
            `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
            `<script src="scene.js"></script><p>received-scene-marker</p><img src="../../outside/pic.png"></div></template>`,
          "compositions/scene.js": "window.sceneLoaded = true;",
        },
        src: "compositions/outer.html",
        receivedFile: "compositions/scene.js",
        consumed: "scene.js",
      },
    ])("refuses outside files for $name the render compiler reads", async (probe) => {
      const dir = project(received(probe.receivedFile));
      for (const [file, text] of Object.entries(probe.files)) write(join(dir, file), text);
      write(
        join(dir, "index.html"),
        `<div data-composition-id="main" data-width="320" data-height="180" data-duration="1">` +
          `<div data-composition-src="${probe.src}"></div></div>`,
      );

      const compiled = await compileForRender(dir, join(dir, "index.html"), join(dir, ".dl"), {
        allowOutsideProjectAssets: true,
      });
      const rendered = [compiled.html, ...compiled.subCompositions.values()].join("\n");
      expect(rendered).toContain(probe.consumed);

      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain(SOMEONE_ELSE);
      expect(line).toContain("../../outside/pic.png");
    });
  });

  describe("a received media file in a composition slot", () => {
    it.each(["assets/scene.png", "/assets/scene.png"])(
      "the render compiler refuses %s as a page, so the media exemption holds",
      async (src) => {
        const dir = project(received("assets/scene.png"));
        write(
          join(dir, "assets", "scene.png"),
          Buffer.concat([
            SIGNATURES.png,
            Buffer.from(
              `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
                `<p>received-scene-marker</p><img src="../../outside/pic.png"></div></template>`,
            ),
          ]),
        );
        write(
          join(dir, "index.html"),
          `<div data-composition-id="main" data-width="320" data-height="180" data-duration="1">` +
            `<div data-composition-src="${src}"></div></div>`,
        );

        await expect(
          compileForRender(dir, join(dir, "index.html"), join(dir, ".dl"), {
            allowOutsideProjectAssets: true,
          }),
        ).rejects.toThrow(/assets\/scene\.png: it is not an \.html file/);
        expect(decide(dir).allowed).toBe(true);
      },
    );
  });

  describe("another name for a received media file", () => {
    const mediaPage = (outsideRef: string) =>
      Buffer.concat([
        SIGNATURES.png,
        Buffer.from(
          `<template><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1">` +
            `<p>received-scene-marker</p><img src="${outsideRef}"></div></template>`,
        ),
      ]);
    const MEDIA_PAGE = mediaPage("../outside/pic.png");

    function aliasProject(makeAlias: (target: string, alias: string) => void, alias: string) {
      const dir = project(received("assets/scene.png"));
      write(join(dir, "assets", "scene.png"), MEDIA_PAGE);
      makeAlias(join(dir, "assets", "scene.png"), join(dir, alias));
      write(
        join(dir, "index.html"),
        `<div data-composition-id="main" data-width="320" data-height="180" data-duration="1">` +
          `<div data-composition-src="${alias}"></div></div>`,
      );
      return dir;
    }

    it.each([
      ["hardlink", (target: string, alias: string) => linkSync(target, alias)],
      ["symlink", (target: string, alias: string) => symlinkSync(target, alias)],
    ])("refuses outside files when a %s with an HTML name reaches it", async (_kind, makeAlias) => {
      const dir = aliasProject(makeAlias, "scene.html");
      const compiled = await compileForRender(dir, join(dir, "index.html"), join(dir, ".dl"), {
        allowOutsideProjectAssets: true,
      });
      const rendered = [compiled.html, ...compiled.subCompositions.values()].join("\n");
      expect(rendered).toContain("received-scene-marker");

      const { allowed, line } = decide(dir);
      expect(allowed).toBe(false);
      expect(line).toContain("scene.html is another name for a file that came from someone else");
    });

    // With --include-outside-files, so a scene in a linked folder outside the project is read too.
    async function compiledPage(dir: string) {
      const compiled = await compileForRender(dir, join(dir, "index.html"), join(dir, ".dl"), {
        allowOutsideProjectAssets: true,
        includeOutsideScripts: true,
      });
      const rendered = [compiled.html, ...compiled.subCompositions.values()].join("\n");
      return { rendered, outside: [...compiled.externalAssets.values()] };
    }

    function playScene(dir: string, src: string): void {
      write(
        join(dir, "index.html"),
        `<div data-composition-id="main" data-width="320" data-height="180" data-duration="1">` +
          `<div data-composition-src="${src}"></div></div>`,
      );
    }

    it.runIf(process.platform !== "win32")(
      "refuses outside files when the received name is a link and an HTML link reaches the same file",
      async () => {
        const dir = project(received("assets/scene.png"));
        write(join(dir, "media", "real.png"), MEDIA_PAGE);
        symlinkSync(join(dir, "media", "real.png"), join(dir, "assets", "scene.png"));
        symlinkSync(join(dir, "media", "real.png"), join(dir, "scene.html"));
        playScene(dir, "scene.html");
        const { rendered, outside } = await compiledPage(dir);
        expect(rendered).toContain("received-scene-marker");
        expect(outside).toContainEqual(expect.stringMatching(/[\\/]outside[\\/]pic\.png$/));

        const { allowed, line } = decide(dir);
        expect(allowed).toBe(false);
        expect(line).toContain("scene.html is another name for a file that came from someone else");
      },
    );

    it.runIf(process.platform !== "win32")(
      "refuses outside files when a linked folder leading outside the project holds the received file",
      async () => {
        const dir = project(received("pages/scene.png"));
        const shared = join(dir, "..", "shared");
        write(join(shared, "scene.png"), mediaPage("assets/../../outside/pic.png"));
        symlinkSync("scene.png", join(shared, "scene.html"));
        symlinkSync(shared, join(dir, "pages"));
        playScene(dir, "pages/scene.html");
        const { rendered, outside } = await compiledPage(dir);
        expect(rendered).toContain("received-scene-marker");
        expect(outside).toContainEqual(expect.stringMatching(/[\\/]outside[\\/]pic\.png$/));

        const { allowed, line } = decide(dir);
        expect(allowed).toBe(false);
        expect(line).toContain("Could not check every project file");
      },
    );

    it.runIf(process.platform !== "win32")(
      "keeps outside files when a linked folder stays inside the project",
      () => {
        const dir = project(received("assets/in.png"));
        symlinkSync(join(dir, "assets"), join(dir, "pictures"));
        expect(decide(dir).allowed).toBe(true);
      },
    );

    it("keeps outside files when the other name is also a media name", () => {
      const dir = project(received("assets/scene.png"));
      write(join(dir, "assets", "scene.png"), SIGNATURES.png);
      linkSync(join(dir, "assets", "scene.png"), join(dir, "assets", "copy.png"));
      expect(decide(dir).allowed).toBe(true);
    });

    it.runIf(process.platform !== "win32")(
      "refuses outside files when it cannot check every project file",
      () => {
        const dir = project(received("assets/in.png"));
        mkdirSync(join(dir, "locked"));
        chmodSync(join(dir, "locked"), 0o000);
        try {
          const { allowed, line } = decide(dir);
          expect(allowed).toBe(false);
          expect(line).toMatch(/Could not check every project (file|folder)/);
        } finally {
          chmodSync(join(dir, "locked"), 0o755);
        }
      },
    );
  });
});
