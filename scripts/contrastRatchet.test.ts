// guards: packages/studio/src/styles/**, packages/studio/src/components/editor/FileTreeIcons.tsx
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  composite,
  contrast,
  measure,
  parseBaseline,
  parseColor,
  parseManifest,
  verdict,
} from "./contrast";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const pair = {
  id: "label",
  foreground: "--fg",
  background: ["--bg"],
  role: "text",
  minimum: 4.5,
  sources: ["fixture.css:1"],
};
const themes = (pairs: unknown[] = [pair]) =>
  parseManifest(
    JSON.stringify({ themes: [{ id: "dark", selector: ":root", canvas: "--bg", pairs }] }),
  );
const css = (fg: string) => `:root { --fg: ${fg}; --bg: #000; }`;

function previousBaseline(fallback: ReturnType<typeof parseBaseline>, base = "origin/main") {
  const path = "scripts/contrast-baseline.json";
  const files = execFileSync("git", ["ls-tree", "--full-tree", "--name-only", base, "--", path], {
    encoding: "utf8",
  });
  if (!files.trim()) return fallback;
  return parseBaseline(execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8" }));
}

describe("WCAG contrast calculation", () => {
  it("matches the independent black/white reference ratio of 21", () => {
    expect(contrast(parseColor("#fff"), parseColor("#000"))).toBe(21);
    expect(contrast(parseColor("#000"), parseColor("#000"))).toBe(1);
  });
  it("normalizes short hex, alpha hex and percentage RGB without rounding", () => {
    expect(parseColor("#fff3")).toEqual([1, 1, 1, 0.2]);
    expect(parseColor("rgb(100% 0% 0% / 20%)")).toEqual([1, 0, 0, 0.2]);
    expect(parseColor("rgba(255, 0, 0, 0.101)")[3]).toBe(0.101);
  });
  it("parses channel tokens directly and rejects incomplete triplets", () => {
    const config = themes([{ ...pair, format: "rgb-channels" }]);
    expect(measure(css("255, 255, 255"), config)[0]!.ratio).toBe(21);
    expect(() => measure(css("255, 255"), config)).toThrow("Invalid RGB");
  });
  it("composites a translucent foreground after all backdrop layers", () => {
    expect(composite(parseColor("rgba(255,255,255,0.5)"), parseColor("#000"))).toEqual([
      0.5, 0.5, 0.5, 1,
    ]);
    const config = themes([{ ...pair, background: ["--layer"], opacity: 0.5 }]);
    const source = ":root { --bg: #000; --layer: rgba(255,255,255,0.5); --fg: #fff; }";
    const expected = contrast([0.75, 0.75, 0.75, 1], [0.5, 0.5, 0.5, 1]);
    expect(measure(source, config)[0]!.ratio).toBe(expected);
  });
  it("compares border paint on clip fill against the adjacent exterior", () => {
    const config = themes([{ ...pair, paintBacking: ["--fill"] }]);
    const source = ":root { --bg: #000; --fill: #fff; --fg: rgba(0,0,0,0.5); }";
    expect(measure(source, config)[0]!.ratio).toBeCloseTo(5.2808228096, 9);
  });
  it("resolves aliases and rejects missing or cyclic tokens", () => {
    expect(measure(":root {--fg:var(--white);--white:#fff;--bg:#000;}", themes())[0]!.ratio).toBe(
      21,
    );
    expect(() => measure(":root {--bg:#000;}", themes())).toThrow("Missing token");
    expect(() => measure(":root {--fg:var(--fg);--bg:#000;}", themes())).toThrow("cycle");
  });
  it("rejects unsupported colors and invalid channels instead of guessing", () => {
    expect(() => parseColor("currentColor")).toThrow("Unsupported");
    expect(() => parseColor("rgb(300,0,0)")).toThrow("Invalid");
    expect(() => measure(":root {--bg:rgba(0,0,0,.5);--fg:#fff;}", themes())).toThrow("opaque");
  });
  it("keeps themes isolated in one manifest", () => {
    const config = parseManifest(
      JSON.stringify({
        themes: [
          { id: "dark", selector: ":root", canvas: "--bg", pairs: [pair] },
          { id: "light", selector: ".light", canvas: "--bg", pairs: [pair] },
        ],
      }),
    );
    expect(
      measure(":root{--bg:#000;--fg:#fff;} .light{--bg:#fff;--fg:#000;}", config).map(
        (row) => row.ratio,
      ),
    ).toEqual([21, 21]);
  });
  it("rejects lowered role thresholds and duplicate manifest ids", () => {
    expect(() => themes([{ ...pair, minimum: 3 }])).toThrow("WCAG");
    expect(() => themes([pair, pair])).toThrow("duplicate");
  });
});

describe("Studio colour syntax", () => {
  it("reads oklch, including a percentage lightness, and rejects a malformed number", () => {
    expect(contrast(parseColor("oklch(1 0 0)"), parseColor("oklch(0% 0 none)"))).toBeCloseTo(21, 6);
    expect(() => parseColor("oklch(0.9.1 0 0)")).toThrow("Invalid oklch");
  });
  it("takes light-dark's half for the scheme and scales alpha in a mix with transparent", () => {
    const value = "light-dark(#fff, color-mix(in oklab, #000 40%, transparent))";
    expect(parseColor(value, "light")).toEqual([1, 1, 1, 1]);
    expect(parseColor(value, "dark")[3]).toBeCloseTo(0.4, 9);
    expect(() => parseColor("color-mix(in srgb, #000 40%, #fff)")).toThrow("transparent");
  });
  it("expands a row's surfaces into pairs and lets a later theme reuse them", () => {
    const [dark, light] = parseManifest(
      JSON.stringify({
        themes: [
          {
            id: "dark",
            selector: ":root",
            canvas: "--bg",
            surfaces: { shell: ["--bg"], card: ["--bg", "--card"] },
            pairs: [{ ...pair, on: ["shell", "card"] }],
          },
          {
            id: "light",
            selector: [":root", ".light"],
            scheme: "light",
            canvas: "--bg",
            pairsFrom: "dark",
          },
        ],
      }),
    );
    expect(dark!.pairs.map((row) => `${row.id} ${row.background.join("+")}`)).toEqual([
      "label-on-shell --bg",
      "label-on-card --bg+--card",
    ]);
    expect(light!.pairs).toBe(dark!.pairs);
    expect(light!.selectors).toEqual([":root", ".light"]);
  });
  it("counts a ratio it could not measure as debt", () => {
    expect(
      verdict([{ id: "dark/label", ratio: Number.NaN, minimum: 4.5 }], {}).join("\n"),
    ).toContain("new contrast debt");
    expect(
      verdict([{ id: "dark/label", ratio: Number.NaN, minimum: 4.5 }], { "dark/label": 3 }),
    ).not.toEqual([]);
  });
});

describe("contrast ratchet", () => {
  it("reads a committed baseline using repository paths", () => {
    expect(previousBaseline({}, "HEAD")).toEqual(parseBaseline(read("contrast-baseline.json")));
  });

  it("rejects a planted low-contrast value and passes after restoring contrast", () => {
    expect(verdict(measure(css("#111"), themes()), {}).join("\n")).toContain("new contrast debt");
    expect(verdict(measure(css("#fff"), themes()), {})).toEqual([]);
  });
  it("banks improvements and never lowers a committed ratio", () => {
    const row = { id: "dark/label", ratio: 2, minimum: 4.5 };
    expect(verdict([row], { "dark/label": 2 })).toEqual([]);
    expect(verdict([{ ...row, ratio: 1.5 }], { "dark/label": 2 }).join("\n")).toContain(
      "reject regressions",
    );
    expect(verdict([{ ...row, ratio: 3 }], { "dark/label": 2 }).join("\n")).toContain(
      "bank improvements",
    );
    expect(verdict([{ ...row, ratio: 3 }], { "dark/label": 3 }, { "dark/label": 2 })).toEqual([]);
    expect(verdict([row], { "dark/label": 2 }, { "dark/label": 3 }).join("\n")).toContain(
      "only improve",
    );
  });
  it("removes passing and stale baseline entries and forbids fresh debt allowances", () => {
    const row = { id: "dark/label", ratio: 4.5, minimum: 4.5 };
    expect(verdict([row], { "dark/label": 2 }).join("\n")).toContain("remove passing");
    expect(verdict([], { "dark/label": 2 }).join("\n")).toContain("stale");
    expect(verdict([{ ...row, ratio: 2 }], { "dark/label": 2 }, {}).join("\n")).toContain(
      "only improve",
    );
  });
  it("requires a zero baseline entry to be removed", () => {
    const row = { id: "dark/label", ratio: 2, minimum: 4.5 };
    expect(verdict([row], { "dark/label": 0 })).toEqual([
      "dark/label: remove zero entry from baseline",
    ]);
  });
  it("holds every declared timeline state at its committed contrast", () => {
    const manifest = parseManifest(read("contrast-pairs.json"));
    const baseline = parseBaseline(read("contrast-baseline.json"));
    const rows = measure(read("../packages/studio/src/styles/theme.css"), manifest);
    expect(verdict(rows, baseline, previousBaseline(baseline))).toEqual([]);
    console.log(
      `Contrast ratchet verified: ${rows.length} pairs, ${Object.keys(baseline).length} baseline debts.`,
    );
  });
});

describe("file tree icons", () => {
  const css = read("../packages/studio/src/styles/theme.css");
  const token = (name: string): string =>
    css
      .match(new RegExp(`${name}:\\s*([^;]+);`))![1]!
      .replace(/var\((--[\w-]+)\)/g, (_, alias: string) => token(alias));
  const inks = [
    ...read("../packages/studio/src/components/editor/FileTreeIcons.tsx").matchAll(
      /text-\[(light-dark\([^\]]+\))\]/g,
    ),
  ].map((match) => match[1]!.replaceAll("_", " "));

  it.each(["light", "dark"] as const)(
    "hold 3:1 on a row at rest, hovered and selected in %s",
    (scheme) => {
      const panel = parseColor(token("--color-surface"), scheme);
      const rows = ["--color-hover", "--color-on"].map((wash) =>
        composite(parseColor(token(wash), scheme), panel),
      );
      expect(inks.length).toBeGreaterThan(8);
      for (const ink of inks)
        for (const row of [panel, ...rows])
          expect(contrast(parseColor(ink, scheme), row), ink).toBeGreaterThanOrEqual(3);
    },
  );
});
