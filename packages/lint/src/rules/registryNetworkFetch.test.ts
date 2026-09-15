import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildLintContext } from "../context";
import { gsapTimelineRegisteredBehindNetworkFetch } from "./gsap";

const registryDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../registry");

function compositionFiles(kind: "blocks" | "components"): string[] {
  const dir = join(registryDir, kind);
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((itemDir) => statSync(itemDir).isDirectory())
    .flatMap((itemDir) =>
      readdirSync(itemDir)
        .filter((file) => file.endsWith(".html"))
        .map((file) => join(itemDir, file)),
    );
}

// Every catalog item is a composition somebody will render, so none may hang its timeline
// on a render-time network request (#2107: the map blocks fetched topojson from a CDN and
// registered window.__timelines inside the .then(), stalling the engine's timeline poll).
// Only this rule runs here — the full linter over ~400 items takes over a minute.
describe("registry items register their timelines without a network request", () => {
  for (const kind of ["blocks", "components"] as const) {
    it(`no ${kind} item trips gsap_timeline_registered_behind_network_fetch`, async () => {
      const offenders: string[] = [];
      for (const file of compositionFiles(kind)) {
        const ctx = buildLintContext(readFileSync(file, "utf8"), { filePath: file });
        const findings = await gsapTimelineRegisteredBehindNetworkFetch(ctx);
        if (findings.length > 0) offenders.push(file.slice(registryDir.length + 1));
      }
      expect(offenders).toEqual([]);
    });
  }
});
