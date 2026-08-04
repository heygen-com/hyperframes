import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  auditSnippets,
  autoplays,
  findMotionGuardViolations,
} from "./check-docs-snippet-motion.mjs";

const GUARDED = `
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (!reducedMotion || !gridRef.current) return;
    for (const video of gridRef.current.querySelectorAll("video")) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, [reducedMotion]);
  return <video autoPlay={!reducedMotion} />;
`;

test("a guarded snippet passes", () => {
  assert.deepEqual(findMotionGuardViolations(GUARDED), []);
});

test("reading the preference after mount is caught — the first-paint fetch", () => {
  const lateRead = GUARDED.replace(
    /const \[reducedMotion[\s\S]*?\);\n/,
    "const [reducedMotion, setReducedMotion] = useState(false);\n",
  );
  const problems = findMotionGuardViolations(lateRead);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /lazy initializer/);
});

test("false -> true with no active stop is caught — the regression Magi asked for", () => {
  const noStop = GUARDED.replace(/\s*video\.pause\(\);[\s\S]*?video\.load\(\);/, "");
  const problems = findMotionGuardViolations(noStop);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not pause an element or abort its resource/);
});

test("dropping only load\\(\\) is still caught", () => {
  const partial = GUARDED.replace("      video.load();\n", "");
  assert.equal(findMotionGuardViolations(partial).length, 1);
});

test("snippets that never autoplay are out of scope", () => {
  assert.equal(autoplays('<video controls muted playsInline preload="metadata" />'), false);
  assert.equal(autoplays("<video autoPlay={!reduced} />"), true);
});

test("every autoplaying snippet in docs/snippets currently satisfies the guard", () => {
  assert.deepEqual(auditSnippets(), []);
});
