import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function folderWith(prefix: string, files: string[]): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  for (const file of files) writeFileSync(join(dir, file), "");
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Windows lists the working directory before PATH; a same-named file in the project must lose.
it("on Windows, never takes whisper-cli or parakeet-mlx from the working directory", async () => {
  const project = folderWith("hf-trusted-project-", ["whisper-cli.exe", "parakeet-mlx.exe"]);
  const tools = folderWith("hf-trusted-tools-", ["whisper-cli.exe", "parakeet-mlx.exe"]);
  vi.stubEnv("HYPERFRAMES_CACHE_DIR", folderWith("hf-trusted-cache-", []));
  vi.stubEnv("HYPERFRAMES_WHISPER_PATH", "");
  vi.stubEnv("HYPERFRAMES_PARAKEET", "");
  vi.stubEnv("HOME", folderWith("hf-trusted-home-", []));
  vi.stubEnv("USERPROFILE", process.env.HOME ?? "");
  vi.spyOn(process, "cwd").mockReturnValue(project);
  vi.resetModules();
  const { findWhisper } = await import("./manager.js");
  const { findParakeet } = await import("./parakeet.js");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });

  vi.stubEnv("PATH", [project, ".", ""].join(delimiter));
  expect(findWhisper()).toBeUndefined();
  expect(findParakeet()).toBeUndefined();

  vi.stubEnv("PATH", [project, tools].join(delimiter));
  expect(findWhisper()).toEqual({
    executablePath: join(tools, "whisper-cli.exe"),
    source: "system",
  });
  expect(findParakeet()).toBe(join(tools, "parakeet-mlx.exe"));
});
