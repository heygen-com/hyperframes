import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { BUN_LOCK_PATH, RUNTIME_SOURCES, bunLockVersion, lockMismatches } from "./runtimeLock.js";

describe("runtime lock", () => {
  const bunLock = readFileSync(BUN_LOCK_PATH, "utf-8");

  it.each(RUNTIME_SOURCES)("the committed %s lock matches bun.lock", (source) => {
    expect(lockMismatches(source, bunLock)).toEqual([]);
  });

  it("reports a bump that was not re-locked", () => {
    const current = bunLockVersion(bunLock, "puppeteer-core");
    const bumped = bunLock.replace(`["puppeteer-core@${current}"`, `["puppeteer-core@999.0.0"`);
    expect(lockMismatches("sparticuz", bumped)).toEqual([
      `sparticuz: puppeteer-core is ${current}, bun.lock has 999.0.0`,
    ]);
  });
});
