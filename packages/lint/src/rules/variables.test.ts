import { describe, expect, it } from "vitest";
import { findByCode } from "./testSupport.js";

const REGISTRY_BLOCK_PATH = "/project/registry/blocks/data-card/data-card.html";

describe("variable rules", () => {
  describe("composition_variable_unused", () => {
    const html = `<!doctype html>
<html data-composition-variables='[
  {"id":"headline","type":"string","label":"Headline","default":"Hello"},
  {"id":"accent","type":"color","label":"Accent","default":"#ff00aa"}
]'>
  <body>
    <div data-composition-id="data-card" style="color: var(--fg, #fff)">
      <script>const accent = getVariables().accent;</script>
    </div>
  </body>
</html>`;

    it("warns for declared variables that are not consumed in registry sources", async () => {
      const [finding, extraFinding] = await findByCode(html, "composition_variable_unused", {
        filePath: REGISTRY_BLOCK_PATH,
      });

      expect(extraFinding).toBeUndefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("headline");
      expect(finding?.message).not.toContain("accent");
    });

    it("warns when explicitly opted in without a registry source path", async () => {
      const findings = await findByCode(html, "composition_variable_unused", {
        enforceThemeTokenContract: true,
      });

      expect(findings).toHaveLength(1);
    });

    it("does not run for normal project compositions by default", async () => {
      const findings = await findByCode(html, "composition_variable_unused", {
        filePath: "/project/index.html",
      });

      expect(findings).toHaveLength(0);
    });

    it("does not warn when every declared variable id appears elsewhere", async () => {
      const compliant = `<!doctype html>
<html data-composition-variables='[
  {"id":"headline","type":"string","label":"Headline","default":"Hello"},
  {"id":"accent","type":"color","label":"Accent","default":"#ff00aa"}
]'>
  <body>
    <div data-composition-id="data-card">
      <h1 data-headline-target="true">Headline</h1>
      <script>
        const vars = getVariables();
        title.textContent = vars.headline;
        root.style.setProperty("--local-accent", vars.accent);
      </script>
    </div>
  </body>
</html>`;

      const findings = await findByCode(compliant, "composition_variable_unused", {
        filePath: REGISTRY_BLOCK_PATH,
      });

      expect(findings).toHaveLength(0);
    });
  });
});
