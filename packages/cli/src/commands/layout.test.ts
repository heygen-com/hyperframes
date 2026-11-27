import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliRuntimeError } from "../utils/commandResult.js";
import {
  bundleToSingleHtmlFailureMock,
  metaDescription,
  resolveProjectMock,
  runAndCaptureStdio,
  runAndFindJsonLogCall,
  runAndParseJsonEnvelope,
} from "./deprecationTestHarness.js";

// resolveProject and bundleToSingleHtml are both reached via a dynamic
// `await import(...)` inside layout.ts's run() / runLayoutAudit(), so
// vi.mock intercepts them the same way it would a static import. Mocking
// resolveProject skips real filesystem project resolution; mocking
// bundleToSingleHtml gives a deterministic, fast failure well before any
// real browser or network work — exercising run()'s outer catch (the JSON
// failure envelope) without needing headless Chrome.
vi.mock("../utils/project.js", () => resolveProjectMock());
vi.mock("@hyperframes/core/compiler", () => bundleToSingleHtmlFailureMock());

import { createInspectCommand } from "./layout.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("layout command deprecation (U5)", () => {
  it("marks both the layout and inspect command names' shared description as deprecated", () => {
    expect(metaDescription(createInspectCommand("layout"))).toContain("(deprecated, use check)");
    expect(metaDescription(createInspectCommand("inspect"))).toContain("(deprecated, use check)");
  });

  it("prints a one-line deprecation notice to stderr and never to stdout", async () => {
    const { stderrText, stdoutText } = await runAndCaptureStdio(createInspectCommand("layout"));
    expect(stderrText).toContain("hyperframes layout");
    expect(stderrText).toContain("hyperframes check");
    expect(stdoutText).toBe("");
  });

  it("--json output is valid JSON with _meta.deprecated === true on failure", async () => {
    const { parsed } = await runAndParseJsonEnvelope(createInspectCommand("layout"));
    expect(parsed.ok).toBe(false);
    expect(parsed._meta.deprecated).toBe(true);
  });

  it("the inspect command name produces the same _meta.deprecated === true envelope", async () => {
    const jsonCall = await runAndFindJsonLogCall(createInspectCommand("inspect"));
    const parsed = JSON.parse(String(jsonCall?.[0]));
    expect(parsed._meta.deprecated).toBe(true);
  });
});

describe("layout command terminal output", () => {
  it("prints a folder name and a page error with control characters as visible escapes", async () => {
    const { resolveProject } = await import("../utils/project.js");
    const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
    vi.mocked(resolveProject).mockReturnValueOnce({
      dir: "/fake-project",
      name: "evil\u001b]0;title\u0007",
      indexPath: "/fake-project/index.html",
    });
    vi.mocked(bundleToSingleHtml).mockRejectedValueOnce(
      new Error("page threw \u001b[2J\u009b\nsecond line"),
    );
    const printed: string[] = [];
    const keep = (...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    };
    vi.spyOn(console, "log").mockImplementation(keep);
    vi.spyOn(console, "error").mockImplementation(keep);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await runCommand(createInspectCommand("layout"), { rawArgs: [] }).catch((error: unknown) => {
      if (!(error instanceof CliRuntimeError && error.result.presented)) throw error;
    });

    const text = printed.join("\n");
    expect(text).toContain("evil\\x1b]0;title\\x07");
    expect(text).toContain("page threw \\x1b[2J\\x9b\nsecond line");
    for (const control of ["\u0007", "\u009b", "\u001b]", "\u001b[2J"]) {
      expect(text).not.toContain(control);
    }
  });
});
