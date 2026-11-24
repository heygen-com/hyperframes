import { afterEach, expect, it, vi } from "vitest";
import { registryPathUrl, registryHttpsUrl, fetchRegistryHttps } from "./transport.js";

const network = vi.hoisted(() => ({ publicRequest: vi.fn() }));
vi.mock("@hyperframes/engine/public-network", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine/public-network")>()),
  publicRequest: network.publicRequest,
}));

afterEach(() => vi.unstubAllGlobals());
it("preserves private registries and signed CDN URLs while encoding path segments", () => {
  expect(
    registryPathUrl("https://registry.internal/base/", "blocks", "demo", "my file#.html"),
  ).toBe("https://registry.internal/base/blocks/demo/my%20file%23.html");
  expect(registryHttpsUrl("https://cdn.example/a?signature=abc").search).toBe("?signature=abc");
  expect(() => registryPathUrl("https://registry.internal/?secret=1", "registry.json")).toThrow();
  expect(() => registryPathUrl("https://registry.internal", "../escape")).toThrow();
});
it.each([
  "http://private.example/file",
  "https://user:pass@private.example/file",
  "file:///tmp/file",
])("rejects unsafe redirect %s before issuing its request", async (location) => {
  const cancel = vi.fn();
  const fetchMock = vi.fn(
    async () =>
      new Response(new ReadableStream({ cancel }), { status: 302, headers: { location } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    fetchRegistryHttps("https://registry.internal/file", AbortSignal.timeout(1000)),
  ).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledOnce();
});
it("follows a relative HTTPS redirect", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "../asset" } }))
    .mockResolvedValueOnce(new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await (
      await fetchRegistryHttps("https://private.example/base/file", AbortSignal.timeout(1000))
    ).text(),
  ).toBe("ok");
  expect(fetchMock.mock.calls[1]?.[0]).toBe("https://private.example/asset");
});
// fails without the fix: a public-only hop let a configured capture proxy pick the address
it("sends a public-only hop down the pinned route, never a configured proxy", async () => {
  network.publicRequest.mockResolvedValueOnce(new Response("ok"));
  const response = await fetchRegistryHttps(
    "https://registry.example.com/x",
    AbortSignal.timeout(1000),
    true,
  );
  expect(await response.text()).toBe("ok");
  expect(network.publicRequest).toHaveBeenCalledWith(expect.any(URL), expect.anything(), null);
});
