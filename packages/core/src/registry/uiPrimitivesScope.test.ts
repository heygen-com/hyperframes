import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const scopePath = resolve(repoRoot, "registry/ui-primitives/operator-black.scope.json");
const statesPath = resolve(repoRoot, "registry/ui-primitives/operator-black.states.json");

const expectedIds = [
  "accordion",
  "alert",
  "alert-dialog",
  "aspect-ratio",
  "avatar",
  "backdrop",
  "badge",
  "blur-in",
  "breadcrumb",
  "button",
  "button-group",
  "calendar",
  "card",
  "caret",
  "carousel",
  "chart",
  "checkbox",
  "collapsible",
  "combobox",
  "command-menu",
  "command-menu-item",
  "context-menu",
  "cursor",
  "dialog",
  "drawer",
  "dropdown-menu",
  "dropdown-menu-item",
  "empty",
  "field",
  "hover-card",
  "input",
  "input-group",
  "input-otp",
  "item",
  "kbd",
  "label",
  "menubar",
  "native-select",
  "navigation-menu",
  "pagination",
  "popover",
  "progress",
  "progress-steps",
  "radio",
  "registry",
  "remocn-ui",
  "resizable",
  "scroll-area",
  "select",
  "select-item",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "skeleton-block",
  "slider",
  "spinner",
  "stepper",
  "switch",
  "table",
  "tabs",
  "textarea",
  "toast",
  "toggle",
  "toggle-group",
  "tooltip",
] as const;

const allowedStateLabels = new Set([
  "baseline",
  "checked",
  "closed",
  "hover",
  "idle",
  "loading",
  "not-applicable",
  "off",
  "on",
  "open",
  "press",
  "success",
  "unchecked",
]);

interface Scope {
  version: number;
  name: string;
  comparisonBase: string;
  featureBaseline: string;
  items: string[];
}

interface StateRecord {
  id: string;
  staticStates: string[];
  liveControllerBehaviors: string[];
  focusTarget: string;
  reducedMotion: string;
  themeFixture: string;
  renderCheckpoints: string[];
}

interface StatesInventory {
  version: number;
  name: string;
  items: StateRecord[];
}

const featureBaselineAvailable =
  spawnSync("git", ["cat-file", "-e", "96b1dd7beeeea01c637aca2cff2ec94fcc83fe02^{commit}"], {
    cwd: repoRoot,
  }).status === 0;
const frozenSelectionTest = featureBaselineAvailable ? it : it.skip;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("Operator Black executable scope", () => {
  it("freezes the exact baseline SHAs and sorted unique 66-item allowlist", () => {
    const scope = readJson<Scope>(scopePath);

    expect(Object.keys(scope).sort()).toEqual([
      "comparisonBase",
      "featureBaseline",
      "items",
      "name",
      "version",
    ]);
    expect(scope).toMatchObject({
      version: 1,
      name: "operator-black",
      comparisonBase: "8e04d0196945c5173923fb72ecc665d40d122adb",
      featureBaseline: "96b1dd7beeeea01c637aca2cff2ec94fcc83fe02",
    });
    expect(scope.items).toEqual(expectedIds);
    expect(scope.items).toHaveLength(66);
    expect(scope.items).toEqual([...new Set(scope.items)].sort());
  });

  it("declares whether frozen Git evidence is mandatory in this environment", () => {
    if (process.env.HF_UI_REQUIRE_FROZEN_BASELINE === "1") {
      expect(featureBaselineAvailable).toBe(true);
    }
  });

  frozenSelectionTest("matches the reproducible frozen git selection", () => {
    const scope = readJson<Scope>(scopePath);
    const addedManifests = execFileSync(
      "git",
      [
        "diff",
        "--diff-filter=A",
        "--name-only",
        scope.comparisonBase,
        scope.featureBaseline,
        "--",
        "registry/components/*/registry-item.json",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);

    const selected = addedManifests
      .map((path) => {
        const raw = execFileSync("git", ["show", `${scope.featureBaseline}:${path}`], {
          cwd: repoRoot,
          encoding: "utf8",
        });
        const manifest = JSON.parse(raw) as { name: string; tags: string[] };
        const excluded = ["ui-flow", "motion", "transition", "typography", "showcase"];
        return manifest.tags.includes("ui-primitive") &&
          !manifest.tags.some((tag) => excluded.includes(tag))
          ? manifest.name
          : null;
      })
      .filter((id): id is string => id !== null)
      .sort();

    expect(scope.items).toEqual(selected);
  });

  it("requires the canonical, demo, and manifest for every frozen ID", () => {
    const scope = readJson<Scope>(scopePath);

    for (const id of scope.items) {
      const componentRoot = resolve(repoRoot, "registry/components", id);
      expect(existsSync(resolve(componentRoot, `${id}.html`)), `${id} canonical`).toBe(true);
      expect(existsSync(resolve(componentRoot, "demo.html")), `${id} demo`).toBe(true);
      expect(existsSync(resolve(componentRoot, "registry-item.json")), `${id} manifest`).toBe(true);
    }
  });
});

describe("Operator Black state inventory schema", () => {
  it("covers every frozen ID with explicit, valid state evidence", () => {
    const inventory = readJson<StatesInventory>(statesPath);
    const ids = inventory.items.map(({ id }) => id);

    expect(Object.keys(inventory).sort()).toEqual(["items", "name", "version"]);
    expect(inventory.version).toBe(1);
    expect(inventory.name).toBe("operator-black");
    expect(ids).toEqual(expectedIds);
    expect(ids).toEqual([...new Set(ids)].sort());

    for (const record of inventory.items) {
      expect(Object.keys(record).sort(), `${record.id} keys`).toEqual([
        "focusTarget",
        "id",
        "liveControllerBehaviors",
        "reducedMotion",
        "renderCheckpoints",
        "staticStates",
        "themeFixture",
      ]);
      expect(record.staticStates.length, `${record.id} staticStates`).toBeGreaterThan(0);
      for (const state of record.staticStates) {
        expect(allowedStateLabels.has(state), `${record.id} unknown state: ${state}`).toBe(true);
      }
      expect(Array.isArray(record.liveControllerBehaviors)).toBe(true);
      expect(
        record.liveControllerBehaviors.every((behavior) => behavior.trim().length > 0),
        `${record.id} liveControllerBehaviors`,
      ).toBe(true);
      expect(record.focusTarget.trim(), `${record.id} focusTarget`).not.toBe("");
      expect(record.reducedMotion.trim(), `${record.id} reducedMotion`).not.toBe("");
      expect(["dark", "light", "both"]).toContain(record.themeFixture);
      expect(record.renderCheckpoints.length, `${record.id} renderCheckpoints`).toBeGreaterThan(0);
      expect(record.renderCheckpoints.every((checkpoint) => checkpoint.trim().length > 0)).toBe(
        true,
      );
    }
  });
});
