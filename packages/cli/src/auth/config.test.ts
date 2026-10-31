import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempAuthEnv } from "./_test-utils.js";
import {
  assertOAuthIdentity,
  authorizeEndpoint,
  deviceAuthorizationEndpoint,
  oauthIdentity,
  resolveClientId,
  revokeEndpoint,
  tokenEndpoint,
} from "./config.js";
import { apiBaseUrl } from "./client.js";

describe("HyperFrames OAuth configuration", () => {
  let fixture: Awaited<ReturnType<typeof setupTempAuthEnv>>;
  beforeEach(async () => {
    fixture = await setupTempAuthEnv();
  });
  afterEach(async () => {
    await fixture.restore();
  });

  it("uses the dedicated public production client", () => {
    expect(resolveClientId()).toBe("Zg3LF4FCLoeJoGs2YqMtZ17g");
    expect(authorizeEndpoint()).toBe("https://app.heygen.com/oauth/authorize");
    expect(tokenEndpoint()).toBe("https://api2.heygen.com/v1/oauth/token");
    expect(apiBaseUrl()).toBe("https://api.heygen.com");
  });

  it("switches every default host together for development", () => {
    process.env["HYPERFRAMES_ENV"] = "dev";
    expect(resolveClientId()).toBe("9QoaiwCZov9O0cAkC4OZbR4p");
    expect(authorizeEndpoint()).toBe("https://api2.dev.heygen.com/v1/oauth/authorize");
    expect(tokenEndpoint()).toBe("https://api2.dev.heygen.com/v1/oauth/token");
    expect(revokeEndpoint()).toBe("https://api2.dev.heygen.com/v1/oauth/revoke");
    expect(deviceAuthorizationEndpoint()).toBe(
      "https://api2.dev.heygen.com/v1/oauth/device_authorization",
    );
    expect(apiBaseUrl()).toBe("https://api.dev.heygen.com");
  });

  it("rejects a session after either its client or token server changes", () => {
    const identity = oauthIdentity();
    expect(() => assertOAuthIdentity(identity)).not.toThrow();
    process.env["HYPERFRAMES_OAUTH_CLIENT_ID"] = "another-client";
    expect(() => assertOAuthIdentity(identity)).toThrow("different OAuth client or environment");
    delete process.env["HYPERFRAMES_OAUTH_CLIENT_ID"];
    process.env["HYPERFRAMES_OAUTH_TOKEN_URL"] = "https://other.example/token";
    expect(() => assertOAuthIdentity(identity)).toThrow("different OAuth client or environment");
  });
});
