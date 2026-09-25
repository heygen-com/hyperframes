import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("MV3 manifest", () => {
  it("keeps the product gesture and least-privilege surface", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(import.meta.dirname, "../manifest.json"), "utf8"),
    );
    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "clipboardWrite", "offscreen"]);
    expect(manifest.commands._execute_action).toBeDefined();
    expect(manifest.action.default_popup).toBe("popup.html");
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("optional_host_permissions");
    expect(manifest).not.toHaveProperty("web_accessible_resources");
  });
});
