import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyResolutionPreset, injectTailwindBrowserScript } from "./init.js";

const cliEntry = resolve(fileURLToPath(import.meta.url), "..", "..", "cli.ts");
const tailwindScript =
  '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4/dist/index.global.js" integrity="sha384-v5YF9xS+gLRWdvrQ0u/WRbCkjSIH0NjHIPe8tBL1ZRrmI7PiSH6LLdzs0aAIMCuh" crossorigin="anonymous"></script>';

// Spawns `bun` directly because the CLI entry is a .ts file that needs a
// TypeScript-aware runtime. vitest runs under node, so `process.execPath`
// would be node and couldn't load the entry. This repo hard-depends on bun
// (package.json scripts), so assuming it's on PATH is safe.
function runInit(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", cliEntry, "init", ...args], {
    encoding: "utf-8",
    timeout: 30_000,
    // The `--skip-skills` flag is neutered (see init.ts); the GitHub skills check
    // is opted out only via this env var, so tests stay offline and fast.
    env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1" },
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout,
    stderr: res.stderr,
  };
}

describe("hyperframes init flag rename", () => {
  it("--example blank scaffolds a bundled project with npm scripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([target, "--example", "blank", "--non-interactive", "--skip-skills"]);
      expect(res.status).toBe(0);
      expect(existsSync(join(target, "index.html"))).toBe(true);
      expect(res.stdout).toContain("npm run dev");
      expect(res.stdout).toContain("npm run check");
      expect(res.stdout).toContain("npm run render");

      const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf-8")) as {
        private?: boolean;
        type?: string;
        scripts?: Record<string, string>;
      };
      expect(pkg.private).toBe(true);
      expect(pkg.type).toBe("module");
      expect(pkg.scripts).toMatchObject({
        dev: "npx --yes hyperframes preview",
        check:
          "npx --yes hyperframes lint && npx --yes hyperframes validate && npx --yes hyperframes inspect",
        render: "npx --yes hyperframes render",
        publish: "npx --yes hyperframes publish",
      });
      expect(Object.keys(pkg.scripts ?? {}).sort()).toEqual(["check", "dev", "publish", "render"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--tailwind enables Tailwind utilities in scaffolded HTML", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([
        target,
        "--example",
        "blank",
        "--tailwind",
        "--non-interactive",
        "--skip-skills",
      ]);
      expect(res.status).toBe(0);

      const html = readFileSync(join(target, "index.html"), "utf-8");
      expect(html).toContain(tailwindScript);
      expect(html).toContain("window.__tailwindReady");

      const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf-8")) as {
        scripts?: Record<string, string>;
      };
      expect(pkg.scripts).toMatchObject({
        dev: "npx --yes hyperframes preview",
        check:
          "npx --yes hyperframes lint && npx --yes hyperframes validate && npx --yes hyperframes inspect",
        render: "npx --yes hyperframes render",
        publish: "npx --yes hyperframes publish",
      });
      expect(Object.keys(pkg.scripts ?? {}).sort()).toEqual(["check", "dev", "publish", "render"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("inserts Tailwind before uppercase closing head tags", () => {
    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      '  <SCRIPT src="./runtime.global.js"></SCRIPT>',
      "</HEAD>",
      "</html>",
    ].join("\n");

    const injected = injectTailwindBrowserScript(html);
    expect(injected.indexOf('  <SCRIPT src="./runtime.global.js"></SCRIPT>')).toBeLessThan(
      injected.indexOf(tailwindScript),
    );
    expect(injected.indexOf(tailwindScript)).toBeLessThan(injected.indexOf("</HEAD>"));
  });

  it("inserts Tailwind into single-line HTML heads", () => {
    const html = "<!doctype html><html><head><title>x</title></head><body></body></html>";

    expect(injectTailwindBrowserScript(html)).toContain(`${tailwindScript}\n</head>`);
  });

  it("does not duplicate Tailwind support when it is already present", () => {
    const html = ["<!doctype html>", "<html>", "<head>", tailwindScript, "</head>", "</html>"].join(
      "\n",
    );

    expect(injectTailwindBrowserScript(html)).toBe(html);
  });

  it("keeps the readiness shim free of render-loop APIs", () => {
    const html = "<!doctype html><html><head></head><body></body></html>";
    const injected = injectTailwindBrowserScript(html);

    expect(injected).not.toContain("Date.now");
    expect(injected).not.toContain("requestAnimationFrame");
    expect(injected).not.toContain("setTimeout");
  });

  it("-v works as the short alias for --video", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([
        target,
        "--example",
        "blank",
        "--non-interactive",
        "--skip-skills",
        "-v",
        "missing.mp4",
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Video file not found: missing.mp4");
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--audio with a missing file fails without creating the project directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([
        target,
        "--example",
        "blank",
        "--non-interactive",
        "--skip-skills",
        "--audio",
        "missing.mp3",
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Audio file not found: missing.mp3");
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--video and --audio together fail without creating the project directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([
        target,
        "--example",
        "blank",
        "--non-interactive",
        "--skip-skills",
        "--video",
        "clip.mp4",
        "--audio",
        "track.mp3",
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Cannot use --video and --audio together");
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("-V prints a migration error instead of version fast-path", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([
        target,
        "--example",
        "blank",
        "--non-interactive",
        "--skip-skills",
        "-V",
        "missing.mp4",
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("The -V short flag no longer maps to --video");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--template prints a rename hint and exits non-zero", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([target, "--template", "blank", "--non-interactive", "--skip-skills"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("--template flag was renamed to --example");
      expect(res.stderr).toContain(`--example "blank"`);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("applyResolutionPreset", () => {
  function withFixture(fn: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "hf-resolution-test-"));
    try {
      mkdirSync(dir, { recursive: true });
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const sampleHtml = [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta name="viewport" content="width=1920, height=1080" />',
    "    <style>",
    "      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }",
    "    </style>",
    "  </head>",
    "  <body>",
    '    <div id="root" data-composition-id="main" data-width="1920" data-height="1080">',
    "    </div>",
    "  </body>",
    "</html>",
  ].join("\n");

  it("rewrites every dimension fingerprint for landscape-4k", () => {
    withFixture((dir) => {
      const file = join(dir, "index.html");
      writeFileSync(file, sampleHtml, "utf-8");

      applyResolutionPreset(dir, "landscape-4k");
      const out = readFileSync(file, "utf-8");

      expect(out).toContain('data-resolution="landscape-4k"');
      expect(out).toContain('data-width="3840"');
      expect(out).toContain('data-height="2160"');
      expect(out).toContain("width: 3840px");
      expect(out).toContain("height: 2160px");
      expect(out).toContain('content="width=3840, height=2160"');
      expect(out).not.toContain("1920");
      expect(out).not.toContain("1080");
    });
  });

  it("swaps to portrait dimensions for portrait-4k", () => {
    withFixture((dir) => {
      const file = join(dir, "index.html");
      writeFileSync(file, sampleHtml, "utf-8");

      applyResolutionPreset(dir, "portrait-4k");
      const out = readFileSync(file, "utf-8");

      expect(out).toContain('data-width="2160"');
      expect(out).toContain('data-height="3840"');
      expect(out).toContain('data-resolution="portrait-4k"');
    });
  });

  it("swaps to square dimensions for square", () => {
    withFixture((dir) => {
      const file = join(dir, "index.html");
      writeFileSync(file, sampleHtml, "utf-8");

      applyResolutionPreset(dir, "square");
      const out = readFileSync(file, "utf-8");

      expect(out).toContain('data-width="1080"');
      expect(out).toContain('data-height="1080"');
      expect(out).toContain('data-resolution="square"');
      expect(out).toContain("width: 1080px");
      expect(out).toContain("height: 1080px");
    });
  });

  it("swaps to square-4k dimensions", () => {
    withFixture((dir) => {
      const file = join(dir, "index.html");
      writeFileSync(file, sampleHtml, "utf-8");

      applyResolutionPreset(dir, "square-4k");
      const out = readFileSync(file, "utf-8");

      expect(out).toContain('data-width="2160"');
      expect(out).toContain('data-height="2160"');
      expect(out).toContain('data-resolution="square-4k"');
      expect(out).toContain("width: 2160px");
      expect(out).toContain("height: 2160px");
    });
  });

  it("scaffolds a 4k project end-to-end via --resolution 4k", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([
        target,
        "--example",
        "blank",
        "--resolution",
        "4k",
        "--non-interactive",
        "--skip-skills",
      ]);
      expect(res.status).toBe(0);

      const html = readFileSync(join(target, "index.html"), "utf-8");
      expect(html).toContain('data-width="3840"');
      expect(html).toContain('data-height="2160"');
      expect(html).toContain('data-resolution="landscape-4k"');
      expect(html).toContain("width: 3840px");
      expect(html).toContain("height: 2160px");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown --resolution value", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([
        target,
        "--example",
        "blank",
        "--resolution",
        "8k",
        "--non-interactive",
        "--skip-skills",
      ]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Invalid --resolution");
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rewrites height-before-width inline CSS", () => {
    withFixture((dir) => {
      const file = join(dir, "index.html");
      // Reversed property order — same as the parser's stageMatchReverse path.
      const reversedOrderHtml = sampleHtml.replace(
        "html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }",
        "html, body { margin: 0; height: 1080px; width: 1920px; overflow: hidden; }",
      );
      writeFileSync(file, reversedOrderHtml, "utf-8");

      applyResolutionPreset(dir, "landscape-4k");
      const out = readFileSync(file, "utf-8");

      expect(out).toContain("height: 2160px");
      expect(out).toContain("width: 3840px");
      expect(out).not.toContain("1080px");
      expect(out).not.toContain("1920px");
    });
  });

  it("is a no-op on a file with no dimension fingerprint (does not error)", () => {
    withFixture((dir) => {
      const file = join(dir, "fragment.html");
      // No data-width/height, no html/body block, no viewport — just markup.
      const minimal = "<!doctype html><html><head></head><body><p>hi</p></body></html>";
      writeFileSync(file, minimal, "utf-8");

      expect(() => applyResolutionPreset(dir, "landscape-4k")).not.toThrow();
      const out = readFileSync(file, "utf-8");
      // The htmlOpenRe path adds `data-resolution="landscape-4k"` because
      // the <html> tag is present. That's correct: an explicit signal of
      // intended resolution survives even when no dim fields exist.
      expect(out).toContain('data-resolution="landscape-4k"');
    });
  });

  it("accepts uppercase --resolution value (4K)", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-init-test-"));
    const target = join(dir, "proj");
    try {
      const res = runInit([
        target,
        "--example",
        "blank",
        "--resolution",
        "4K",
        "--non-interactive",
        "--skip-skills",
      ]);
      expect(res.status).toBe(0);
      const html = readFileSync(join(target, "index.html"), "utf-8");
      expect(html).toContain('data-width="3840"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
