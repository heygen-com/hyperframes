import { get } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startLoopback, type LoopbackHandle } from "./loopback.js";

describe("auth/loopback", () => {
  let active: LoopbackHandle | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    if (active) {
      await active.close().catch(() => {});
      active = null;
    }
  });

  it("captures `code` when state matches", async () => {
    const handle = await startLoopback({ state: "expected_state", timeoutMs: 5_000 });
    active = handle;
    const redirect = new URL(handle.redirectUri);
    const callback = new URL(`${handle.redirectUri}?code=abc123&state=expected_state`);

    const fetchPromise = fetch(callback.toString());
    const result = await handle.result;
    const res = await fetchPromise;

    expect(result.code).toBe("abc123");
    expect(result.redirectUri).toContain(redirect.host);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Signed in");
  });

  async function expectRejection(args: {
    expectedState: string;
    query: string;
    pattern: RegExp;
  }): Promise<void> {
    const handle = await startLoopback({ state: args.expectedState, timeoutMs: 5_000 });
    active = handle;
    await fetch(`${handle.redirectUri}?${args.query}`).catch(() => {});
    await expect(handle.result).rejects.toThrow(args.pattern);
  }

  it("rejects when state does not match", async () => {
    await expectRejection({
      expectedState: "expected",
      query: "code=abc&state=wrong",
      pattern: /state mismatch/i,
    });
  });

  it("rejects when the IdP returns an error", async () => {
    await expectRejection({
      expectedState: "s",
      query: "error=access_denied&error_description=user+denied&state=s",
      pattern: /access_denied/,
    });
  });

  it("rejects when code is missing from the callback", async () => {
    await expectRejection({ expectedState: "s", query: "state=s", pattern: /code/ });
  });

  it("times out when no callback arrives", async () => {
    const handle = await startLoopback({ state: "s", timeoutMs: 200 });
    active = handle;
    await expect(handle.result).rejects.toThrow(/timed out/i);
  });

  it("404s non-callback paths and does not resolve the flow", async () => {
    const handle = await startLoopback({ state: "s", timeoutMs: 1_000 });
    active = handle;
    const res = await fetch(`${handle.redirectUri.replace("/oauth/callback", "/other")}`);
    expect(res.status).toBe(404);
    // Flow is still waiting — kill it via timeout.
    await expect(handle.result).rejects.toThrow(/timed out/i);
  });

  // Literal on purpose: pins the default. Sign-in can include Stripe checkout.
  const CHECKOUT_WINDOW_MS = 60 * 60 * 1000;

  it("accepts a callback after a slow checkout and leaves no timer behind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = await startLoopback({ state: "s" });
    active = handle;
    await vi.advanceTimersByTimeAsync(CHECKOUT_WINDOW_MS - 1_000);
    // node:http, not fetch: undici registers its own timers, which would pollute the count.
    get(`${handle.redirectUri}?code=the_code&state=s`).on("error", () => {});
    await expect(handle.result).resolves.toMatchObject({ code: "the_code" });
    // Checked before any explicit close(): the flow must clean up after itself on success,
    // or the CLI stays alive for the whole window after "Signed in".
    expect(vi.getTimerCount()).toBe(0);
    await handle.close();
  });

  it("gives up at the checkout window, not before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = await startLoopback({ state: "s" });
    active = handle;
    const settled = vi.fn();
    handle.result.catch(settled);
    await vi.advanceTimersByTimeAsync(CHECKOUT_WINDOW_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    const rejected = expect(handle.result).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
  });
});
