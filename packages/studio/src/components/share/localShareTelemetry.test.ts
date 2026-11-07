import { afterEach, expect, it, vi } from "vitest";
const policy = vi.hoisted(() => vi.fn());
vi.mock("../../telemetry/policy", () => ({ browserTelemetryAllowed: policy }));
import { shareInteraction } from "./localShareTelemetry";
afterEach(() => vi.unstubAllGlobals());
it("obeys browser opt-out before calling the guarded local bridge", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  policy.mockReturnValue(false);
  shareInteraction("token", { event: "share_opened", link: "none" });
  expect(fetch).not.toHaveBeenCalled();
  policy.mockReturnValue(true);
  shareInteraction("token", { event: "share_link_copied", via: "copy" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/share/events",
    expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hyperframes-Share-CSRF": "token" },
      body: JSON.stringify({ event: "share_link_copied", via: "copy" }),
    }),
  );
});
