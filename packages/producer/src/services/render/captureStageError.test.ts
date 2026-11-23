import { describe, expect, it } from "vitest";
import { CaptureFailure } from "@hyperframes/engine";
import { getCaptureStageBrowserConsole } from "./captureStageError.js";

describe("getCaptureStageBrowserConsole", () => {
  it("returns the page-error lines a failed parallel capture carried", () => {
    const failure = new CaptureFailure({
      kind: "authoring",
      message: "[Parallel] Capture failed: Worker 0: boom",
      pageErrorLines: ["[Browser:PAGEERROR] Identifier 'dup' has already been declared"],
    });

    expect(getCaptureStageBrowserConsole(failure)).toEqual([
      "[Browser:PAGEERROR] Identifier 'dup' has already been declared",
    ]);
  });

  it("returns nothing for an error that carries no console", () => {
    expect(getCaptureStageBrowserConsole(new Error("plain"))).toEqual([]);
  });
});
