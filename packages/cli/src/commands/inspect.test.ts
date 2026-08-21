import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bundleToSingleHtmlFailureMock,
  metaDescription,
  resolveProjectMock,
  runAndCaptureStdio,
} from "./deprecationTestHarness.js";

// See layout.test.ts for why these two dynamic-import targets are mocked:
// resolveProject skips real filesystem resolution, and bundleToSingleHtml
// gives a fast, deterministic failure that exercises run()'s outer catch
// (the JSON failure envelope) without needing headless Chrome.
vi.mock("../utils/project.js", () => resolveProjectMock());
vi.mock("@hyperframes/core/compiler", () => bundleToSingleHtmlFailureMock());

import inspectCommand from "./inspect.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("inspect command deprecation (U5)", () => {
  it("is the compatibility alias for layout, sharing its deprecated description", () => {
    expect(metaDescription(inspectCommand)).toContain("(deprecated, use check)");
  });

  it("prints a one-line deprecation notice naming 'inspect' on stderr, never stdout", async () => {
    const { stderrText, stdoutText } = await runAndCaptureStdio(inspectCommand);
    expect(stderrText).toContain("hyperframes inspect");
    expect(stderrText).toContain("hyperframes check");
    expect(stdoutText).toBe("");
  });
});
