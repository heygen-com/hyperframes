import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonFlag } from "./jsonFlag.js";

const io = {
  readFile: (path: string) => {
    if (path !== "g.json") throw new Error("ENOENT: no such file");
    return '{"preset":"warm-daylight"}';
  },
  readStdin: () => '{"preset":"skin-soft"}',
};

describe("readJsonFlag", () => {
  it("reads inline JSON, a file path and - for stdin the same way", () => {
    expect(readJsonFlag("--grading", '{"preset":"a"}', io)).toEqual({ preset: "a" });
    expect(readJsonFlag("--grading", "g.json", io)).toEqual({ preset: "warm-daylight" });
    expect(readJsonFlag("--grading", "-", io)).toEqual({ preset: "skin-soft" });
  });

  it("points the quote-stripped value PowerShell passes at the file and stdin forms", () => {
    expect(() => readJsonFlag("--grading", "{preset:skin-soft,intensity:0.6}", io)).toThrow(
      /PowerShell.*--grading payload\.json.*--grading -/,
    );
  });

  it("points a value with its braces stripped, read as a missing file, at the file and stdin forms", () => {
    expect(() => readJsonFlag("--grading", "preset:skin-soft", io)).toThrow(
      /Could not read --grading: preset:skin-soft: ENOENT.*PowerShell.*--grading payload\.json/,
    );
  });

  it("does not call a missing Windows drive path inline JSON", () => {
    expect(() => readJsonFlag("--grading", "C:\\clips\\grade.json", io)).toThrow(/no such file$/);
  });

  it("names the flag and path when the file cannot be read", () => {
    expect(() => readJsonFlag("--grading", "missing.json", io)).toThrow(
      /Could not read --grading: missing\.json: ENOENT/,
    );
  });
});

describe("readJsonFlag file encodings", () => {
  it("reads a UTF-8 file with a BOM and a UTF-16LE file, as PowerShell writes them", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-json-flag-enc-"));
    try {
      writeFileSync(join(dir, "bom.json"), Buffer.from('\uFEFF{"a":1}', "utf8"));
      writeFileSync(join(dir, "u16.json"), Buffer.from('\uFEFF{"a":2}', "utf16le"));
      expect(readJsonFlag("--grading", join(dir, "bom.json"))).toEqual({ a: 1 });
      expect(readJsonFlag("--grading", join(dir, "u16.json"))).toEqual({ a: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
