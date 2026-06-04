import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The 401-retry decorator calls forceRefreshCredentials() and the factory
// resolves base URL / auth headers from auth.js. Mock the module so the
// tests control the token lifecycle without touching the real credential
// store on disk.
vi.mock("./auth.js", () => ({
  forceRefreshCredentials: vi.fn(),
  resolveCloudAuthHeaders: vi.fn(),
  resolveCloudBaseUrl: vi.fn(() => "https://cloud.test"),
}));

import { forceRefreshCredentials, resolveCloudAuthHeaders } from "./auth.js";
import { createCloudClient } from "./index.js";
import { HyperframesApiError } from "./_gen/client.js";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const ok = (body: unknown): Response => jsonResponse(200, body);
const unauthorized = (): Response =>
  jsonResponse(401, { error: { message: "token revoked", code: "unauthorized" } });

// Narrow a recorded fetch call to the headers of its RequestInit without
// casting; throws (failing the test) if the call shape is unexpected.
const headersOf = (call: readonly unknown[] | undefined): unknown => {
  const init = call?.[1];
  if (init === null || init === undefined || typeof init !== "object" || !("headers" in init)) {
    throw new Error("expected fetch to be called with a RequestInit carrying headers");
  }
  return init.headers;
};

describe("createCloudClient 401-retry decorator", () => {
  // The generated client falls back to global fetch when no fetchImpl is
  // injected, and createCloudClient doesn't expose that knob — stub the
  // global so the decorator under test wraps the same client the cloud
  // commands get.
  let fetchMock: ReturnType<typeof vi.fn>;
  let token: string;

  beforeEach(() => {
    token = "tok-old";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(resolveCloudAuthHeaders).mockImplementation(async () => ({
      authorization: `Bearer ${token}`,
    }));
    vi.mocked(forceRefreshCredentials).mockReset();
    vi.mocked(forceRefreshCredentials).mockImplementation(async () => {
      token = "tok-new";
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes a successful call through without refreshing", async () => {
    fetchMock.mockResolvedValueOnce(ok({ data: { id: "hfr_1", status: "complete" } }));

    const client = await createCloudClient();
    const render = await client.getRender({ render_id: "hfr_1" });

    expect(render).toEqual({ id: "hfr_1", status: "complete" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(forceRefreshCredentials).not.toHaveBeenCalled();
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok({ data: { id: "hfr_1", status: "complete" } }));

    const client = await createCloudClient();
    const render = await client.getRender({ render_id: "hfr_1" });

    expect(render).toEqual({ id: "hfr_1", status: "complete" });
    expect(forceRefreshCredentials).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The retry must re-resolve credentials, not replay the stale header:
    // a refresh that isn't picked up would 401 forever.
    expect(headersOf(fetchMock.mock.calls[0])).toMatchObject({
      authorization: "Bearer tok-old",
    });
    expect(headersOf(fetchMock.mock.calls[1])).toMatchObject({
      authorization: "Bearer tok-new",
    });
  });

  it("surfaces the original 401 when the refresh itself fails", async () => {
    fetchMock.mockResolvedValueOnce(unauthorized());
    vi.mocked(forceRefreshCredentials).mockRejectedValueOnce(new Error("refresh_token expired"));

    const client = await createCloudClient();
    const call = client.getRender({ render_id: "hfr_1" });

    // The decorator promises to surface the 401, not the refresh error —
    // the 401 carries the API's message/code, which reportApiError needs.
    await expect(call).rejects.toMatchObject({
      name: "HyperframesApiError",
      status: 401,
      message: "token revoked",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once: a second 401 propagates", async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized());

    const client = await createCloudClient();
    const call = client.getRender({ render_id: "hfr_1" });

    await expect(call).rejects.toMatchObject({ status: 401 });
    expect(forceRefreshCredentials).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh on non-401 API errors", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { message: "internal", code: "internal_error" } }),
    );

    const client = await createCloudClient();
    const call = client.listRenders({});

    await expect(call).rejects.toBeInstanceOf(HyperframesApiError);
    await expect(call).rejects.toMatchObject({ status: 500 });
    expect(forceRefreshCredentials).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on transport errors that aren't HyperframesApiError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const client = await createCloudClient();
    const call = client.getRender({ render_id: "hfr_1" });

    await expect(call).rejects.toThrow("fetch failed");
    expect(forceRefreshCredentials).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
