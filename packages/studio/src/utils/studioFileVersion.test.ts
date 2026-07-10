import { describe, expect, it } from "vitest";
import { studioExpectedFileVersion, studioFileContentVersion } from "./studioFileVersion";

describe("studioFileContentVersion", () => {
  it("matches the strong SHA-256 ETag format used by studio-server", async () => {
    await expect(studioFileContentVersion("abc")).resolves.toBe(
      '"sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"',
    );
  });

  it("keeps a known-missing version distinct from known empty content", async () => {
    const versions = new Map<string, string | null>([["missing.html", null]]);

    expect(await studioExpectedFileVersion(versions, "missing.html", "")).toBeNull();
    expect(await studioExpectedFileVersion(versions, "empty.html", "")).toBe(
      await studioFileContentVersion(""),
    );
  });
});
