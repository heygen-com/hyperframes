import { describe, expect, it } from "vitest";

import { syncDemoVariables } from "./sync-demo-variables.ts";

/**
 * The invariant this defends.
 *
 * A component's `demo.html` was authored as a copy of its snippet, and the
 * copies drifted until almost none of them carried the variable declaration or
 * the script that reads a chosen value. The catalog preview is built from the
 * demo, so those pages showed a variables panel that could not change anything.
 *
 * Running in dry mode reports what it *would* rewrite. Anything it would
 * rewrite is a demo that has drifted again, and a drifted demo is a dead panel
 * on that component's catalog page, so this fails rather than letting it ship.
 */
describe("component demos carry their snippet's variables", () => {
  it("has nothing left to sync", () => {
    const wouldChange = syncDemoVariables(false)
      .filter((r) => r.status === "synced")
      .map((r) => r.name);

    expect(
      wouldChange,
      `these demos no longer carry their snippet's variables, so their catalog ` +
        `page would render a dead panel. Run: npx tsx scripts/catalog/sync-demo-variables.ts`,
    ).toEqual([]);
  });

  it("actually inspects the catalog rather than passing on an empty set", () => {
    // A check that silently matched nothing would pass forever.
    expect(syncDemoVariables(false).length).toBeGreaterThan(100);
  });
});
