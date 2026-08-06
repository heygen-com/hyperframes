import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempAuthEnv } from "../auth/_test-utils.js";
import { writeStore } from "../auth/store.js";
import { authorizeThreadMessageStackInstall } from "./threadMessageStackAuthorization.js";

describe("thread-message-stack verified OAuth authorization", () => {
  let fixture: Awaited<ReturnType<typeof setupTempAuthEnv>>;

  beforeEach(async () => {
    fixture = await setupTempAuthEnv("hf-thread-oauth-");
  });

  afterEach(async () => await fixture.restore());

  it("does not accept an API key as OAuth and preserves cancellation", async () => {
    process.env["HEYGEN_API_KEY"] = "api-key-only";
    const authenticate = vi.fn(async () => "cancelled" as const);
    const verify = vi.fn();

    await expect(authorizeThreadMessageStackInstall({ authenticate, verify })).resolves.toBe(
      "cancelled",
    );
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(verify).not.toHaveBeenCalled();
  });

  it("requires the OAuth token to pass a current-user verification", async () => {
    await writeStore({ oauth: { access_token: "oauth-access-token" } });
    const verify = vi.fn(async () => ({ email: "verified@example.com" }));

    await expect(authorizeThreadMessageStackInstall({ verify })).resolves.toBe("authorized");
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "oauth", access_token: "oauth-access-token" }),
    );
  });

  it("fails closed when OAuth identity verification fails", async () => {
    await writeStore({ oauth: { access_token: "oauth-access-token" } });

    await expect(
      authorizeThreadMessageStackInstall({
        verify: async () => {
          throw new Error("unverified");
        },
      }),
    ).resolves.toBe("failed");
  });
});
