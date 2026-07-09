import { describe, expect, it } from "vitest";
import { findByCode } from "./testSupport.js";

const REGISTRY_BLOCK_PATH = "/project/registry/blocks/theme-card/theme-card.html";

describe("theme rules", () => {
  describe("theme_token_root_redeclare", () => {
    const html = `<!doctype html>
<html>
  <head>
    <style>
      :root, .local { --bg: #050505; }
      body { --brand: #ff00aa; }
      .card { color: var(--fg, #fff); }
    </style>
  </head>
  <body><div data-composition-id="theme-card"></div></body>
</html>`;

    it("errors for contract tokens redeclared on root selectors in registry sources", async () => {
      const findings = await findByCode(html, "theme_token_root_redeclare", {
        filePath: REGISTRY_BLOCK_PATH,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("error");
      expect(findings[0]!.message).toContain("--bg");
      expect(findings[0]!.message).toContain("--brand");
      expect(findings[0]!.message).toContain(":root");
      expect(findings[0]!.message).toContain("body");
    });

    it("errors when explicitly opted in without a registry source path", async () => {
      const findings = await findByCode(html, "theme_token_root_redeclare", {
        enforceThemeTokenContract: true,
      });

      expect(findings).toHaveLength(1);
    });

    it("does not run for normal project compositions by default", async () => {
      const findings = await findByCode(html, "theme_token_root_redeclare", {
        filePath: "/project/index.html",
      });

      expect(findings).toHaveLength(0);
    });

    it("does not error when contract tokens are used with fallbacks at point of use", async () => {
      const compliant = `<!doctype html>
<html>
  <head>
    <style>
      .card {
        background: var(--bg, #050505);
        color: var(--fg, #ffffff);
      }
    </style>
  </head>
  <body><div data-composition-id="theme-card" class="card"></div></body>
</html>`;

      const findings = await findByCode(compliant, "theme_token_root_redeclare", {
        filePath: REGISTRY_BLOCK_PATH,
      });

      expect(findings).toHaveLength(0);
    });
  });

  describe("theme_token_fallback_missing", () => {
    const html = `<!doctype html>
<html>
  <head>
    <style>
      .card {
        color: var(--fg);
        background: var(--bg, #050505);
      }
    </style>
  </head>
  <body>
    <div data-composition-id="theme-card" style="border-color: var(--border)"></div>
  </body>
</html>`;

    it("warns for contract token var() calls without fallbacks in registry sources", async () => {
      const findings = await findByCode(html, "theme_token_fallback_missing", {
        filePath: REGISTRY_BLOCK_PATH,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("warning");
      expect(findings[0]!.message).toContain("--fg");
      expect(findings[0]!.message).toContain("--border");
    });

    it("warns when explicitly opted in without a registry source path", async () => {
      const findings = await findByCode(html, "theme_token_fallback_missing", {
        enforceThemeTokenContract: true,
      });

      expect(findings).toHaveLength(1);
    });

    it("does not run for normal project compositions by default", async () => {
      const findings = await findByCode(html, "theme_token_fallback_missing", {
        filePath: "/project/index.html",
      });

      expect(findings).toHaveLength(0);
    });

    it("does not warn when every contract token var() call has a fallback", async () => {
      const compliant = `<!doctype html>
<html>
  <head>
    <style>
      .card {
        color: var(--fg, #ffffff);
        background: var(--bg, #050505);
      }
    </style>
  </head>
  <body>
    <div data-composition-id="theme-card" style="border-color: var(--border, #222222)"></div>
  </body>
</html>`;

      const findings = await findByCode(compliant, "theme_token_fallback_missing", {
        filePath: REGISTRY_BLOCK_PATH,
      });

      expect(findings).toHaveLength(0);
    });
  });
});
