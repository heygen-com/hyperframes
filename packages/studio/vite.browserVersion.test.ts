import { expect, it, vi } from "vitest";
import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { browserVersion, findSystemChrome } from "./vite.browser";

it("bounds the Unix version command", () => {
  const run = vi.fn(() => "Google Chrome 152.0.7977.42\n");
  expect(browserVersion("/test/chrome", run, "linux")).toBe("Google Chrome 152.0.7977.42");
  expect(run).toHaveBeenCalledWith("/test/chrome", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
});

it("reads Windows executable metadata without executing the browser or interpolating its path", () => {
  const executable = "C:\\Program Files\\Browser's $(value)&[x]\\chrome.exe";
  const run = vi.fn(
    (_file: string, _args: string[], _options: ExecFileSyncOptionsWithStringEncoding) =>
      "152.0.7977.42\r\n",
  );
  expect(browserVersion(executable, run, "win32")).toBe("Chrome/152.0.7977.42");
  expect(
    run.mock.calls.map(([file, args, options]) => ({
      file,
      args,
      encoding: options.encoding,
      timeout: options.timeout,
      windowsHide: options.windowsHide,
      versionPath: options.env?.["HYPERFRAMES_CHROME_VERSION_PATH"],
    })),
  ).toEqual([
    {
      file: "powershell.exe",
      args: [
        "-NoProfile",
        "-Command",
        "(Get-Item -LiteralPath $env:HYPERFRAMES_CHROME_VERSION_PATH).VersionInfo.ProductVersion",
      ],
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
      versionPath: executable,
    },
  ]);
});

it.each(["Opening in existing browser session.", "", "not a version"])(
  "does not report Windows output %j as a version",
  (output) => {
    expect(browserVersion("chrome.exe", () => output, "win32")).toBeUndefined();
  },
);

it("reports an unavailable version when the probe fails", () => {
  expect(
    browserVersion(
      "/test/chrome",
      () => {
        throw new Error("probe timed out");
      },
      "linux",
    ),
  ).toBeUndefined();
});

it.runIf(process.platform === "win32")(
  "reads the selected real Windows Chrome version from metadata",
  () => {
    const executable = findSystemChrome();
    expect(executable).toBeTruthy();
    const version = browserVersion(executable!);
    console.info(`[studio-version-probe] ${executable} (${version})`);
    expect(version).toMatch(/^Chrome\/\d+\.\d+\.\d+\.\d+$/);
  },
);
