import { describe, expect, it } from "vitest";
import { heygenUserId, telemetryIdentity } from "./telemetryIdentity.js";

describe("heygenUserId", () => {
  // Vectors from the HyperFrames web app's toUUID (demo-next derive-user-id.ts),
  // which keys its users table and PostHog persons. A mismatch splits one person
  // across the CLI and the web app.
  it("matches the web app's derived user id", () => {
    expect(heygenUserId("alice")).toBe("2bd806c9-7f0e-50af-9a1f-c3328fa763a9");
    expect(heygenUserId("21e28514b7994f46b907b74914a3ca6e")).toBe(
      "9f3df3a5-89ae-5609-b80b-ce3b7d5f8c37",
    );
  });
  it("passes a UUID through unhashed, like the web app", () => {
    const id = "6f1c0d4e-2b3a-4c5d-8e9f-0a1b2c3d4e5f";
    expect(heygenUserId(id)).toBe(id);
  });

  // media-use/lib/telemetry.test.mjs pins the same "alice" vector for its copy.
});

describe("telemetryIdentity", () => {
  it("keys on the username and sets email and heygen_username", () => {
    expect(telemetryIdentity({ username: "alice", email: " Alice@Example.com " })).toEqual({
      distinctId: "2bd806c9-7f0e-50af-9a1f-c3328fa763a9",
      traits: { email: "alice@example.com", heygen_username: "alice" },
    });
  });

  it("keeps the username exactly as HeyGen returns it", () => {
    expect(telemetryIdentity({ username: "Alice" })?.traits).toEqual({ heygen_username: "Alice" });
  });

  it("falls back to the lowercased email without a username", () => {
    expect(telemetryIdentity({ email: "Alice@Example.com" })).toEqual({
      distinctId: "alice@example.com",
      traits: { email: "alice@example.com" },
    });
  });

  it("returns nothing without an email or username", () => {
    expect(telemetryIdentity({ username: "  ", email: "" })).toBeUndefined();
  });
});
