import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  callSites,
  listBudgetIssues,
  parse,
  reactBindings,
  sources,
} from "./check-no-use-effect.mjs";

describe("banned-hook call sites", () => {
  it("counts a plain named import, on the line the call starts", () => {
    assert.deepEqual(
      callSites("a.tsx", 'import { useEffect } from "react";\n\nuseEffect(() => {});\n'),
      [3],
    );
  });

  it("follows an alias back to the banned hook", () => {
    assert.deepEqual(
      callSites("a.tsx", 'import { useEffect as sync } from "react";\nsync(fn);\n'),
      [2],
    );
  });

  it("counts the default and namespace React imports", () => {
    assert.deepEqual(callSites("a.tsx", 'import React from "react";\nReact.useEffect(fn);\n'), [2]);
    assert.deepEqual(
      callSites("a.tsx", 'import * as R from "react";\nR.useLayoutEffect(fn);\n'),
      [2],
    );
  });

  it("counts useLayoutEffect against the same budget", () => {
    assert.deepEqual(
      callSites(
        "a.tsx",
        'import { useEffect, useLayoutEffect } from "react";\nuseEffect(fn);\nuseLayoutEffect(fn);\n',
      ),
      [2, 3],
    );
  });

  it("does not count prose that quotes the rule", () => {
    assert.deepEqual(
      callSites("a.tsx", 'import { useEffect } from "react";\n// never call useEffect(fn) here\n'),
      [],
    );
  });

  it("does not count a same-named hook from another module", () => {
    assert.deepEqual(
      callSites("a.ts", 'import { useEffect } from "./local";\nuseEffect(fn);\n'),
      [],
    );
  });

  it("does not count a property access on a non-React object", () => {
    assert.deepEqual(callSites("a.ts", 'import React from "react";\nlib.useEffect(fn);\n'), []);
  });
});

describe("react binding resolution", () => {
  it("separates aliased hook names from React namespace names", () => {
    const { direct, namespaces } = reactBindings(
      parse(
        "a.tsx",
        'import React, { useEffect as sync, useState } from "react";\nimport * as R from "react";\n',
      ),
    );
    assert.deepEqual([...direct].sort(), ["sync"]);
    assert.deepEqual([...namespaces].sort(), ["R", "React"]);
  });

  it("ignores imports from other modules", () => {
    const { direct, namespaces } = reactBindings(
      parse("a.ts", 'import { useEffect } from "preact/hooks";\nimport React from "./shim";\n'),
    );
    assert.equal(direct.size, 0);
    assert.equal(namespaces.size, 0);
  });
});

describe("budget accounting", () => {
  it("rejects an effect in a file with no budget entry", () => {
    const [problem, ...rest] = listBudgetIssues(new Map([["new.tsx", [7]]]), new Map());
    assert.deepEqual(rest, []);
    assert.match(problem, /^NEW banned effect hook: new\.tsx:7$/m);
  });

  it("rejects a budgeted file that grew", () => {
    const [problem, ...rest] = listBudgetIssues(
      new Map([["old.tsx", [4, 9]]]),
      new Map([["old.tsx", 1]]),
    );
    assert.deepEqual(rest, []);
    assert.match(problem, /^OVER BUDGET: old\.tsx has 2, budget allows 1$/m);
  });

  it("rejects a budget that is now too high, and says what to lower it to", () => {
    const [problem, ...rest] = listBudgetIssues(
      new Map([["old.tsx", [4]]]),
      new Map([["old.tsx", 3]]),
    );
    assert.deepEqual(rest, []);
    assert.match(problem, /^STALE budget entry: old\.tsx now has 1, budget still says 3$/m);
    assert.match(problem, /Lower it to 1\./);
  });

  it("asks for a fully paid entry to be deleted", () => {
    const [problem] = listBudgetIssues(new Map(), new Map([["old.tsx", 2]]));
    assert.match(problem, /Delete the entry\./);
  });

  it("accepts a file sitting exactly on its budget", () => {
    assert.deepEqual(
      listBudgetIssues(new Map([["old.tsx", [4, 9]]]), new Map([["old.tsx", 2]])),
      [],
    );
  });
});

describe("scanned tree", () => {
  it("reaches the sanctioned wrapper, so SCANNED still points at studio source", () => {
    assert.ok(sources().includes("packages/studio/src/hooks/useMountEffect.ts"));
  });
});
