import { describe, expect, it } from "vitest";
import { shouldReloadSdkSession } from "./useSdkSession";

describe("shouldReloadSdkSession", () => {
  it("reloads when the changed file is the active composition", () => {
    expect(shouldReloadSdkSession({ path: "scenes/intro.html" }, "scenes/intro.html")).toBe(true);
  });

  it("ignores changes to other files", () => {
    expect(shouldReloadSdkSession({ path: "styles/main.css" }, "scenes/intro.html")).toBe(false);
  });

  it("ignores changes when no composition is active", () => {
    expect(shouldReloadSdkSession({ path: "scenes/intro.html" }, null)).toBe(false);
  });

  it("ignores payloads with no resolvable path", () => {
    expect(shouldReloadSdkSession({}, "scenes/intro.html")).toBe(false);
  });
});
