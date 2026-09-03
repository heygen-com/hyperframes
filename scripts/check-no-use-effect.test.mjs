import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isScannedSource,
  listBudgetIssues,
  listSanctionedIssues,
  parse,
  reactBindings,
  sanctionedProblem,
  sources,
  violations,
} from "./check-no-use-effect.mjs";

describe("banned-hook call sites", () => {
  it("counts a plain named import, on the line the call starts", () => {
    assert.deepEqual(
      violations("a.tsx", 'import { useEffect } from "react";\n\nuseEffect(() => {});\n'),
      [3],
    );
  });

  it("follows an alias back to the banned hook", () => {
    assert.deepEqual(
      violations("a.tsx", 'import { useEffect as sync } from "react";\nsync(fn);\n'),
      [2],
    );
  });

  it("counts the default and namespace React imports", () => {
    assert.deepEqual(
      violations("a.tsx", 'import React from "react";\nReact.useEffect(fn);\n'),
      [2],
    );
    assert.deepEqual(
      violations("a.tsx", 'import * as R from "react";\nR.useLayoutEffect(fn);\n'),
      [2],
    );
  });

  it("counts useLayoutEffect against the same budget", () => {
    assert.deepEqual(
      violations(
        "a.tsx",
        'import { useEffect, useLayoutEffect } from "react";\nuseEffect(fn);\nuseLayoutEffect(fn);\n',
      ),
      [2, 3],
    );
  });

  it("does not count prose that quotes the rule", () => {
    assert.deepEqual(
      violations("a.tsx", 'import { useEffect } from "react";\n// never call useEffect(fn) here\n'),
      [],
    );
  });

  it("does not count a same-named hook from another module", () => {
    assert.deepEqual(
      violations("a.ts", 'import { useEffect } from "./local";\nuseEffect(fn);\n'),
      [],
    );
  });

  it("does not count a property access on a non-React object", () => {
    assert.deepEqual(violations("a.ts", 'import React from "react";\nlib.useEffect(fn);\n'), []);
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

// A gate is only worth its name if it cannot be walked around by spelling. One test per bypass the
// review named, so a regression in resolution shows up as a named failure rather than a quiet pass.
describe("bypasses by spelling", () => {
  it("resolves a namespace bound by dynamic import", () => {
    assert.deepEqual(
      violations("a.ts", 'const R = await import("react");\nR.useEffect(fn);\n'),
      [2],
    );
  });

  it("resolves a hook destructured out of require()", () => {
    assert.deepEqual(
      violations("a.ts", 'const { useEffect } = require("react");\nuseEffect(fn);\n'),
      [2],
    );
  });

  it("resolves computed namespace access", () => {
    assert.deepEqual(
      violations("a.ts", 'import React from "react";\nReact["useEffect"](fn);\n'),
      [2],
    );
  });

  it("follows a chain of local aliases, declared in either order", () => {
    assert.deepEqual(
      violations(
        "a.ts",
        'import { useEffect } from "react";\nconst b = a;\nconst a = useEffect;\nb(fn);\n',
      ),
      [4],
    );
  });

  it("fails the barrel that re-exports the hook, named or star", () => {
    assert.deepEqual(violations("a.ts", '\nexport { useEffect } from "react";\n'), [2]);
    assert.deepEqual(violations("a.ts", '\n\nexport * from "react";\n'), [3]);
  });

  it("does not fail a re-export of some other react name", () => {
    assert.deepEqual(violations("a.ts", 'export { useMemo } from "react";\n'), []);
  });

  it("scans .js and .jsx alongside .ts and .tsx", () => {
    assert.ok(isScannedSource("legacy.js"));
    assert.ok(isScannedSource("legacy.jsx"));
    assert.ok(!isScannedSource("ambient.d.ts"));
    assert.deepEqual(
      violations("a.js", 'import { useEffect } from "react";\nuseEffect(fn);\n'),
      [2],
    );
  });

  it("still ignores a same-named hook loaded from another module", () => {
    assert.deepEqual(
      violations("a.ts", 'const { useEffect } = require("preact/hooks");\nuseEffect(fn);\n'),
      [],
    );
  });
});

describe("the sanctioned escape hatch", () => {
  const mount =
    'import { useEffect } from "react";\nexport function useMountEffect(effect) {\n  useEffect(effect, []);\n}\n';

  it("accepts the intended implementation", () => {
    assert.equal(sanctionedProblem("useMountEffect.ts", mount), null);
  });

  it("rejects a second effect in the sanctioned file", () => {
    assert.match(
      sanctionedProblem("useMountEffect.ts", mount + "useEffect(other, []);\n"),
      /has 2 banned hook calls, expected 1/,
    );
  });

  it("rejects an effect with a non-empty dependency array", () => {
    assert.match(
      sanctionedProblem("useMountEffect.ts", mount.replace("[]", "[effect]")),
      /must call useEffect\(effect, \[\]\)/,
    );
  });

  it("rejects an effect with no dependency array at all", () => {
    assert.match(
      sanctionedProblem("useMountEffect.ts", mount.replace(", []", "")),
      /must call useEffect\(effect, \[\]\)/,
    );
  });

  it("reports a sanctioned file that has been deleted", () => {
    assert.deepEqual(listSanctionedIssues([], new Map([["gone.ts", "why"]])), [
      "SANCTIONED lists a file that no longer exists: gone.ts",
    ]);
  });

  it("holds the real useMountEffect.ts to that shape", () => {
    assert.deepEqual(listSanctionedIssues(sources()), []);
  });
});
