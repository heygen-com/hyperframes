import { readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { HF_COLOR_GRADING_ATTR, serializeHfColorGrading } from "@hyperframes/core";
import { describe, expect, it, vi } from "vitest";
import {
  buildGradeCompareHtml,
  buildGradeCompareSuccessPayload,
  capCandidateCells,
  parseGradeCompareArgs,
  parseGradesFile,
  prepareGradeCompareTempProject,
  prependBaselineCell,
  resolveLutCells,
  warnInactiveGradingCells,
} from "./grade-compare.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-grade-compare-test-"));
}

function validCubeLut(): string {
  return `LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;
}

describe("parseGradesFile", () => {
  it("parses a valid grades array into labeled cells", () => {
    const dir = tempDir();
    try {
      const file = join(dir, "grades.json");
      writeFileSync(
        file,
        JSON.stringify([
          { label: "warm", grading: { preset: "warm-daylight" } },
          { label: "punch", grading: { adjust: { exposure: 0.5, contrast: 0.4 } } },
        ]),
      );

      expect(parseGradesFile(file)).toEqual([
        { label: "warm", grading: { preset: "warm-daylight" } },
        { label: "punch", grading: { adjust: { exposure: 0.5, contrast: 0.4 } } },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors clearly for missing or invalid grades files", () => {
    const dir = tempDir();
    try {
      expect(() => parseGradesFile(join(dir, "missing.json"))).toThrow(
        /Grades file not found: .*missing\.json/,
      );

      const invalid = join(dir, "invalid.json");
      writeFileSync(invalid, JSON.stringify({ label: "not an array" }));
      expect(() => parseGradesFile(invalid)).toThrow(
        "Grades file must be a JSON array of { label, grading } objects",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("prependBaselineCell", () => {
  it("prepends an ungraded 'original' reference cell", () => {
    const candidates = resolveLutCells("/tmp/luts/film.cube");
    const withBaseline = prependBaselineCell(candidates);
    expect(withBaseline).toHaveLength(candidates.length + 1);
    // empty grading (no preset / no lut) → normalizes to inactive → renders the
    // source frame untouched, giving a reference to judge candidates against
    expect(withBaseline.at(0)).toEqual({ label: "original", grading: {} });
    expect(withBaseline.slice(1)).toEqual(candidates);
  });
});

describe("resolveLutCells", () => {
  it("expands comma-separated LUT paths into labeled grading cells", () => {
    expect(resolveLutCells("/tmp/luts/film.cube,./cool.look.cube")).toEqual([
      { label: "film", grading: { lut: { src: "/tmp/luts/film.cube" } } },
      { label: "cool.look", grading: { lut: { src: "./cool.look.cube" } } },
    ]);
  });
});

describe("parseGradeCompareArgs", () => {
  it("requires exactly one grade source", () => {
    expect(() => parseGradeCompareArgs({ for: "frame.png" })).toThrow(
      "Exactly one of --grades or --luts is required",
    );
    expect(() =>
      parseGradeCompareArgs({ for: "frame.png", grades: "grades.json", luts: "a.cube" }),
    ).toThrow("Exactly one of --grades or --luts is required");
  });
});

describe("buildGradeCompareHtml", () => {
  it("renders one labeled color-graded image per cell with composition metadata", () => {
    const cells = [
      { label: "warm <daylight>", grading: { preset: "warm-daylight" } },
      { label: "cool", grading: { adjust: { temperature: -0.8 } } },
      { label: "punchy", grading: { adjust: { exposure: 0.5, contrast: 0.4 } } },
    ];

    const html = buildGradeCompareHtml({
      cells,
      frameSrc: "frame.png",
      frameWidth: 640,
      frameHeight: 360,
    });

    const escapedAttr = HF_COLOR_GRADING_ATTR.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const attrPattern = new RegExp(`<img[^>]+${escapedAttr}=`, "g");
    expect(html.match(attrPattern)).toHaveLength(cells.length);
    expect(html).toContain('data-composition-id="grade-compare"');
    expect(html).toContain('data-width="1168"');
    expect(html).toContain('data-height="742"');
    expect(html).toContain('data-duration="1"');
    expect(html).toContain("warm &lt;daylight&gt;");
    for (const cell of cells) {
      expect(html).toContain(`${HF_COLOR_GRADING_ATTR}='${serializeHfColorGrading(cell.grading)}'`);
    }
  });
});

describe("prepareGradeCompareTempProject", () => {
  it("copies the frame and LUTs into a temp project and rewrites LUT src values", async () => {
    const dir = tempDir();
    try {
      const framePath = join(dir, "frame.png");
      const lutPath = join(dir, "look.cube");
      writeFileSync(framePath, "fake-png");
      writeFileSync(lutPath, validCubeLut());

      const prepared = await prepareGradeCompareTempProject({
        projectDir: dir,
        framePath,
        frameBuffer: Buffer.from("fake-png"),
        cells: [
          { label: "film", grading: { lut: { src: basename(lutPath), intensity: 0.7 } } },
          { label: "warm", grading: { preset: "warm-daylight" } },
        ],
        frameWidth: 640,
        frameHeight: 360,
      });

      try {
        expect(readFileSync(join(prepared.tempDir, "frame.png"), "utf-8")).toBe("fake-png");
        expect(readFileSync(join(prepared.tempDir, "lut-0.cube"), "utf-8")).toBe(validCubeLut());
        expect(readFileSync(join(prepared.tempDir, "index.html"), "utf-8")).toContain(
          `${HF_COLOR_GRADING_ATTR}='${serializeHfColorGrading({
            lut: { src: "lut-0.cube", intensity: 0.7 },
          })}'`,
        );
      } finally {
        rmSync(prepared.tempDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an existing LUT file whose .cube content cannot be parsed", async () => {
    const dir = tempDir();
    try {
      const framePath = join(dir, "frame.png");
      const lutPath = join(dir, "broken.cube");
      writeFileSync(framePath, "fake-png");
      writeFileSync(lutPath, "plain text, not cube data\n");

      await expect(
        prepareGradeCompareTempProject({
          projectDir: dir,
          framePath,
          frameBuffer: Buffer.from("fake-png"),
          cells: [{ label: "broken look", grading: { lut: { src: basename(lutPath) } } }],
          frameWidth: 640,
          frameHeight: 360,
        }),
      ).rejects.toThrow(/LUT for "broken look" is not a valid \.cube:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("warnInactiveGradingCells", () => {
  it("warns to stderr for normalized-but-inactive candidate grades", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(() =>
        warnInactiveGradingCells([{ label: "numeric lut", grading: { lut: 12345 } }]),
      ).not.toThrow();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Warning: grading for "numeric lut" is inactive/no-op — it will render ungraded',
        ),
      );
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("capCandidateCells", () => {
  it("truncates over-cap candidates and exposes truncation metadata for JSON output", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const cells = Array.from({ length: 18 }, (_, index) => ({
        label: `candidate ${index + 1}`,
        grading: { adjust: { exposure: index / 10 } },
      }));

      const capped = capCandidateCells(cells);

      expect(capped.cells).toHaveLength(16);
      expect(capped.cells.at(0)?.label).toBe("candidate 1");
      expect(capped.cells.at(15)?.label).toBe("candidate 16");
      expect(capped.truncated).toBe(true);
      expect(capped.total).toBe(18);
      expect(buildGradeCompareSuccessPayload("grade-compare.png", 17, capped)).toEqual({
        ok: true,
        sheet: "grade-compare.png",
        cells: 17,
        truncated: true,
        total: 18,
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Warning: 18 candidate grades exceed the 16-cell cap — rendering the first 16 of 18; re-run with fewer grades or split into multiple runs.",
        ),
      );
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
