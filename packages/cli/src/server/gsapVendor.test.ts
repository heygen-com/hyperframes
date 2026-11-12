import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("resolveGsapVendorDir", () => {
  // fails without the fix: run as ESM from source (tsx, as render does in dev), `__dirname` is not defined.
  it("answers without throwing when the CLI runs as ESM from source", () => {
    const script = `import { resolveGsapVendorDir } from ${JSON.stringify(pathToFileURL(join(here, "gsapVendor.ts")).href)};
      const dir = resolveGsapVendorDir();
      console.log(dir === null || typeof dir === "string" ? "ok" : "bad");`;
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        encoding: "utf8",
        cwd: join(here, "..", ".."),
      },
    );
    expect(out.trim()).toBe("ok");
  }, 30_000);
});
