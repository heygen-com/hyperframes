import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("external file-change subscription ownership", () => {
  it("has one subscriber instead of independent Preview and SDK listeners", () => {
    const preview = readFileSync(new URL("./usePreviewPersistence.ts", import.meta.url), "utf8");
    const sdk = readFileSync(new URL("./useSdkSession.ts", import.meta.url), "utf8");
    const coordinator = readFileSync(
      new URL("./useExternalFileChangeCoordinator.ts", import.meta.url),
      "utf8",
    );

    expect(preview).not.toContain('hot.on("hf:file-change"');
    expect(sdk).not.toContain('hot.on("hf:file-change"');
    expect(coordinator.match(/hot\.on\("hf:file-change"/g)).toHaveLength(1);
  });
});
