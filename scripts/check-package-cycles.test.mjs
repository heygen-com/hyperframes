import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listPackageCycleIssues, listRuntimePackageCycles } from "./check-package-cycles.mjs";

describe("package cycle checker", () => {
  it("accepts an acyclic runtime graph and ignores dev-only edges", () => {
    const packages = [
      { name: "a", dependencies: { b: "workspace:*" } },
      { name: "b", devDependencies: { a: "workspace:*" } },
    ];
    assert.deepEqual(listRuntimePackageCycles(packages), []);
  });

  it("reports a new strongly connected runtime component", () => {
    const packages = [
      { name: "a", dependencies: { b: "workspace:*" } },
      { name: "b", peerDependencies: { c: "workspace:*" } },
      { name: "c", optionalDependencies: { a: "workspace:*" } },
    ];
    assert.deepEqual(listPackageCycleIssues(packages, []), [
      "runtime workspace dependency cycle: a -> b -> c",
    ]);
  });

  it("permits only an exact, documented compatibility component", () => {
    const allowed = [{ packages: ["a", "b"], reason: "legacy compatibility surface" }];
    assert.deepEqual(
      listPackageCycleIssues(
        [
          { name: "a", dependencies: { b: "workspace:*" } },
          { name: "b", dependencies: { a: "workspace:*" } },
        ],
        allowed,
      ),
      [],
    );
    assert.equal(
      listPackageCycleIssues(
        [
          { name: "a", dependencies: { b: "workspace:*" } },
          { name: "b", dependencies: { a: "workspace:*", c: "workspace:*" } },
          { name: "c", dependencies: { b: "workspace:*" } },
        ],
        allowed,
      ).length,
      1,
    );
  });
});
