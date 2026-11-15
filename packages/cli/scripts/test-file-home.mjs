// Each test file gets a home of its own: per-user state such as the render lock is never
// shared by test files running at the same time, so one file's render cannot make another's wait.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const home = mkdtempSync(join(tmpdir(), "hf-test-file-home-"));
process.env.HOME = process.env.USERPROFILE = home;
afterAll(() => rmSync(home, { recursive: true, force: true }));
