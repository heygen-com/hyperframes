import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bundler warnings that name project files", () => {
  it.each([
    ["raw", "sub\u001b]0;title\u0007\u001b[2K.html"],
    ["as numeric entities", "sub&#27;]0;title&#7;&#27;[2K.html"],
  ])(
    "write control characters in a sub-composition path out as visible escapes (%s)",
    async (_, src) => {
      const dir = mkdtempSync(join(tmpdir(), "hf-bundler-terminal-"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        writeFileSync(
          join(dir, "index.html"),
          `<html><body><main data-composition-id="root" data-width="320" data-height="180"><div data-composition-id="sub" data-composition-src="${src}"></div></main></body></html>`,
        );
        await bundleToSingleHtml(dir, { runtime: "placeholder" });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      const printed = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(printed).toContain("Skipping sub-composition");
      expect(printed).toContain("\\x1b]0;title\\x07");
      for (const control of ["\u001b", "\u0007"]) expect(printed).not.toContain(control);
    },
  );

  it("write control characters in an inline template's id out as visible escapes when its import map is skipped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bundler-terminal-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = "sc&#27;]0;title&#7;";
    try {
      writeFileSync(
        join(dir, "index.html"),
        `<html><body><main data-composition-id="root" data-width="320" data-height="180"><div data-composition-id="${id}"></div></main><template id="${id}-template"><div data-composition-id="${id}"><script type="importmap">{ not json</script></div></template></body></html>`,
      );
      await bundleToSingleHtml(dir, { runtime: "placeholder" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const printed = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(printed).toContain("sc\\x1b]0;title\\x07: import map is not valid JSON");
    for (const control of ["\u001b", "\u0007"]) expect(printed).not.toContain(control);
  });
});
