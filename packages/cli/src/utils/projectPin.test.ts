import { describe, expect, it } from "vitest";
import {
  rewriteProjectPinnedScripts,
  readPinnedHyperframesVersions,
  HYPERFRAMES_PIN_RE,
} from "./projectPin.js";

describe("HYPERFRAMES_PIN_RE", () => {
  it("matches a hyperframes@<semver> token and captures the version", () => {
    const match = "npx --yes hyperframes@1.2.3 render".match(HYPERFRAMES_PIN_RE);
    expect(match?.[0]).toBe("hyperframes@1.2.3");
  });
});

describe("rewriteProjectPinnedScripts", () => {
  const scripts = {
    dev: "npx --yes hyperframes@0.7.48 preview",
    check: "npx --yes hyperframes@0.7.48 check",
    render: "npx --yes hyperframes@0.7.48 render",
    unrelated: "echo hi",
    unpinned: "npx hyperframes render",
  };

  it("bumps every pinned hyperframes script to the target, leaving others untouched", () => {
    const r = rewriteProjectPinnedScripts(scripts, "0.7.55");
    expect(r.changed).toBe(true);
    expect(r.fromVersions).toEqual(["0.7.48"]);
    expect(r.scripts.render).toBe("npx --yes hyperframes@0.7.55 render");
    expect(r.scripts.dev).toBe("npx --yes hyperframes@0.7.55 preview");
    expect(r.scripts.unrelated).toBe("echo hi");
    expect(r.scripts.unpinned).toBe("npx hyperframes render");
  });

  it("is a no-op when already at target", () => {
    const at = rewriteProjectPinnedScripts(
      { render: "npx --yes hyperframes@0.7.55 render" },
      "0.7.55",
    );
    expect(at.changed).toBe(false);
    expect(at.fromVersions).toEqual([]);
  });

  it("refuses an unsafe target version (no rewrite)", () => {
    const r = rewriteProjectPinnedScripts(scripts, "0.7.55; rm -rf /");
    expect(r.changed).toBe(false);
    expect(r.scripts.render).toBe(scripts.render);
  });

  it("reads distinct pinned versions across scripts", () => {
    expect(
      readPinnedHyperframesVersions({
        a: "npx --yes hyperframes@0.7.48 render",
        b: "npx hyperframes@0.7.50 check",
        c: "npx hyperframes render",
      }),
    ).toEqual(["0.7.48", "0.7.50"]);
  });
});
