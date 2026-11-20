import { describe, expect, it } from "vitest";
import { runtimeVersionError, runtimeVersionJson } from "./runtimeVersion.js";

describe("runtimeVersionError", () => {
  it("rejects Node 20 before the bundled CLI is imported", () => {
    expect(runtimeVersionError("20.11.1")).toBe(
      "HyperFrames requires Node.js >= 22.19 (current: 20.11.1). Switch Node versions and retry.",
    );
  });

  it("accepts supported Node releases", () => {
    expect(runtimeVersionError("22.19.0")).toBeNull();
    expect(runtimeVersionError("23.0.0")).toBeNull();
    expect(runtimeVersionError("24.14.0")).toBeNull();
  });

  it("rejects a Node 22 older than 22.19, which undici 8 needs", () => {
    expect(runtimeVersionError("22.18.0")).toContain(
      "requires Node.js >= 22.19 (current: 22.18.0)",
    );
  });

  it("rejects malformed versions safely", () => {
    expect(runtimeVersionError("unknown")).toContain("requires Node.js >= 22.19");
  });
});

describe("runtimeVersionJson", () => {
  const message = "HyperFrames requires Node.js >= 22 (current: 20.11.1).";

  it("answers a --json run with the failure envelope", () => {
    expect(JSON.parse(runtimeVersionJson(message, ["render", ".", "--json"]) ?? "")).toEqual({
      ok: false,
      error: { code: "node_version_unsupported", message },
    });
  });

  it("stays out of a run that did not ask for JSON", () => {
    expect(runtimeVersionJson(message, ["render", "."])).toBeNull();
  });
});
