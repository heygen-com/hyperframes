import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProjectScaffold, loadEnvFile } from "./scaffolding.js";
import type { DesignTokens } from "./types.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return {
    ...original,
    existsSync: vi.fn(original.existsSync),
    writeFileSync: vi.fn(original.writeFileSync),
    linkSync: vi.fn(original.linkSync),
  };
});

const tokens: DesignTokens = {
  title: "Captured site",
  description: "",
  cssVariables: {},
  fonts: [],
  colors: [],
  headings: [],
  ctas: [],
  svgs: [],
  sections: [],
};

describe("generateProjectScaffold metadata", () => {
  let dir: string;
  let metaPath: string;
  let warnings: string[];
  const progress = vi.fn();

  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), "hf-scaffold-"));
    metaPath = join(dir, "meta.json");
    warnings = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      expect(fs.readdirSync(dir).filter((name) => name.startsWith(".hf-create-"))).toEqual([]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function generate(url = "https://www.example.com", title = tokens.title) {
    return generateProjectScaffold(
      dir,
      url,
      { ...tokens, title },
      undefined,
      false,
      false,
      false,
      [],
      progress,
      warnings,
    );
  }

  it.each(["Captured site", ""])(
    "creates metadata with title %j and agent instructions",
    async (title) => {
      await generate(undefined, title);
      expect(fs.readFileSync(metaPath, "utf-8")).toBe(
        JSON.stringify({ id: "example.com-video", name: title || "example.com" }, null, 2),
      );
      expect(fs.readFileSync(join(dir, "AGENTS.md"), "utf-8")).toBe(
        fs.readFileSync(join(dir, "CLAUDE.md"), "utf-8"),
      );
      expect(fs.existsSync(join(dir, "index.html"))).toBe(false);
      expect(progress).toHaveBeenCalledWith("agent", "AGENTS.md + CLAUDE.md generated");
      expect(warnings).toEqual([]);
    },
  );

  it("keeps existing metadata without parsing the unused URL", async () => {
    fs.writeFileSync(metaPath, "user metadata");
    await generate("not a URL");
    expect(fs.readFileSync(metaPath, "utf-8")).toBe("user metadata");
  });

  it("preserves a file created after the existence check and continues scaffolding", async () => {
    vi.mocked(fs.existsSync).mockImplementationOnce(() => {
      fs.writeFileSync(metaPath, "concurrent metadata");
      return false;
    });
    await generate();
    expect(fs.readFileSync(metaPath, "utf-8")).toBe("concurrent metadata");
    expect(progress).toHaveBeenCalledWith("agent", "AGENTS.md + CLAUDE.md generated");
    expect(warnings).toEqual([]);
  });

  it("does not follow a dangling metadata symlink", async () => {
    const target = join(dir, "missing-target.json");
    fs.symlinkSync(target, metaPath);
    await generate();
    expect(fs.lstatSync(metaPath).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("propagates write errors other than EEXIST", async () => {
    fs.rmSync(dir, { recursive: true });
    await expect(generate()).rejects.toMatchObject({ code: "ENOENT" });
    expect(progress).not.toHaveBeenCalled();
  });

  it.each(["writeFileSync", "linkSync"] as const)(
    "cleans staging and propagates failures from %s",
    async (operation) => {
      const error = Object.assign(new Error("injected I/O failure"), { code: "EIO" });
      vi.mocked(fs[operation]).mockImplementationOnce(() => {
        throw error;
      });
      await expect(generate()).rejects.toBe(error);
      expect(fs.existsSync(metaPath)).toBe(false);
      expect(progress).not.toHaveBeenCalled();
    },
  );
});

describe("loadEnvFile", () => {
  const keys = ["hyperframes_feedback_email", "HyperFrames_Feedback_Email", "GEMINI_API_KEY"];
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), "hf-scaffold-env-"));
    vi.stubEnv("GEMINI_API_KEY", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const key of keys.slice(0, 2)) delete process.env[key];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("never takes the feedback email from a project file, in any letter case", () => {
    fs.writeFileSync(
      join(dir, ".env"),
      'hyperframes_feedback_email=a@example.com\nHyperFrames_Feedback_Email=b@example.com\nGEMINI_API_KEY="kept"\n',
    );
    loadEnvFile(join(dir, "out"));
    expect(keys.map((key) => process.env[key])).toEqual([undefined, undefined, "kept"]);
  });

  it("never accepts browser executables from an output ancestor", () => {
    const browserKeys = [
      "HYPERFRAMES_BROWSER_PATH",
      "PRODUCER_HEADLESS_SHELL_PATH",
      "hyperframes_browser_path",
    ];
    const before = browserKeys.map((key) => process.env[key]);
    try {
      for (const key of browserKeys) delete process.env[key];
      fs.writeFileSync(
        join(dir, ".env"),
        browserKeys.map((key) => `${key}=/untrusted/browser`).join("\n"),
      );
      loadEnvFile(join(dir, "out"));
      expect(browserKeys.map((key) => process.env[key])).toEqual([undefined, undefined, undefined]);
    } finally {
      browserKeys.forEach((key, index) => {
        const value = before[index];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
    }
  });

  it.each([
    "PATH",
    "Path",
    "LOCALAPPDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "HOME",
    "LD_PRELOAD",
    "ld_preload",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "NODE_OPTIONS",
    "Node_Options",
    "HYPERFRAMES_BROWSER_PATH",
    "PRODUCER_HEADLESS_SHELL_PATH",
    "localappdata",
    "UNRECOGNIZED_FUTURE_SETTING",
  ])("does not import launcher or unknown setting %s", (key) => {
    vi.stubEnv(key, undefined);
    fs.writeFileSync(join(dir, ".env"), `${key}=/untrusted/value\nGEMINI_API_KEY=allowed\n`);
    loadEnvFile(join(dir, "out"));
    expect(process.env[key]).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBe("allowed");
  });

  it("does not import a supported provider setting with the wrong letter case", () => {
    fs.writeFileSync(join(dir, ".env"), "gemini_api_key=/untrusted/value\n");
    loadEnvFile(join(dir, "out"));
    expect(process.env.gemini_api_key).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it("loads supported vision provider settings without replacing inherited credentials", () => {
    const settings = {
      OPENROUTER_API_KEY: "router-key",
      GOOGLE_API_KEY: "google-key",
      HYPERFRAMES_VERTEX_PROJECT_ID: "example-project",
      HYPERFRAMES_VERTEX_SERVICE_ACCOUNT: '{"client_email":"test@example.com"}',
      HYPERFRAMES_VERTEX_LOCATION: "us-central1",
      HYPERFRAMES_VERTEX_MODEL: "vertex-model",
      HYPERFRAMES_OPENROUTER_MODEL: "router-model",
      HYPERFRAMES_GEMINI_MODEL: "gemini-model",
      HYPERFRAMES_VISION_TIMEOUT_MS: "2000",
    };
    for (const key of Object.keys(settings)) vi.stubEnv(key, undefined);
    vi.stubEnv("GEMINI_API_KEY", "inherited-key");
    fs.writeFileSync(
      join(dir, ".env"),
      [
        "GEMINI_API_KEY=project-key",
        ...Object.entries(settings).map(([key, value]) => `${key}=${value}`),
      ].join("\n"),
    );
    loadEnvFile(join(dir, "out"));
    expect(process.env.GEMINI_API_KEY).toBe("inherited-key");
    for (const [key, value] of Object.entries(settings)) expect(process.env[key]).toBe(value);
  });

  it("can skip loading the output's dotenv file entirely", () => {
    const previous = process.env.HYPERFRAMES_NO_CAPTURE_DOTENV;
    try {
      process.env.HYPERFRAMES_NO_CAPTURE_DOTENV = "1";
      fs.writeFileSync(join(dir, ".env"), "GEMINI_API_KEY=untrusted\n");
      loadEnvFile(join(dir, "out"));
      expect(process.env.GEMINI_API_KEY).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.HYPERFRAMES_NO_CAPTURE_DOTENV;
      else process.env.HYPERFRAMES_NO_CAPTURE_DOTENV = previous;
    }
  });
});
