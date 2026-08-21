import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileAdapter } from "./fileAdapter";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFileAdapter", () => {
  it("loads the initial composition through the public SDK adapter contract", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("<main>demo</main>")));
    vi.stubGlobal("fetch", fetchMock);

    const { adapter, initialHtml } = await createFileAdapter();

    expect(initialHtml).toBe("<main>demo</main>");
    expect(await adapter.read("ignored.html")).toBe("<main>demo</main>");
    expect(fetchMock).toHaveBeenCalledWith("/api/composition");
  });

  it("reports failed writes through persist:error without rejecting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { adapter } = await createFileAdapter();
    const errors: string[] = [];
    adapter.on("persist:error", (event) => errors.push(event.error.message));

    await expect(adapter.write("ignored.html", "<main>updated</main>")).resolves.toBeUndefined();

    expect(errors).toEqual(["Error: write failed: 500"]);
  });

  it("maps persisted versions to the SDK version shape", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(Response.json([{ key: "version-2", timestamp: 42 }], { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { adapter } = await createFileAdapter();

    await expect(adapter.listVersions("ignored.html")).resolves.toEqual([
      { key: "version-2", content: "", timestamp: 42 },
    ]);
  });
});
