import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPublishApiBaseUrlMock = vi.hoisted(() => vi.fn(() => "https://api.example.com"));

vi.mock("./publishProject.js", () => ({
  getPublishApiBaseUrl: getPublishApiBaseUrlMock,
}));

import { submitFeedback } from "./submitFeedback.js";

describe("submitFeedback", () => {
  beforeEach(() => {
    getPublishApiBaseUrlMock.mockReturnValue("https://api.example.com");
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts feedback to the backend endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitFeedback({
      rating: 4,
      comment: "fast but font missing",
      cliVersion: "1.2.3",
      env: "os=darwin/arm64 node=v22.11.0",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getPublishApiBaseUrlMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/hyperframes/feedback",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json", heygen_route: "canary" },
        body: JSON.stringify({
          rating: 4,
          comment: "fast but font missing",
          cli_version: "1.2.3",
          env: "os=darwin/arm64 node=v22.11.0",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("truncates over-long fields to the backend caps", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitFeedback({
      rating: 3,
      comment: "x".repeat(2500),
      cliVersion: "v".repeat(200),
      env: "e".repeat(600),
    });

    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit).toBeDefined();
    const body = JSON.parse(requestInit?.body as string);
    expect(body.comment).toHaveLength(2000);
    expect(body.cli_version).toHaveLength(100);
    expect(body.env).toHaveLength(500);
  });

  it("does not reject when fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitFeedback({ rating: 1, cliVersion: "1.2.3", env: "os=linux" }),
    ).resolves.toBeUndefined();
  });

  it("always resolves regardless of fetch outcome", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitFeedback({ rating: 2, cliVersion: "1.2.3" })).resolves.toBeUndefined();
    await expect(submitFeedback({ rating: 3, cliVersion: "1.2.3" })).resolves.toBeUndefined();
  });
});
