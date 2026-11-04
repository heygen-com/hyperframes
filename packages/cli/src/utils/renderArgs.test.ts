import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "@hyperframes/engine";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  MAX_PAGE_NAVIGATION_TIMEOUT_SECONDS,
  parseBrowserTimeoutMsArg,
  pageNavigationTimeoutMs,
  parseGifLoopArg,
  parseHlsSegmentSecondsArg,
  resolveDefaultFpsArg,
  type BrowserTimeoutParseResult,
} from "./renderArgs.js";
import {
  compositionEntryErrorMessage,
  hasExplicitCompositionArg,
  parseCompositionEntryArg,
  type CompositionEntryParseError,
  type CompositionEntryParseResult,
} from "./compositionEntry.js";

function expectBrowserTimeoutErr(result: BrowserTimeoutParseResult): { kind: string; raw: string } {
  if (result.ok) throw new Error(`expected error, got value=${result.value}`);
  return result.error;
}

function expectCompositionErr(result: CompositionEntryParseResult): CompositionEntryParseError {
  if (result.ok) throw new Error(`expected error, got value=${result.value}`);
  return result.error;
}

/** Build a fake `Stats` for the in-memory stat adapter. */
function fakeStats(kind: "file" | "directory"): Stats {
  return {
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
  } as Stats;
}

/**
 * Build a stat adapter from a path → kind map. Throws ENOENT for any
 * path not in the map, matching `statSync` behaviour.
 */
function makeStat(entries: Record<string, "file" | "directory">): (path: string) => Stats {
  return (path) => {
    const kind = entries[path];
    if (!kind) {
      const err = new Error(`ENOENT: no such file or directory, stat '${path}'`);
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    }
    return fakeStats(kind);
  };
}

describe("parseBrowserTimeoutMsArg", () => {
  it("returns undefined when the flag is absent", () => {
    expect(parseBrowserTimeoutMsArg(undefined)).toEqual({ ok: true, value: undefined });
  });

  it("converts whole seconds to milliseconds", () => {
    expect(parseBrowserTimeoutMsArg("180")).toEqual({ ok: true, value: 180_000 });
  });

  it("accepts fractional seconds and rounds to integer ms", () => {
    expect(parseBrowserTimeoutMsArg("90.5")).toEqual({ ok: true, value: 90_500 });
    expect(parseBrowserTimeoutMsArg("0.001")).toEqual({ ok: true, value: 1 });
  });

  it("rejects non-numeric input", () => {
    const err = expectBrowserTimeoutErr(parseBrowserTimeoutMsArg("abc"));
    expect(err.kind).toBe("not-a-number");
  });

  it("rejects Infinity and NaN", () => {
    expect(expectBrowserTimeoutErr(parseBrowserTimeoutMsArg("Infinity")).kind).toBe("not-a-number");
    expect(expectBrowserTimeoutErr(parseBrowserTimeoutMsArg("NaN")).kind).toBe("not-a-number");
  });

  it("rejects zero and negative values", () => {
    expect(expectBrowserTimeoutErr(parseBrowserTimeoutMsArg("0")).kind).toBe("not-positive");
    expect(expectBrowserTimeoutErr(parseBrowserTimeoutMsArg("-5")).kind).toBe("not-positive");
    expect(expectBrowserTimeoutErr(parseBrowserTimeoutMsArg("")).kind).toBe("not-positive");
  });

  it("rejects sub-millisecond inputs that would round to timeout: 0 (Puppeteer 'no timeout' sentinel)", () => {
    // Regression for issue #1199 follow-up: --browser-timeout 0.0004 passes
    // > 0 in seconds but Math.round(0.4) = 0 ms, which Puppeteer interprets
    // as "wait forever". The validator must reject before the multiply.
    expect(expectBrowserTimeoutErr(parseBrowserTimeoutMsArg("0.0004")).kind).toBe("too-small");
  });

  it("rejects values above the 24h cap to prevent setTimeout overflow", () => {
    expect(expectBrowserTimeoutErr(parseBrowserTimeoutMsArg("1e10")).kind).toBe("too-large");
    expect(
      expectBrowserTimeoutErr(
        parseBrowserTimeoutMsArg(String(MAX_PAGE_NAVIGATION_TIMEOUT_SECONDS + 1)),
      ).kind,
    ).toBe("too-large");
  });

  it("accepts values right at the 24h cap", () => {
    expect(parseBrowserTimeoutMsArg(String(MAX_PAGE_NAVIGATION_TIMEOUT_SECONDS))).toEqual({
      ok: true,
      value: MAX_PAGE_NAVIGATION_TIMEOUT_SECONDS * 1000,
    });
  });
});

