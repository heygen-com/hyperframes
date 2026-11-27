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

it.each([
  { layout: "Chrome for Testing", entries: ["chrome.exe", "155.0.8059.39.manifest", "locales"] },
  { layout: "an installed Chrome", entries: ["chrome.exe", "155.0.8059.39", "SetupMetrics"] },
])(
  "reads the Windows version of $layout from the entry beside chrome.exe, starting no process",
  ({ entries }) => {
    const run = vi.fn(() => {
      throw new Error("PowerShell did not start within 5 s");
    });
    const executable = "C:\\Browsers\\chrome-win64\\chrome.exe";
    const listed = vi.fn(() => entries);
    expect(browserVersion(executable, run, "win32", listed)).toBe("Chrome/155.0.8059.39");
    expect(listed).toHaveBeenCalledWith("C:\\Browsers\\chrome-win64");
    expect(run).not.toHaveBeenCalled();
  },
);

it("asks PowerShell when two versions sit beside chrome.exe, as during an update", () => {
  const run = vi.fn(() => "156.0.8100.10\r\n");
  const listed = () => ["chrome.exe", "155.0.8059.39", "156.0.8100.10"];
  expect(browserVersion("C:\\Chrome\\chrome.exe", run, "win32", listed)).toBe(
    "Chrome/156.0.8100.10",
  );
  expect(run).toHaveBeenCalledOnce();
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
