import { describe, expect, it } from "vitest";
import { describeSharpLoadFailure } from "./sharpLoadFailure.js";

// The shape of the error sharp throws when no native binding loads (sharp/dist/sharp.mjs).
function sharpLoadError(...causes: string[]): Error {
  return new Error(
    [
      'Could not load the "sharp" module using the win32-x64 runtime',
      ...causes,
      "Possible solutions:",
      "- Ensure optional dependencies can be installed:",
      "    npm install --include=optional sharp",
    ].join("\n"),
  );
}

describe("describeSharpLoadFailure", () => {
  it("names Windows App Control when Code Integrity blocked the DLL", () => {
    const err = sharpLoadError(
      "ERR_DLOPEN_FAILED: \\\\?\\C:\\npm\\node_modules\\@img\\sharp-win32-x64\\sharp.node: An Application Control policy has blocked this file.",
    );
    expect(describeSharpLoadFailure(err)).toMatch(/^Windows App Control \(Smart App Control/);
  });

  it("keeps sharp's own first cause for any other failed load", () => {
    const err = sharpLoadError("ERR_DLOPEN_FAILED: The specified module could not be found.");
    expect(describeSharpLoadFailure(err)).toBe(
      'Could not load the "sharp" module using the win32-x64 runtime (ERR_DLOPEN_FAILED: The specified module could not be found.)',
    );
  });

  it("drops the carriage return Windows error text ends its lines with", () => {
    const err = new Error(
      'Could not load the "sharp" module using the win32-x64 runtime\r\nERR_DLOPEN_FAILED: %1 is not a valid Win32 application.\r\nPossible solutions:',
    );
    expect(describeSharpLoadFailure(err)).toBe(
      'Could not load the "sharp" module using the win32-x64 runtime (ERR_DLOPEN_FAILED: %1 is not a valid Win32 application.)',
    );
  });

  it("falls back to sharp's header when every cause was a missing package", () => {
    expect(describeSharpLoadFailure(sharpLoadError())).toBe(
      'Could not load the "sharp" module using the win32-x64 runtime',
    );
  });

  it("ignores errors that are not a failed sharp load", () => {
    expect(describeSharpLoadFailure(new Error("ENOENT: no such file"))).toBeNull();
    expect(describeSharpLoadFailure("Input file is missing")).toBeNull();
  });
});
