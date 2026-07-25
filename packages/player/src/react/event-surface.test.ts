// @vitest-environment node
//
// Drift guard: the React binding promises a callback prop for every event the
// player element dispatches. This test scans the player sources for event
// constructions and fails when one is missing from PLAYER_EVENT_CALLBACKS —
// so adding an element event without extending the binding breaks the build
// instead of silently shrinking the React contract.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAYER_EVENT_CALLBACKS } from "./player.js";

const playerSrcDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Player sources whose events reach the <hyperframes-player> element. The
 * slideshow element and the react binding itself are out of scope. */
function listPlayerSources(): string[] {
  return readdirSync(playerSrcDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(playerSrcDir, name));
}

function listDispatchedEventTypes(): string[] {
  const eventConstruction = /new (?:Custom)?Event\(\s*"([a-z]+)"/g;
  const types = new Set<string>();
  for (const file of listPlayerSources()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(eventConstruction)) {
      types.add(match[1] as string);
    }
  }
  return [...types].sort();
}

describe("react binding event surface", () => {
  it("covers every event the player element dispatches", () => {
    const dispatched = listDispatchedEventTypes();
    expect(dispatched.length).toBeGreaterThanOrEqual(10);
    const covered = Object.keys(PLAYER_EVENT_CALLBACKS);
    const missing = dispatched.filter((type) => !covered.includes(type));
    expect(missing, `player dispatches events with no React callback: ${missing}`).toEqual([]);
  });

  it("does not claim events the player never dispatches", () => {
    const dispatched = listDispatchedEventTypes();
    const phantom = Object.keys(PLAYER_EVENT_CALLBACKS).filter(
      (type) => !dispatched.includes(type),
    );
    expect(phantom, `binding lists events never dispatched by the player: ${phantom}`).toEqual([]);
  });
});
