import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseRenderOptions, prepareRenderBody } from "./server.js";

describe("parseRenderOptions — variables", () => {
  it("forwards a plain JSON object", () => {
    const opts = parseRenderOptions({ variables: { title: "Hello", n: 3 } });
    expect(opts.variables).toEqual({ title: "Hello", n: 3 });
  });

  it("drops non-object variables to undefined", () => {
    expect(parseRenderOptions({ variables: [1, 2] }).variables).toBeUndefined();
    expect(parseRenderOptions({ variables: "nope" }).variables).toBeUndefined();
    expect(parseRenderOptions({ variables: null }).variables).toBeUndefined();
    expect(parseRenderOptions({}).variables).toBeUndefined();
  });
});

describe("parseRenderOptions — outputResolution", () => {
  it("normalizes canonical presets and aliases", () => {
    expect(parseRenderOptions({ outputResolution: "landscape-4k" }).outputResolution).toBe(
      "landscape-4k",
    );
    expect(parseRenderOptions({ outputResolution: "4k" }).outputResolution).toBe("landscape-4k");
    expect(parseRenderOptions({ outputResolution: "portrait-4k" }).outputResolution).toBe(
      "portrait-4k",
    );
    expect(parseRenderOptions({ outputResolution: "square" }).outputResolution).toBe("square");
  });

  it("drops unknown / non-string resolutions to undefined", () => {
    expect(parseRenderOptions({ outputResolution: "8k" }).outputResolution).toBeUndefined();
    expect(parseRenderOptions({ outputResolution: 123 }).outputResolution).toBeUndefined();
    expect(parseRenderOptions({}).outputResolution).toBeUndefined();
  });
});

describe("parseRenderOptions — render strictness", () => {
  it("preserves best-effort compatibility and requires an explicit strict opt-in", () => {
    expect(parseRenderOptions({}).strictness).toBe("best-effort");
    expect(parseRenderOptions({ bestEffort: true }).strictness).toBe("best-effort");
    expect(parseRenderOptions({ bestEffort: false }).strictness).toBe("strict");
  });
});

describe("parseRenderOptions — outputDynamicRange", () => {
  it.each(["auto", "hdr", "sdr"] as const)("forwards %s", (outputDynamicRange) => {
    expect(parseRenderOptions({ outputDynamicRange }).outputDynamicRange).toBe(outputDynamicRange);
  });

  it("drops invalid values from the lenient parser", () => {
    expect(
      parseRenderOptions({ outputDynamicRange: "force-sdr" }).outputDynamicRange,
    ).toBeUndefined();
    expect(parseRenderOptions({ outputDynamicRange: true }).outputDynamicRange).toBeUndefined();
  });

  it.each([
    ["auto", "auto"],
    ["force-hdr", "hdr"],
    ["force-sdr", "sdr"],
  ] as const)("maps legacy hdrMode %s to %s", (hdrMode, outputDynamicRange) => {
    expect(parseRenderOptions({ hdrMode }).outputDynamicRange).toBe(outputDynamicRange);
  });

  it("prefers the canonical field when both equivalent fields are present", () => {
    expect(
      parseRenderOptions({ outputDynamicRange: "sdr", hdrMode: "force-sdr" }).outputDynamicRange,
    ).toBe("sdr");
  });
});

describe("prepareRenderBody — validation", () => {
  it.each(["", "   "])(
    "treats an empty projectDir as absent and uses inline HTML",
    async (projectDir) => {
      const result = await prepareRenderBody({
        projectDir,
        html: "<html><body>inline</body></html>",
      });
      expect(result).toHaveProperty("prepared");
      if (!("prepared" in result)) return;
      expect(result.prepared.input.projectDir).not.toBe(process.cwd());
      rmSync(result.prepared.cleanupProjectDir!, { recursive: true, force: true });
    },
  );

  it("rejects an explicitly-supplied non-object variables", async () => {
    const result = await prepareRenderBody({ variables: [1, 2], html: "<html></html>" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("variables must be a JSON object");
  });

  it("rejects an explicitly-supplied invalid outputDynamicRange", async () => {
    const result = await prepareRenderBody({
      outputDynamicRange: "force-sdr",
      html: "<html></html>",
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain(
      'outputDynamicRange must be one of: "auto", "hdr", "sdr"',
    );
  });

  it("rejects conflicting canonical and legacy policies", async () => {
    const result = await prepareRenderBody({
      outputDynamicRange: "sdr",
      hdrMode: "force-hdr",
      html: "<html></html>",
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain(
      "outputDynamicRange and legacy hdrMode must describe the same output policy",
    );
  });

  it("rejects an explicitly-supplied invalid outputResolution", async () => {
    const result = await prepareRenderBody({ outputResolution: "8k", html: "<html></html>" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Invalid outputResolution");
  });

  it("rejects a non-string outputResolution instead of silently dropping it", async () => {
    const result = await prepareRenderBody({ outputResolution: 123, html: "<html></html>" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("must be a string preset");
  });

  it("rejects outputResolution combined with an alpha format (webm/mov)", async () => {
    for (const format of ["webm", "mov"]) {
      const result = await prepareRenderBody({
        outputResolution: "4k",
        format,
        html: "<html></html>",
      });
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("can't supersample");
    }
  });

  it("threads variables + outputResolution into the prepared render input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-server-test-"));
    writeFileSync(join(dir, "index.html"), "<html><body></body></html>", "utf-8");

    const result = await prepareRenderBody({
      projectDir: dir,
      variables: { title: "Q4" },
      outputResolution: "4k",
    });

    expect(result).toHaveProperty("prepared");
    const { input } = (result as { prepared: { input: Record<string, unknown> } }).prepared;
    expect(input.variables).toEqual({ title: "Q4" });
    expect(input.outputResolution).toBe("landscape-4k");
  });
});
