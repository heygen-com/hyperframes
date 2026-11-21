import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compare,
  DEFAULT_READERS,
  filesByPackage,
  gate,
  readManifest,
  sealedDefaults,
  unranTests,
  verdicts,
} from "./sealed-parity.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(`${REPO}/${path}`, "utf8");
const STUDIO = DEFAULT_READERS[0].file;
const sealedStudio = (path) =>
  read(path).replace(/(\["VITE_STUDIO_OPAQUE_PREVIEW_ENABLED"\],\s*)false/, "$1true");

const select = { package: "studio", file: "src/a.test.ts", kind: "vitest", name: "selects" };
const rows = [
  { id: "select", behaviour: "select a layer", tests: [select] },
  { id: "thumbs", behaviour: "thumbnails", tests: [] },
];
const report = (status) => ({
  testResults: [
    {
      name: "/w/packages/studio/src/a.test.ts",
      assertionResults: [{ fullName: "selects", status }],
    },
  ],
});

test("the manifest refuses a row without a behaviour, a repeated id and an unknown kind", () => {
  const { problems } = readManifest(
    JSON.stringify({
      rows: [
        { id: "a", behaviour: "x", tests: [{ kind: "walk", package: "studio", file: "f" }] },
        { id: "a" },
      ],
    }),
  );
  assert.equal(problems.length, 3);
});

test("a row is at parity only when every test passed in both modes", () => {
  const passed = verdicts(rows, report("passed"));
  const [select, thumbs] = compare(rows, passed, verdicts(rows, report("failed")));
  assert.equal(select.verdict, "differs");
  assert.equal(thumbs.verdict, "no test");
  assert.equal(compare(rows, passed, passed)[0].verdict, "parity");
});

test("a test named by its describe block counts every test inside it", () => {
  const block = [{ id: "b", behaviour: "x", tests: [{ ...select, name: "group" }] }];
  const results = (statuses) => ({
    testResults: [
      {
        name: "/w/packages/studio/src/a.test.ts",
        assertionResults: statuses.map((status, i) => ({ fullName: `group case ${i}`, status })),
      },
    ],
  });
  assert.equal(Object.values(verdicts(block, results(["passed", "passed"])))[0], "passed");
  assert.equal(Object.values(verdicts(block, results(["passed", "failed"])))[0], "failed");
});

test("a listed test that is skipped or did not run fails whatever the default", () => {
  const parity = compare(rows, verdicts(rows, report("passed")), verdicts(rows, report("skipped")));
  assert.deepEqual(unranTests(parity), ["row select: studio/src/a.test.ts > selects was skipped"]);
  assert.deepEqual(unranTests(compare(rows, verdicts(rows, { testResults: [] }), {})), [
    "row select: studio/src/a.test.ts > selects was missing",
  ]);
});

test("today's Studio default reads as unsealed and the gate lets a PR through with rows not at parity", () => {
  const defaults = sealedDefaults(read);
  assert.deepEqual(
    defaults.map((d) => d.sealed),
    [false],
  );
  assert.equal(gate(compare(rows, {}, {}), defaults).ok, true);
});

test("the gate refuses a sealed Studio default while any behaviour is not at parity", () => {
  const defaults = sealedDefaults((path) => (path === STUDIO ? sealedStudio(path) : read(path)));
  assert.deepEqual(
    defaults.map((d) => d.sealed),
    [true],
  );
  const passed = verdicts(rows, report("passed"));
  const refused = gate(compare(rows, passed, passed), defaults);
  assert.equal(refused.ok, false);
  assert.match(refused.lines.at(-1), /refused: Studio preview sealed by default/);
  assert.equal(gate(compare(rows.slice(0, 1), passed, passed), defaults).ok, true);
});

test("a default the gate can no longer read fails it", () => {
  const defaults = sealedDefaults((path) => (path === STUDIO ? "export const X = 1;" : read(path)));
  assert.equal(gate([], defaults).ok, false);
});

test("each package's test files run once, in one call per package", () => {
  const twice = [
    { id: "a", behaviour: "x", tests: [select, { ...select, name: "other" }] },
    { id: "b", behaviour: "y", tests: [{ ...select, package: "player", file: "src/p.test.ts" }] },
  ];
  assert.deepEqual(
    [...filesByPackage(twice)].map(([pkg, files]) => [pkg, [...files]]),
    [
      ["studio", ["src/a.test.ts"]],
      ["player", ["src/p.test.ts"]],
    ],
  );
});
