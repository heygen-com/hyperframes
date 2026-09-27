import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { sep } from "node:path";
import { test } from "node:test";

test("the skills test run has a home folder of its own, not the user's", () => {
  assert.ok(realpathSync(homedir()).startsWith(realpathSync(tmpdir()) + sep));
  assert.notEqual(homedir(), userInfo().homedir);
});
