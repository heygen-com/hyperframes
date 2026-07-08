import { isTransientBrowserError } from "@hyperframes/engine";

export function macosChromeCrashRemediation(
  errorMessage: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): string | undefined {
  if (platform !== "darwin" || arch !== "arm64") return undefined;
  if (!isTransientBrowserError(errorMessage)) return undefined;

  const lines: string[] = [];
  lines.push("This matches a known chrome-headless-shell crash pattern on Apple Silicon macOS.");
  lines.push(
    "Re-run with Docker to render inside a Linux container instead of the native macOS browser:",
  );
  lines.push("  HYPERFRAMES_DOCKER_PLATFORM=linux/amd64 npx hyperframes render --docker");
  lines.push("Or point HyperFrames at a different local Chrome or Chromium build:");
  lines.push("  HYPERFRAMES_BROWSER_PATH=/path/to/chrome npx hyperframes render");
  return lines.join("\n");
}
