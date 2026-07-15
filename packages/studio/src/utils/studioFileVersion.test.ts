import { describe, expect, it } from "vitest";
import { studioExpectedFileVersion, studioFileContentVersion } from "./studioFileVersion";

describe("studioFileContentVersion", () => {
  it("matches the strong SHA-256 ETag format used by studio-server", async () => {
    await expect(studioFileContentVersion("abc")).resolves.toBe(
      '"sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"',
    );
  });

  it("keeps an explicit content precondition authoritative over cached state", async () => {
    const versions = new Map<string, string | null>([
      ["stale.html", await studioFileContentVersion("stale")],
      ["newer.html", await studioFileContentVersion("newer")],
      ["missing.html", null],
    ]);
    const expectedVersion = await studioFileContentVersion("expected");

    expect(await studioExpectedFileVersion(versions, "stale.html", "expected")).toBe(
      expectedVersion,
    );
    expect(await studioExpectedFileVersion(versions, "newer.html", "expected")).toBe(
      expectedVersion,
    );
    expect(await studioExpectedFileVersion(versions, "missing.html", "expected")).toBe(
      expectedVersion,
    );
  });

  it("keeps known-missing and untracked files distinct without explicit content", async () => {
    const versions = new Map<string, string | null>([["missing.html", null]]);

    expect(await studioExpectedFileVersion(versions, "missing.html")).toBeNull();
    expect(await studioExpectedFileVersion(versions, "untracked.html")).toBeUndefined();
  });
});
