/**
 * The gallery gate (R7).
 *
 * A primitive with no story is a primitive nobody reviews: it is in the barrel,
 * it ships, and the one place the whole system is supposed to be visible does
 * not show it. This test is what makes the gallery keep up with the barrel.
 *
 * There is no list of primitives to maintain here. The barrel's own source says
 * which module each name comes from, and the imported value says whether that
 * name is a component: `cn` is a function with a lowercase name, `buttonBase`
 * is a string, `buttonSizes` is a plain object, and none of them has a look to
 * show. Anything React can render needs a `*.stories.tsx` beside it.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as barrel from "./index";

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * `name -> module` for every value export of the barrel. `export type { … }`
 * statements are skipped: a type has no look.
 */
function valueExportModules(source: string): Map<string, string> {
  const modules = new Map<string, string>();
  const statement = /export\s+(type\s+)?\{([^}]*)\}\s+from\s+"\.\/([^"]+)"/g;
  for (const [, isType, names, module] of source.matchAll(statement)) {
    if (isType) continue;
    for (const entry of names.split(",")) {
      const name = entry
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) modules.set(name, module);
    }
  }
  return modules;
}

/**
 * React renders functions and the objects `forwardRef` and `memo` produce. The
 * capitalised name is what separates a component from a hook or a helper.
 */
function isComponent(name: string, value: unknown): boolean {
  if (!/^[A-Z]/.test(name)) return false;
  if (typeof value === "function") return true;
  return typeof value === "object" && value !== null && "$$typeof" in value;
}

describe("primitive stories", () => {
  const modules = valueExportModules(readFileSync(path.join(UI_DIR, "index.ts"), "utf8"));

  it("reads every value export of the barrel", () => {
    // Guards the regex above: a barrel written in a shape it does not match
    // would leave this test asserting nothing at all.
    expect([...modules.keys()].sort()).toEqual(Object.keys(barrel).sort());
  });

  it("has a stories file for every primitive in the barrel", () => {
    const missing = [...modules]
      .filter(([name]) => isComponent(name, barrel[name as keyof typeof barrel]))
      .filter(([, module]) => !existsSync(path.join(UI_DIR, `${module}.stories.tsx`)))
      .map(([name, module]) => `${name}: ${module}.stories.tsx`);

    expect(missing).toEqual([]);
  });

  it("names a missing stories file rather than passing quietly", () => {
    // The check above is only worth something if an absent file fails it.
    expect(existsSync(path.join(UI_DIR, "NotAPrimitive.stories.tsx"))).toBe(false);
    expect(isComponent("Button", barrel.Button)).toBe(true);
    expect(isComponent("cn", barrel.cn)).toBe(false);
    expect(isComponent("buttonSizes", barrel.buttonSizes)).toBe(false);
  });
});
