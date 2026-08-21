import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GSAP_MUTATION_CAPABILITIES,
  acornDefaultBlockers,
  renderGsapMutationCapabilityReport,
  resolveGsapWriter,
} from "./gsapMutationCapabilities.js";

const source = readFileSync(resolve(process.cwd(), "src/routes/files.ts"), "utf8");

function dispatcherCases(startMarker: string, endMarker: string): string[] {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Could not locate dispatcher ${startMarker}`);
  return [...source.slice(start, end).matchAll(/case\s+"([^"]+)"/g)].map((match) => match[1]!);
}

describe("GSAP writer capability matrix", () => {
  const operations = Object.keys(GSAP_MUTATION_CAPABILITIES).sort();

  it("matches every Acorn and Recast dispatcher case", () => {
    expect(
      dispatcherCases(
        "function executeGsapMutationAcorn",
        "async function executeGsapMutationRecast",
      ).sort(),
    ).toEqual(operations);
    expect(
      dispatcherCases(
        "async function executeGsapMutationRecast",
        "function registerFileRoutes",
      ).sort(),
    ).toEqual(operations);
  });

  it("keeps the Acorn dispatcher free of Recast and gates hold sync with the selected writer", () => {
    const acornBody = source.slice(
      source.indexOf("function executeGsapMutationAcorn"),
      source.indexOf("async function executeGsapMutationRecast"),
    );
    const mutationHelperBody = source.slice(
      source.indexOf("async function applyGsapMutations"),
      source.indexOf("function executeGsapMutationAcorn"),
    );
    const atomicCutHelperBody = source.slice(
      source.indexOf("async function foldAtomicCutFile"),
      source.indexOf("function registerFileRoutes"),
    );
    expect(acornBody).not.toContain("loadGsapParser");
    expect(mutationHelperBody).toContain('writer === "acorn"');
    expect(mutationHelperBody).toContain("? syncPositionHoldsBeforeKeyframes(newScript)");
    expect(mutationHelperBody).toContain(
      "(await loadGsapParser()).syncPositionHoldsBeforeKeyframes",
    );
    expect(atomicCutHelperBody).toContain('writer === "acorn"');
    expect(atomicCutHelperBody).toContain("? syncPositionHoldsBeforeKeyframes(script)");
    expect(atomicCutHelperBody).toContain(
      "(await loadGsapParser()).syncPositionHoldsBeforeKeyframes(script)",
    );
  });

  it("renders every classified operation and keeps default blocked until parity is differential", () => {
    const report = renderGsapMutationCapabilityReport();
    for (const operation of operations) expect(report).toContain(`| ${operation} |`);
    expect(acornDefaultBlockers().length).toBeGreaterThan(0);
  });

  it("defaults to Recast and requires an explicit Acorn canary selection", () => {
    expect(resolveGsapWriter({})).toBe("recast");
    expect(resolveGsapWriter({ HYPERFRAMES_GSAP_WRITER: "acorn" })).toBe("acorn");
    expect(() => resolveGsapWriter({ HYPERFRAMES_GSAP_WRITER: "unknown" })).toThrow(
      "expected recast or acorn",
    );
  });
});
