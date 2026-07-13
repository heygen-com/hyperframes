import { describe, it, expect } from "vitest";
import {
  buildBrowserArgs,
  parseRemoteDebuggingPort,
  validateRemoteDebuggingPortDeps,
} from "./openBrowser.js";

describe("buildBrowserArgs", () => {
  it("returns only the URL when no options are given", () => {
    expect(buildBrowserArgs("http://localhost:3002", {})).toEqual(["http://localhost:3002"]);
  });

  it("returns only the URL when only browserPath is set (args do not include it)", () => {
    // browserPath is used by the caller to decide spawn vs open, not in args
    expect(buildBrowserArgs("http://localhost:3002", { browserPath: "/usr/bin/chromium" })).toEqual(
      ["http://localhost:3002"],
    );
  });

  it("prepends --user-data-dir before the URL", () => {
    expect(
      buildBrowserArgs("http://localhost:3002", {
        userDataDir: "D:\\tmp\\profile",
      }),
    ).toEqual(["--user-data-dir=D:\\tmp\\profile", "http://localhost:3002"]);
  });

  it("prepends --user-data-dir with both options", () => {
    expect(
      buildBrowserArgs("http://localhost:3002", {
        browserPath: "/usr/bin/chromium",
        userDataDir: "/tmp/hf-profile",
      }),
    ).toEqual(["--user-data-dir=/tmp/hf-profile", "http://localhost:3002"]);
  });

  it("handles paths with spaces", () => {
    expect(
      buildBrowserArgs("http://localhost:3002", {
        userDataDir: "C:\\Documents and Settings\\profile",
      }),
    ).toEqual(["--user-data-dir=C:\\Documents and Settings\\profile", "http://localhost:3002"]);
  });

  it("omits --remote-debugging-port when userDataDir is missing (defense in depth)", () => {
    // The CLI validation layer rejects this combination upstream, but
    // buildBrowserArgs must not leak a CDP endpoint into the user's main
    // profile even if a caller bypasses that check.
    expect(
      buildBrowserArgs("http://localhost:3002", {
        browserPath: "/usr/bin/chromium",
        remoteDebuggingPort: 9222,
      }),
    ).toEqual(["http://localhost:3002"]);
  });

  it("includes all flags together", () => {
    expect(
      buildBrowserArgs("http://localhost:3002", {
        browserPath: "/usr/bin/chromium",
        userDataDir: "/tmp/hf-profile",
        remoteDebuggingPort: 9222,
      }),
    ).toEqual([
      "--user-data-dir=/tmp/hf-profile",
      "--remote-debugging-port=9222",
      "http://localhost:3002",
    ]);
  });
});

describe("parseRemoteDebuggingPort", () => {
  it("returns undefined for undefined", () => {
    expect(parseRemoteDebuggingPort(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseRemoteDebuggingPort("")).toBeUndefined();
  });

  it("parses a valid port number", () => {
    expect(parseRemoteDebuggingPort("9222")).toBe(9222);
  });

  it("parses port 1 (minimum)", () => {
    expect(parseRemoteDebuggingPort("1")).toBe(1);
  });

  it("parses port 65535 (maximum)", () => {
    expect(parseRemoteDebuggingPort("65535")).toBe(65535);
  });

  it("rejects 0", () => {
    expect(() => parseRemoteDebuggingPort("0")).toThrow(
      "--remote-debugging-port must be an integer between 1 and 65535",
    );
  });

  it("rejects negative numbers", () => {
    expect(() => parseRemoteDebuggingPort("-1")).toThrow();
  });

  it("rejects non-numeric input", () => {
    expect(() => parseRemoteDebuggingPort("abc")).toThrow();
  });

  it("rejects trailing non-digits (no parseInt leakage)", () => {
    expect(() => parseRemoteDebuggingPort("9222abc")).toThrow();
  });

  it("rejects numbers above 65535", () => {
    expect(() => parseRemoteDebuggingPort("70000")).toThrow();
  });

  it("rejects decimals", () => {
    expect(() => parseRemoteDebuggingPort("22.5")).toThrow();
  });
});

describe("validateRemoteDebuggingPortDeps", () => {
  it("returns null when --remote-debugging-port is not set", () => {
    expect(validateRemoteDebuggingPortDeps({})).toBeNull();
  });

  it("returns null when all required flags are present", () => {
    expect(
      validateRemoteDebuggingPortDeps({
        browserPath: "/usr/bin/chromium",
        userDataDir: "/tmp/hf-profile",
        remoteDebuggingPort: "9222",
      }),
    ).toBeNull();
  });

  it("requires --browser-path when --remote-debugging-port is set", () => {
    expect(
      validateRemoteDebuggingPortDeps({
        userDataDir: "/tmp/hf-profile",
        remoteDebuggingPort: "9222",
      }),
    ).toBe("--remote-debugging-port requires --browser-path");
  });

  it("requires --user-data-dir when --remote-debugging-port is set", () => {
    expect(
      validateRemoteDebuggingPortDeps({
        browserPath: "/usr/bin/chromium",
        remoteDebuggingPort: "9222",
      }),
    ).toBe("--remote-debugging-port requires --user-data-dir");
  });

  it("reports --browser-path first when both deps are missing", () => {
    expect(
      validateRemoteDebuggingPortDeps({
        remoteDebuggingPort: "9222",
      }),
    ).toBe("--remote-debugging-port requires --browser-path");
  });
});

describe("buildBrowserArgs --disable-gpu", () => {
  it("appends --disable-gpu before the url when disableGpu is set", () => {
    expect(buildBrowserArgs("http://localhost:3002", { disableGpu: true })).toEqual([
      "--disable-gpu",
      "http://localhost:3002",
    ]);
  });

  it("omits --disable-gpu by default", () => {
    expect(buildBrowserArgs("http://localhost:3002", {})).toEqual(["http://localhost:3002"]);
  });
});
