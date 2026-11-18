import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildCompareSuccessPayload,
  capCompareVariants,
  parseCompareArgs,
  prepareCompareVariantProjects,
} from "./compare.js";

const temporaryRoot = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, tmpdir: () => temporaryRoot.path || actual.tmpdir() };
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-compare-test-"));
}

describe("parseCompareArgs", () => {
  it("requires at least two composition paths", () => {
    expect(() => parseCompareArgs({ _: ["variant-a"] }, "/tmp")).toThrow(
      "need 2+ paths to compare",
    );
  });

  it("rejects --labels when the count does not match the path count", () => {
    expect(() =>
      parseCompareArgs({ _: ["variant-a", "variant-b"], labels: "one,two,three" }, "/tmp"),
    ).toThrow("--labels count (3) must match path count (2)");
  });

  it("derives default labels from directory basenames and html filenames", () => {
    const parsed = parseCompareArgs(
      { _: ["./looks/warm", "./looks/cool.html", "/tmp/hero.alt.html"] },
      "/work/project",
    );

    // Labels are the subject here — derived cross-platform via path.basename.
    // (inputPath/displayPath are absolute/relative resolutions that differ by OS
    // — separators + drive letter on Windows — and are covered by the resolution
    // tests; asserting them literally here made this a POSIX-only test.)
    expect(parsed.variants.map((v) => v.label)).toEqual(["warm", "cool", "hero.alt"]);
  });

  it("uses the default timeout when --timeout is omitted", () => {
    expect(parseCompareArgs({ _: ["variant-a", "variant-b"] }, "/tmp").timeoutMs).toBe(5000);
  });

  it("accepts a positive integer --timeout", () => {
    expect(
      parseCompareArgs({ _: ["variant-a", "variant-b"], timeout: "1000" }, "/tmp").timeoutMs,
    ).toBe(1000);
  });

  it.each(["abc", "-1", "0", "2.5"])("rejects --timeout %s", (timeout) => {
    expect(() => parseCompareArgs({ _: ["variant-a", "variant-b"], timeout }, "/tmp")).toThrow(
      "--timeout must be a positive integer",
    );
  });
});

