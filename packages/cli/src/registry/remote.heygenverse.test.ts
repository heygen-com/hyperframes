import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_REGISTRY_URL, fetchHeyGenVerseCatalogProjection } from "./remote.js";

const projectionSource = readFileSync(
  resolve(import.meta.dirname, "../../../../registry/heygenverse-catalog.json"),
  "utf8",
);

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["HYPERFRAMES_LOCAL_REGISTRY"];
});

describe("canonical HeyGenVerse projection fetch", () => {
  it("cannot be redirected by a project registry URL", async () => {
    const fetchMock = vi.fn(async () => new Response(projectionSource, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchHeyGenVerseCatalogProjection("https://attacker.invalid/registry"),
    ).resolves.toMatchObject({ schemaVersion: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_REGISTRY_URL}/heygenverse-catalog.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("supports the exact checked-out projection through the fixed loopback developer endpoint", async () => {
    process.env["HYPERFRAMES_LOCAL_REGISTRY"] = "1";
    const fetchMock = vi.fn(async () => new Response(projectionSource, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchHeyGenVerseCatalogProjection()).resolves.toMatchObject({ schemaVersion: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4173/heygenverse-catalog.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
