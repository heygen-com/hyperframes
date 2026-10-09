/**
 * The block says speed is proportional to merges. Bind a near-tie and a
 * one-merge row, seek one second (before anyone can bounce), and check the
 * distances.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

const htmlPath = join(
  import.meta.dirname,
  "../../../../registry/blocks/week-in-merges/week-in-merges.html",
);

function distances(
  rows: Array<{ name: string; merges: number }>,
  extra: Record<string, unknown> = {},
): Map<number, number> {
  const { document, window } = parseHTML(readFileSync(htmlPath, "utf8"));
  const proto = Object.getPrototypeOf(document.createElement("div"));
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get(this: { id?: string }) {
      return String(this.id || "").startsWith("wim-lane") ? 800 : 1080;
    },
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: { id?: string }) {
      return String(this.id || "").startsWith("wim-row") ? 80 : 40;
    },
  });

  let driver: { t: number } | undefined;
  const gsap = {
    timeline() {
      return {
        paused: true,
        to(target: { t: number }) {
          driver = target;
          return this;
        },
      };
    },
  };
  const variables = {
    rows: JSON.stringify(rows.map((row) => ({ ...row, avatar: "" }))),
    ...extra,
  };
  const sandbox = { document, window, console, gsap };
  (window as unknown as { __hfVariables: typeof variables }).__hfVariables = variables;
  const source = [...document.querySelectorAll("script")]
    .map((node) => node.textContent || "")
    .find((text) => text.includes("function speedFor"));
  if (!source) throw new Error("speedFor script missing");
  runInNewContext(source, sandbox);
  if (!driver) throw new Error("timeline driver missing");
  driver.t = 1;

  const out = new Map<number, number>();
  for (const row of document.querySelectorAll(".wim-row")) {
    const merges = Number.parseInt(row.querySelector(".wim-count")?.textContent || "", 10);
    const transform =
      (row.querySelector(".wim-avatar") as HTMLElement | null)?.style.transform || "";
    const match = /translateX\(([-\d.]+)px\)/.exec(transform);
    out.set(merges, match ? Number(match[1]) : Number.NaN);
  }
  return out;
}

describe("week-in-merges speed", () => {
  it("binds 30, 29, and 1 so distance stays within 5% of the merge ratio", () => {
    const rows = [
      { name: "Ada", merges: 30 },
      { name: "Bao", merges: 29 },
      { name: "Cam", merges: 1 },
    ];
    const traveled = distances(rows);
    const pairs: Array<[number, number]> = [
      [29, 30],
      [1, 30],
      [1, 29],
    ];
    for (const [left, right] of pairs) {
      const got = traveled.get(left)! / traveled.get(right)!;
      const want = left / right;
      expect(
        Math.abs(got - want) / want,
        `${left}/${right} traveled ${got}, wanted ${want}`,
      ).toBeLessThanOrEqual(0.05);
    }

    // The same counts with the quiet row past the cap. A visible-range rescale
    // then pins 29 to the floor; proportionality keeps 29/30.
    const capped = distances(rows, { rows_max: 2 });
    expect(capped.has(1)).toBe(false);
    const cappedRatio = capped.get(29)! / capped.get(30)!;
    expect(Math.abs(cappedRatio - 29 / 30) / (29 / 30)).toBeLessThanOrEqual(0.05);
  });
});