describe("capCompareVariants", () => {
  it("truncates over-cap variants and exposes truncation metadata for JSON output", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const variants = Array.from({ length: 20 }, (_, index) => ({
        label: `variant ${index + 1}`,
        inputPath: `/tmp/variant-${index + 1}`,
        displayPath: `variant-${index + 1}`,
      }));

      const capped = capCompareVariants(variants);

      expect(capped.variants).toHaveLength(16);
      expect(capped.variants.at(0)?.label).toBe("variant 1");
      expect(capped.variants.at(15)?.label).toBe("variant 16");
      expect(capped.truncated).toBe(true);
      expect(capped.total).toBe(20);
      expect(buildCompareSuccessPayload("/tmp/compare.png", capped.variants, capped)).toMatchObject(
        {
          ok: true,
          sheet: "/tmp/compare.png",
          rendered: 16,
          truncated: true,
          total: 20,
        },
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Warning: 20 compare variants exceed the 16-variant cap"),
      );
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("prepareCompareVariantProjects", () => {
  it("keeps earlier temporary staging folders out of later variants", () => {
    const dir = tempDir();
    const first = join(dir, "first.html");
    const second = join(dir, "second.html");
    writeFileSync(first, "<!doctype html><title>First</title>");
    writeFileSync(second, "<!doctype html><title>Second</title>");
    temporaryRoot.path = dir;

    try {
      const prepared = prepareCompareVariantProjects([
        { label: "First", inputPath: first, displayPath: "first.html" },
        { label: "Second", inputPath: second, displayPath: "second.html" },
      ]);
      const firstStage = prepared[0];
      const secondStage = prepared[1];
      if (!firstStage || !secondStage) throw new Error("expected two staged variants");
      expect(existsSync(join(secondStage.projectDir, basename(firstStage.projectDir)))).toBe(false);
      expect(readdirSync(secondStage.projectDir)).toEqual(["index.html"]);
      expect(readFileSync(join(secondStage.projectDir, "index.html"), "utf8")).toContain("Second");
    } finally {
      temporaryRoot.path = "";
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["direct", "nested"])(
    "stages only what the page names when the temporary output is %s inside the source directory",
    (placement) => {
      const dir = tempDir();
      const htmlFile = join(dir, "candidate.html");
      mkdirSync(join(dir, "assets"));
      writeFileSync(
        htmlFile,
        '<!doctype html><title>Temporary candidate</title><img src="assets/asset.png">',
      );
      writeFileSync(join(dir, "assets", "asset.png"), "sibling asset");
      writeFileSync(join(dir, "assets", "unnamed.png"), "not named");
      temporaryRoot.path = placement === "direct" ? dir : join(dir, "temporary");
      mkdirSync(temporaryRoot.path, { recursive: true });
      writeFileSync(join(temporaryRoot.path, "sibling.txt"), "temporary-root sibling");

      try {
        const prepared = prepareCompareVariantProjects([
          { label: "Temp", inputPath: htmlFile, displayPath: "candidate.html" },
        ]);
        const staged = prepared[0];
        if (!staged) throw new Error("expected a staged variant");
        expect(staged.stagedDir).toBe(staged.projectDir);
        expect(readFileSync(join(staged.projectDir, "index.html"), "utf8")).toContain(
          "Temporary candidate",
        );
        expect(readFileSync(join(staged.projectDir, "assets", "asset.png"), "utf8")).toBe(
          "sibling asset",
        );
        expect(readdirSync(staged.projectDir).sort()).toEqual(["assets", "index.html"]);
        expect(readdirSync(join(staged.projectDir, "assets"))).toEqual(["asset.png"]);
        expect(readFileSync(htmlFile, "utf8")).toContain("Temporary candidate");
      } finally {
        temporaryRoot.path = "";
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("leaves out a file the page names that no composition loads", () => {
    const dir = tempDir();
    const htmlFile = join(dir, "sent.html");
    writeFileSync(
      htmlFile,
      `<img src="taxes.pdf"><img src="notes.txt"><link href=".env"><img src="id_ed25519">
       <script>fetch("statement.png").then((r) => r.blob())</script>`,
    );
    for (const name of ["taxes.pdf", "notes.txt", ".env", "id_ed25519", "statement.png"]) {
      writeFileSync(join(dir, name), "private");
    }

    const prepared = prepareCompareVariantProjects([
      { label: "Sent", inputPath: htmlFile, displayPath: "sent.html" },
    ]);
    try {
      expect(readdirSync(prepared[0]!.projectDir)).toEqual(["index.html"]);
    } finally {
      rmSync(prepared[0]!.projectDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses project directories directly and stages standalone html files as index.html", () => {
    const dir = tempDir();
    try {
      const projectDir = join(dir, "variant-a");
      const htmlDir = join(dir, "variant-b");
      const projectIndex = join(projectDir, "index.html");
      const htmlFile = join(htmlDir, "candidate.html");
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(htmlDir, { recursive: true });
      writeFileSync(projectIndex, "<!doctype html><title>A</title>", { flag: "wx" });
      writeFileSync(htmlFile, '<!doctype html><title>B</title><img src="asset.png">', {
        flag: "wx",
      });
      writeFileSync(join(htmlDir, "asset.png"), "asset");

      const prepared = prepareCompareVariantProjects([
        { label: "A", inputPath: projectDir, displayPath: "variant-a" },
        { label: "B", inputPath: htmlFile, displayPath: "variant-b/candidate.html" },
      ]);

      try {
        expect(prepared).toHaveLength(2);
        expect(prepared[0]).toMatchObject({
          label: "A",
          inputPath: projectDir,
          displayPath: "variant-a",
          projectDir,
        });
        expect(prepared[0]?.stagedDir).toBeUndefined();
        expect(prepared[1]?.projectDir).not.toBe(htmlDir);
        expect(prepared[1]?.stagedDir).toBe(prepared[1]?.projectDir);
        expect(readFileSync(join(prepared[1]!.projectDir, "index.html"), "utf-8")).toContain(
          "<title>B</title>",
        );
        expect(readFileSync(join(prepared[1]!.projectDir, "asset.png"), "utf-8")).toBe("asset");
        expect(existsSync(join(prepared[1]!.projectDir, "candidate.html"))).toBe(false);
      } finally {
        for (const variant of prepared) {
          if (variant.stagedDir) rmSync(variant.stagedDir, { recursive: true, force: true });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors clearly for inputs that are not composition projects or html files", () => {
    const dir = tempDir();
    try {
      const badFile = join(dir, "notes.txt");
      writeFileSync(badFile, "not a composition");

      expect(() =>
        prepareCompareVariantProjects([
          { label: "notes", inputPath: badFile, displayPath: "notes.txt" },
          { label: "other", inputPath: join(dir, "missing"), displayPath: "missing" },
        ]),
      ).toThrow(/not a composition input.*notes\.txt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
