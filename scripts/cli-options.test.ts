import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLI_SEMVER_PATTERN, validateCliVersion } from "./cli-options.ts";

function fail(message: string): never {
  throw new Error(message);
}

describe("CLI semver validation", () => {
  it("accepts stable and hyphenated prerelease versions", () => {
    assert.doesNotThrow(() => validateCliVersion("1.2.3", CLI_SEMVER_PATTERN, fail));
    assert.doesNotThrow(() => validateCliVersion("1.2.3-alpha.1", CLI_SEMVER_PATTERN, fail));
    assert.doesNotThrow(() =>
      validateCliVersion("1.2.3-alpha-feature.2", CLI_SEMVER_PATTERN, fail),
    );
  });

  it("rejects underscores in prerelease versions", () => {
    assert.throws(
      () => validateCliVersion("1.2.3-alpha_1", CLI_SEMVER_PATTERN, fail),
      /Invalid semver: 1\.2\.3-alpha_1/,
    );
  });
});
