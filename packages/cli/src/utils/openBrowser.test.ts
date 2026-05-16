import { describe, it, expect } from "vitest";
import { buildBrowserArgs } from "./openBrowser.js";

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
});
