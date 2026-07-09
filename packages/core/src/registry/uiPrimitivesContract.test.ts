import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractPrimitiveContract,
  findContractRemovals,
  type PrimitiveContract,
} from "./uiPrimitivesContract";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const scope = JSON.parse(
  readFileSync(resolve(repoRoot, "registry/ui-primitives/operator-black.scope.json"), "utf8"),
) as { featureBaseline: string; items: string[] };
const snapshot = JSON.parse(
  readFileSync(resolve(repoRoot, "registry/ui-primitives/operator-black.contract.json"), "utf8"),
) as {
  version: number;
  name: string;
  featureBaseline: string;
  items: Record<string, PrimitiveContract>;
};
const frozenBaselineAvailable =
  spawnSync("git", ["cat-file", "-e", `${scope.featureBaseline}^{commit}`], {
    cwd: repoRoot,
  }).status === 0;
const reproducibilityTest = frozenBaselineAvailable ? it : it.skip;

function frozenFile(path: string): string {
  return execFileSync("git", ["show", `${scope.featureBaseline}:${path}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function extractAtBaseline(id: string): PrimitiveContract {
  return extractPrimitiveContract(
    frozenFile(`registry/components/${id}/${id}.html`),
    frozenFile(`registry/components/${id}/registry-item.json`),
  );
}

function extractCurrent(id: string): PrimitiveContract {
  const root = resolve(repoRoot, "registry/components", id);
  return extractPrimitiveContract(
    readFileSync(resolve(root, `${id}.html`), "utf8"),
    readFileSync(resolve(root, "registry-item.json"), "utf8"),
  );
}

describe("Operator Black primitive contract extractor", () => {
  it("records selectors, cardinality, relations, attributes, variables, and manifest identity", () => {
    const contract = extractPrimitiveContract(
      `
        <div id="sample" class="root row" data-state="open" role="group" aria-label="Sample">
          <button class="row action">Run</button>
        </div>
        <style>
          .root > .action, .root .action, .row { --hf-sample-x: 1; color: var(--hf-sample-ink); }
          .root:hover { opacity: 1; }
        </style>
        <!-- GSAP timeline selector: .action -->
      `,
      JSON.stringify({
        name: "sample",
        type: "hyperframes:component",
        tags: ["ui-primitive", "sample"],
        files: [
          {
            path: "sample.html",
            target: "compositions/components/sample.html",
            type: "hyperframes:snippet",
          },
        ],
        preview: { poster: "https://example.com/sample.png" },
      }),
    );

    expect(contract.classes).toEqual(["action", "root", "row"]);
    expect(contract.ids).toEqual(["sample"]);
    expect(contract.roles).toEqual(["group"]);
    expect(contract.ariaAttributes).toEqual(["aria-label=Sample"]);
    expect(contract.dataAttributes).toEqual(["data-state=open"]);
    expect(contract.cssSelectors).toContainEqual({ selector: ".row", matchCount: 2 });
    expect(contract.relationSelectors).toEqual([".root .action", ".root > .action"]);
    expect(contract.customProperties).toEqual(["--hf-sample-ink", "--hf-sample-x"]);
    expect(contract.timelineSelectors).toEqual([".action"]);
    expect(contract.manifest.name).toBe("sample");
  });

  it("allows additions and reports every protected removal category", () => {
    const manifest = {
      name: "sample",
      type: "hyperframes:component",
      tags: ["ui-primitive"],
      files: [
        {
          path: "sample.html",
          target: "compositions/components/sample.html",
          type: "hyperframes:snippet",
        },
      ],
      previewPoster: "https://example.com/sample.png",
    };
    const baseline: PrimitiveContract = {
      classes: ["root"],
      ids: ["sample"],
      roles: ["group"],
      ariaAttributes: ["aria-label=Sample"],
      dataAttributes: ["data-state=open"],
      cssSelectors: [{ selector: ".root", matchCount: 1 }],
      relationSelectors: [".root > .child"],
      unsupportedSelectors: [".root:unsupported"],
      customProperties: ["--hf-sample-x"],
      timelineSelectors: [".root"],
      manifest,
    };
    const additive: PrimitiveContract = {
      ...structuredClone(baseline),
      classes: ["root", "new-class"],
      customProperties: ["--hf-sample-x", "--hf-sample-y"],
      cssSelectors: [
        { selector: ".root", matchCount: 1 },
        { selector: ".new-class", matchCount: 1 },
      ],
    };
    expect(findContractRemovals(baseline, additive)).toEqual([]);

    const removed: PrimitiveContract = {
      ...structuredClone(baseline),
      classes: [],
      ids: [],
      roles: [],
      ariaAttributes: [],
      dataAttributes: [],
      cssSelectors: [],
      relationSelectors: [],
      unsupportedSelectors: [],
      customProperties: [],
      timelineSelectors: [],
      manifest: { ...manifest, name: "renamed" },
    };
    expect(findContractRemovals(baseline, removed)).toEqual([
      "class: root",
      "id: sample",
      "role: group",
      "aria: aria-label=Sample",
      "data: data-state=open",
      "relation-selector: .root > .child",
      "unsupported-selector: .root:unsupported",
      "custom-property: --hf-sample-x",
      "timeline-selector: .root",
      "css-selector: .root",
      "manifest: identity changed",
    ]);

    const changedCount = structuredClone(baseline);
    changedCount.cssSelectors[0] = { selector: ".root", matchCount: 2 };
    expect(findContractRemovals(baseline, changedCount)).toEqual([
      "css-selector-count: .root (1 -> 2)",
    ]);
  });
});

describe("Operator Black frozen public contract", () => {
  it("declares whether the frozen Git object is mandatory in this environment", () => {
    if (process.env.HF_UI_REQUIRE_FROZEN_BASELINE === "1") {
      expect(frozenBaselineAvailable).toBe(true);
    }
  });

  reproducibilityTest("is complete and reproducible from the frozen feature baseline", () => {
    expect(snapshot).toMatchObject({
      version: 1,
      name: "operator-black",
      featureBaseline: scope.featureBaseline,
    });
    expect(Object.keys(snapshot.items)).toEqual(scope.items);

    for (const id of scope.items) {
      try {
        expect(snapshot.items[id], id).toEqual(extractAtBaseline(id));
      } catch (error) {
        throw new Error(`Failed to reproduce frozen contract for ${id}`, { cause: error });
      }
    }
  });

  it("allows additions but reports no removal, rename, cardinality, or identity regression", () => {
    const failures: string[] = [];
    for (const id of scope.items) {
      const baseline = snapshot.items[id];
      if (!baseline) {
        failures.push(`${id}: missing baseline snapshot`);
        continue;
      }
      try {
        for (const removal of findContractRemovals(baseline, extractCurrent(id))) {
          failures.push(`${id}: ${removal}`);
        }
      } catch (error) {
        throw new Error(`Failed to extract current contract for ${id}`, { cause: error });
      }
    }
    expect(failures).toEqual([]);
  });
});
