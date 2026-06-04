import { describe, expect, it } from "vitest";
import type { HyperframeLintFinding } from "@hyperframes/core/lint";
import { formatLintFindings } from "./lintFormat.js";
import type { ProjectLintResult } from "./lintProject.js";

function finding(
  severity: HyperframeLintFinding["severity"],
  overrides: Partial<HyperframeLintFinding> = {},
): HyperframeLintFinding {
  return { code: `${severity}-code`, severity, message: `${severity} message`, ...overrides };
}

function project(
  files: Array<{ file: string; findings: HyperframeLintFinding[] }>,
): ProjectLintResult {
  const all = files.flatMap((f) => f.findings);
  const count = (severity: HyperframeLintFinding["severity"]) =>
    all.filter((f) => f.severity === severity).length;
  return {
    results: files.map(({ file, findings }) => ({
      file,
      result: {
        ok: findings.every((f) => f.severity !== "error"),
        errorCount: findings.filter((f) => f.severity === "error").length,
        warningCount: findings.filter((f) => f.severity === "warning").length,
        infoCount: findings.filter((f) => f.severity === "info").length,
        findings,
      },
    })),
    totalErrors: count("error"),
    totalWarnings: count("warning"),
    totalInfos: count("info"),
  };
}

describe("formatLintFindings", () => {
  it("returns no lines when no file has findings", () => {
    expect(formatLintFindings(project([{ file: "index.html", findings: [] }]))).toEqual([]);
  });

  it("renders code, message, and elementId without a file label for a single file", () => {
    const lines = formatLintFindings(
      project([
        {
          file: "index.html",
          findings: [
            finding("error", {
              code: "missing-timeline",
              message: "no timeline registered",
              elementId: "main",
            }),
          ],
        },
      ]),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("✗");
    expect(lines[0]).toContain("missing-timeline");
    expect(lines[0]).toContain("[main]");
    expect(lines[0]).toContain("no timeline registered");
    expect(lines[0]).not.toContain("index.html");
  });

  it("labels each finding with its file when more than one file has results", () => {
    const lines = formatLintFindings(
      project([
        { file: "index.html", findings: [finding("error")] },
        { file: "compositions/scene.html", findings: [finding("warning")] },
      ]),
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[index.html]");
    expect(lines[1]).toContain("[compositions/scene.html]");
  });

  it("hides the elementId when showElementId is false", () => {
    const result = project([
      { file: "index.html", findings: [finding("error", { elementId: "main" })] },
    ]);

    const lines = formatLintFindings(result, { showElementId: false });
    expect(lines[0]).not.toContain("[main]");
  });

  it("marks warnings with their own prefix and skips info findings by default", () => {
    const lines = formatLintFindings(
      project([
        {
          file: "index.html",
          findings: [finding("warning"), finding("info")],
        },
      ]),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("⚠");
    expect(lines[0]).toContain("warning message");
  });

  it("includes info findings when verbose", () => {
    const lines = formatLintFindings(
      project([{ file: "index.html", findings: [finding("info")] }]),
      { verbose: true },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ℹ");
    expect(lines[0]).toContain("info message");
  });

  it("keeps the input order by default", () => {
    const lines = formatLintFindings(
      project([
        {
          file: "index.html",
          findings: [finding("warning"), finding("error")],
        },
      ]),
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("warning message");
    expect(lines[1]).toContain("error message");
  });

  it("groups errors before warnings per file when errorsFirst is set", () => {
    const lines = formatLintFindings(
      project([
        {
          file: "index.html",
          findings: [finding("warning"), finding("error")],
        },
      ]),
      { errorsFirst: true },
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("error message");
    expect(lines[1]).toContain("warning message");
  });

  it("places info findings last under errorsFirst with verbose", () => {
    const lines = formatLintFindings(
      project([
        {
          file: "index.html",
          findings: [finding("info"), finding("warning"), finding("error")],
        },
      ]),
      { errorsFirst: true, verbose: true },
    );

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("error message");
    expect(lines[1]).toContain("warning message");
    expect(lines[2]).toContain("info message");
  });

  it("appends an indented fix hint line directly after its finding", () => {
    const lines = formatLintFindings(
      project([
        {
          file: "index.html",
          findings: [finding("error", { fixHint: "add data-composition-id" }), finding("warning")],
        },
      ]),
    );

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("error message");
    expect(lines[1]).toContain("Fix: add data-composition-id");
    expect(lines[2]).toContain("warning message");
  });

  it("appends a summary line with totals when showSummary is set", () => {
    const lines = formatLintFindings(
      project([
        {
          file: "index.html",
          findings: [finding("error"), finding("error"), finding("warning")],
        },
      ]),
      { showSummary: true },
    );

    expect(lines.at(-2)).toBe("");
    expect(lines.at(-1)).toContain("2 error(s), 1 warning(s)");
  });

  it("includes the info count in the summary only when verbose", () => {
    const result = project([
      {
        file: "index.html",
        findings: [finding("error"), finding("info")],
      },
    ]);

    const quiet = formatLintFindings(result, { showSummary: true });
    expect(quiet.at(-1)).not.toContain("info(s)");

    const verbose = formatLintFindings(result, { showSummary: true, verbose: true });
    expect(verbose.at(-1)).toContain("1 error(s), 0 warning(s), 1 info(s)");
  });
});
