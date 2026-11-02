import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_REGISTRY_URL,
  REGISTRY_MIRROR_URL,
  registryPathUrl,
  registryHttpsUrl,
  fetchRegistryHttps,
} from "./transport.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
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

const refused = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  });

it("reads a default-registry file from the mirror first", async () => {
  const fetchMock = vi.fn(async (_url: string) => new Response("from mirror"));
  vi.stubGlobal("fetch", fetchMock);
  const response = await fetchRegistryHttps(
    `${DEFAULT_REGISTRY_URL}/registry.json`,
    AbortSignal.timeout(1000),
  );
  expect(await response.text()).toBe("from mirror");
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    `${REGISTRY_MIRROR_URL}/registry.json`,
  ]);
});
it.each([
  ["refuses", async () => Promise.reject(refused())],
  ["answers 404", async () => new Response("missing", { status: 404 })],
  [
    "answers 403, S3's answer for a key it does not hold",
    async () => new Response("", { status: 403 }),
  ],
])("falls back to raw GitHub when the mirror %s", async (_, mirror) => {
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(mirror)
    .mockResolvedValueOnce(new Response("raw"));
  vi.stubGlobal("fetch", fetchMock);
  const response = await fetchRegistryHttps(
    `${DEFAULT_REGISTRY_URL}/blocks/demo/registry-item.json`,
    AbortSignal.timeout(1000),
  );
  expect(await response.text()).toBe("raw");
  expect(fetchMock.mock.calls[1]?.[0]).toBe(
    `${DEFAULT_REGISTRY_URL}/blocks/demo/registry-item.json`,
  );
});
it("names both hosts when neither answers", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Promise.reject(refused())),
  );
  await expect(
    fetchRegistryHttps(`${DEFAULT_REGISTRY_URL}/registry.json`, AbortSignal.timeout(1000)),
  ).rejects.toThrow(
    "Neither registry host answered: static.heygen.ai (ECONNREFUSED), raw.githubusercontent.com (ECONNREFUSED)",
  );
});
it("reads any other registry only where it was given", async () => {
  const fetchMock = vi.fn(async (_url: string) => new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
  await fetchRegistryHttps("https://registry.internal/registry.json", AbortSignal.timeout(1000));
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    "https://registry.internal/registry.json",
  ]);
});

it("leaves a mirror answer that came in time readable past the mirror's cap", async () => {
  vi.useFakeTimers();
  let seen: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Response("from mirror");
    }),
  );
  await fetchRegistryHttps(`${DEFAULT_REGISTRY_URL}/registry.json`, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(seen?.aborted).toBe(false);
});
it("falls back to raw GitHub when the mirror gives no answer within its cap", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    url.startsWith(REGISTRY_MIRROR_URL)
      ? new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        )
      : Promise.resolve(new Response("raw")),
  );
  vi.stubGlobal("fetch", fetchMock);
  const reading = fetchRegistryHttps(
    `${DEFAULT_REGISTRY_URL}/registry.json`,
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(4_000);
  expect(await (await reading).text()).toBe("raw");
});