describe("pageNavigationTimeoutMs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("gives check and snapshot the page-load budget render uses", () => {
    expect(pageNavigationTimeoutMs()).toBe(DEFAULT_CONFIG.pageNavigationTimeout);
    vi.stubEnv("PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS", "90000");
    expect(pageNavigationTimeoutMs()).toBe(90_000);
  });

  it("falls back to that default for a zero or invalid override", () => {
    vi.stubEnv("PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS", "0");
    expect(pageNavigationTimeoutMs()).toBe(DEFAULT_CONFIG.pageNavigationTimeout);
    vi.stubEnv("PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS", "invalid");
    expect(pageNavigationTimeoutMs()).toBe(DEFAULT_CONFIG.pageNavigationTimeout);
  });

  it("prints no render-only warning where render would disable streaming encode", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.stubEnv("PRODUCER_BROWSER_GPU_MODE", "software");
    vi.stubEnv("PRODUCER_MAX_WORKERS", "1");
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(pageNavigationTimeoutMs()).toBe(DEFAULT_CONFIG.pageNavigationTimeout);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("lets a command's longer --timeout raise it, never lower it", () => {
    expect(pageNavigationTimeoutMs(DEFAULT_CONFIG.pageNavigationTimeout * 2)).toBe(
      DEFAULT_CONFIG.pageNavigationTimeout * 2,
    );
    expect(pageNavigationTimeoutMs(3_000)).toBe(DEFAULT_CONFIG.pageNavigationTimeout);
  });
});

