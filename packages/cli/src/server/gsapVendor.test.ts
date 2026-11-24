import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

// The CDN's own files (jsDelivr's sha384, as a tag's integrity attribute would pin them).
const CDN_SHA384: Record<string, Record<string, string>> = {
  "3.14.2": {
    "gsap.min.js": "sG0Hv1tP1lZCk9KQmrIbY/XNwi+OY84GQqhMscbnsoBFqAz8KNCil1kvfL3Hbbk2",
    "CustomEase.min.js": "Sjkr6w0fFKkxtEQY7MVGUGYK7lNjV5adCOLTzv8eBXdW2xDCLMNz5mo+iXchMXTh",
    "MotionPathPlugin.min.js": "bRevQK3DiusS1XALpRyWfXNcSVNuNxBOUk12Tk44IsnfepFlBwFe8h/82zWbDxqi",
  },
};

describe("the older GSAP versions the CLI ships", () => {
  const manifest = join(here, "..", "..", "package.json");
  const aliases = Object.keys(JSON.parse(readFileSync(manifest, "utf8")).devDependencies).filter(
    (name) => /^gsap-\d+\.\d+\.\d+$/.test(name),
  );

  // fails without the fix: our own caption templates write gsap@3.14.2, which the CLI did not ship.
  it("include 3.14.2, and each is the CDN's exact bytes", () => {
    expect(aliases).toContain("gsap-3.14.2");
    const require = createRequire(manifest);
    for (const alias of aliases) {
      const version = alias.slice("gsap-".length);
      const root = dirname(require.resolve(`${alias}/package.json`));
      expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version).toBe(version);
      expect(Object.keys(CDN_SHA384[version] ?? {})).toHaveLength(3);
      for (const [file, sha] of Object.entries(CDN_SHA384[version] ?? {})) {
        const got = createHash("sha384")
          .update(readFileSync(join(root, "dist", file)))
          .digest("base64");
        expect(`${version}/${file} ${got}`).toBe(`${version}/${file} ${sha}`);
      }
    }
  });
});
