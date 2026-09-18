import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter";

const findRemoteScriptFindings = async (html: string) => {
  const result = await lintHyperframeHtml(html);
  return result.findings.filter((f) => f.code === "remote_script_not_vendored");
};

describe("remote_script_not_vendored", () => {
  it("flags a remote script src as info with a vendor fixHint", async () => {
    const findings = await findRemoteScriptFindings(
      `<div id="root" class="clip" data-duration="1">
         <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
       </div>`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "info" });
    expect(findings[0]?.fixHint).toContain("hyperframes vendor");
  });

  it("dedupes repeated URLs and ignores local or inline scripts", async () => {
    const findings = await findRemoteScriptFindings(
      `<div id="root" class="clip" data-duration="1">
         <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
         <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
         <script src="assets/vendor/gsap.min.js"></script>
         <script>console.log("inline");</script>
       </div>`,
    );
    expect(findings).toHaveLength(1);
  });

  it("stays silent on fully local compositions", async () => {
    const findings = await findRemoteScriptFindings(
      `<div id="root" class="clip" data-duration="1">
         <script src="./gsap.min.js"></script>
       </div>`,
    );
    expect(findings).toHaveLength(0);
  });
});
