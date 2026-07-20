import { describe, expect, it } from "vitest";
import {
  STUDIO_SDK_OPERATION_FAMILIES,
  isSdkFamilyEnabled,
  renderStudioSdkCutoverReport,
  resolveEnabledSdkFamilies,
} from "./sdkCutoverPolicy";

describe("Studio SDK operation-family policy", () => {
  it("enables no family from the master switch alone", () => {
    expect(resolveEnabledSdkFamilies({}, true).size).toBe(0);
    expect(resolveEnabledSdkFamilies({ VITE_STUDIO_SDK_CUTOVER_FAMILIES: "dom" }, false).size).toBe(
      0,
    );
  });

  it("enables only explicitly selected families", () => {
    const enabled = resolveEnabledSdkFamilies(
      { VITE_STUDIO_SDK_CUTOVER_FAMILIES: "dom, gsap-keyframe" },
      true,
    );
    expect(isSdkFamilyEnabled(true, enabled, "dom")).toBe(true);
    expect(isSdkFamilyEnabled(true, enabled, "gsap-keyframe")).toBe(true);
    expect(isSdkFamilyEnabled(true, enabled, "timing")).toBe(false);
  });

  it("rejects misspelled family configuration", () => {
    expect(() =>
      resolveEnabledSdkFamilies({ VITE_STUDIO_SDK_CUTOVER_FAMILIES: "dom,gsap-twen" }, true),
    ).toThrow("Unknown Studio SDK cutover families: gsap-twen");
  });

  it("reports every family with owner, deadline, evidence, and graduation state", () => {
    const report = renderStudioSdkCutoverReport();
    for (const family of STUDIO_SDK_OPERATION_FAMILIES) expect(report).toContain(`| ${family} |`);
    expect(report).toContain("Graduated");
  });
});