describe("parseCompositionEntryArg", () => {
  it("uses one sentinel classifier for default and explicit composition values", () => {
    expect([undefined, "", "   ", ".", "./"].map(hasExplicitCompositionArg)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(hasExplicitCompositionArg("./compositions/intro.html")).toBe(true);
  });

  const PROJECT = "/proj";
  const stat = makeStat({
    [resolve(PROJECT, "index.html")]: "file",
    [resolve(PROJECT, "compositions/intro.html")]: "file",
    [resolve(PROJECT, "compositions")]: "directory",
    [PROJECT]: "directory",
  });

  it("returns undefined when the flag is absent", () => {
    expect(parseCompositionEntryArg(undefined, PROJECT, stat)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("normalizes '.' to undefined so the producer falls back to index.html (issue #1199)", () => {
    expect(parseCompositionEntryArg(".", PROJECT, stat)).toEqual({ ok: true, value: undefined });
  });

  it("normalizes './' to undefined", () => {
    expect(parseCompositionEntryArg("./", PROJECT, stat)).toEqual({ ok: true, value: undefined });
  });

  it("normalizes empty / whitespace-only to undefined", () => {
    expect(parseCompositionEntryArg("", PROJECT, stat)).toEqual({ ok: true, value: undefined });
    expect(parseCompositionEntryArg("   ", PROJECT, stat)).toEqual({ ok: true, value: undefined });
  });

  it("passes through a valid .html file path", () => {
    expect(parseCompositionEntryArg("compositions/intro.html", PROJECT, stat)).toEqual({
      ok: true,
      value: "compositions/intro.html",
    });
  });

  it("strips a leading ./ before resolution", () => {
    expect(parseCompositionEntryArg("./compositions/intro.html", PROJECT, stat)).toEqual({
      ok: true,
      value: "compositions/intro.html",
    });
  });

  it("rejects a directory path with 'not-a-file' (the EISDIR cause)", () => {
    const err = expectCompositionErr(parseCompositionEntryArg("compositions", PROJECT, stat));
    expect(err).toMatchObject({ kind: "not-a-file", entryFile: "compositions" });
  });

  it("rejects a non-existent file with 'not-found'", () => {
    const err = expectCompositionErr(parseCompositionEntryArg("missing.html", PROJECT, stat));
    expect(err).toMatchObject({ kind: "not-found", entryFile: "missing.html" });
  });

  it("rejects a path that escapes the project directory", () => {
    const err = expectCompositionErr(parseCompositionEntryArg("../escape.html", PROJECT, stat));
    expect(err.kind).toBe("outside-project");
  });

  it("accepts an absolute path inside the project and returns it project-relative", () => {
    expect(
      parseCompositionEntryArg(resolve(PROJECT, "compositions/intro.html"), PROJECT, stat),
    ).toEqual({ ok: true, value: "compositions/intro.html" });
  });

  it("keeps a dot-named entry relative to the project", () => {
    const dotStat = makeStat({ [resolve(PROJECT, ".solo.html")]: "file", [PROJECT]: "directory" });
    expect(parseCompositionEntryArg(".solo.html", PROJECT, dotStat)).toEqual({
      ok: true,
      value: ".solo.html",
    });
  });

  it("rejects an absolute path outside the project", () => {
    const outsideStat = makeStat({ "/elsewhere/x.html": "file", [PROJECT]: "directory" });
    const err = expectCompositionErr(
      parseCompositionEntryArg("/elsewhere/x.html", PROJECT, outsideStat),
    );
    expect(err.kind).toBe("outside-project");
  });

  it.each([
    ["../escape.html", "outside-project", "/escape.html"],
    ["missing.html", "not-found", "/proj/missing.html"],
    ["compositions", "not-a-file", "/proj/compositions"],
  ])("names the resolved entry path and project directory for %s", (raw, kind, entryPath) => {
    const err = expectCompositionErr(parseCompositionEntryArg(raw, PROJECT, stat));
    expect(err).toEqual({
      kind,
      entryFile: raw,
      entryPath: resolve(entryPath),
      projectDir: resolve(PROJECT),
    });
    const { message } = compositionEntryErrorMessage(err);
    expect(message).toContain(`"${raw}" resolves to ${resolve(entryPath)}`);
    expect(message).toContain(resolve(PROJECT));
  });

  it("rejects a sibling-prefix path (trailing-separator guard)", () => {
    // Without the trailing-separator guard, `/proj-evil/x.html`.startsWith('/proj')
    // returns true and the sibling-directory escape passes validation.
    const siblingStat = makeStat({
      "/proj-evil/x.html": "file",
      [PROJECT]: "directory",
    });
    const err = expectCompositionErr(
      parseCompositionEntryArg("../proj-evil/x.html", PROJECT, siblingStat),
    );
    expect(err.kind).toBe("outside-project");
  });
});

describe.skipIf(process.platform === "win32")(
  "parseCompositionEntryArg through a symlinked project path",
  () => {
    it("accepts an absolute entry spelled with the alias of the project directory", () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "hyperframes-entry-alias-")));
      try {
        const project = join(root, "project");
        mkdirSync(project);
        writeFileSync(join(project, "entry.html"), "<html></html>");
        const alias = join(root, "alias");
        symlinkSync(project, alias);
        expect(parseCompositionEntryArg(join(alias, "entry.html"), project, statSync)).toEqual({
          ok: true,
          value: "entry.html",
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  },
);

describe("resolveDefaultFpsArg", () => {
  function writeComposition(path: string, fps: string): void {
    writeFileSync(
      path,
      `<!DOCTYPE html><html><body><div data-composition-id="root" data-root="true" data-fps="${fps}">x</div></body></html>`,
    );
  }

  function makeProject(): {
    dir: string;
    indexPath: string;
    entryFile: string;
    cleanup: () => void;
  } {
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-render-fps-"));
    const indexPath = join(dir, "index.html");
    const entryFile = "compositions/intro.html";
    const entryPath = join(dir, entryFile);
    writeComposition(indexPath, "24");
    mkdirSync(dirname(entryPath), { recursive: true });
    return {
      dir,
      indexPath,
      entryFile,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  }

  it("reads data-fps from the --composition target instead of index.html", () => {
    const project = makeProject();
    try {
      writeComposition(join(project.dir, project.entryFile), "60");

      expect(
        resolveDefaultFpsArg(undefined, project.dir, project.indexPath, project.entryFile),
      ).toBe("60");
    } finally {
      project.cleanup();
    }
  });

  it("falls back to index.html data-fps when --composition is not set", () => {
    const project = makeProject();
    try {
      expect(resolveDefaultFpsArg(undefined, project.dir, project.indexPath, undefined)).toBe("24");
    } finally {
      project.cleanup();
    }
  });

  it("uses an uppercase HTML data-fps declaration when --fps is omitted", () => {
    const project = makeProject();
    try {
      writeFileSync(
        project.indexPath,
        '<!DOCTYPE html><html><body><div data-composition-id="root" DATA-FPS="24">x</div></body></html>',
      );

      expect(resolveDefaultFpsArg(undefined, project.dir, project.indexPath, undefined)).toBe("24");
      expect(resolveDefaultFpsArg("60", project.dir, project.indexPath, undefined)).toBe("60");
    } finally {
      project.cleanup();
    }
  });

  it("keeps an explicit --fps value ahead of any composition default", () => {
    const project = makeProject();
    try {
      writeComposition(join(project.dir, project.entryFile), "60");

      expect(resolveDefaultFpsArg("120", project.dir, project.indexPath, project.entryFile)).toBe(
        "120",
      );
    } finally {
      project.cleanup();
    }
  });
});

describe("parseGifLoopArg", () => {
  it("accepts absent flag, bounds, and integers", () => {
    expect(parseGifLoopArg(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseGifLoopArg("0")).toEqual({ ok: true, value: 0 });
    expect(parseGifLoopArg("65535")).toEqual({ ok: true, value: 65535 });
  });

  it("rejects out-of-range, non-integer, and empty inputs", () => {
    expect(parseGifLoopArg("-1").ok).toBe(false);
    expect(parseGifLoopArg("65536").ok).toBe(false);
    expect(parseGifLoopArg("1.5").ok).toBe(false);
    expect(parseGifLoopArg(" ").ok).toBe(false);
  });
});

describe("parseHlsSegmentSecondsArg", () => {
  it("accepts absent flag and whole seconds in range", () => {
    expect(parseHlsSegmentSecondsArg(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseHlsSegmentSecondsArg("1")).toEqual({ ok: true, value: 1 });
    expect(parseHlsSegmentSecondsArg(" 6 ")).toEqual({ ok: true, value: 6 });
    expect(parseHlsSegmentSecondsArg("60")).toEqual({ ok: true, value: 60 });
  });

  // Fractional seconds would make ffmpeg's integer #EXT-X-TARGETDURATION lie.
  it("rejects zero, fractional, out-of-range, and empty inputs", () => {
    expect(parseHlsSegmentSecondsArg("0").ok).toBe(false);
    expect(parseHlsSegmentSecondsArg("2.5").ok).toBe(false);
    expect(parseHlsSegmentSecondsArg("61").ok).toBe(false);
    expect(parseHlsSegmentSecondsArg(" ").ok).toBe(false);
  });
});
