import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { it } from "vitest";

const t = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  const s = performance.now();
  const r = await fn();
  console.log(`PROBE ${name}: ${(performance.now() - s).toFixed(0)}ms`);
  return r;
};

it("probe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-"));
  try {
    const a = join(dir, "a.png");
    const px = {
      create: { width: 16, height: 9, channels: 3 as const, background: { r: 255, g: 0, b: 0 } },
    };
    await t("write a.png cold", () => sharp(px).png().toFile(a));
    await t("write a.png warm", () => sharp(px).png().toFile(a));
    await t("metadata", () => sharp(a).metadata());
    await t("resize contain", () =>
      sharp(a)
        .resize(16, 9, { fit: "contain", background: { r: 26, g: 26, b: 26 } })
        .toBuffer(),
    );
    const svg = (x: string) =>
      Buffer.from(
        `<svg width="16" height="26"><rect width="16" height="26" fill="#1a1a1a"/><text x="8" y="18" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="bold" fill="#fff">${x}</text></svg>`,
      );
    const rect = Buffer.from(
      `<svg width="16" height="26"><rect width="16" height="26" fill="#1a1a1a"/></svg>`,
    );
    await t("svg rect only", () => sharp(rect).png().toBuffer());
    await t("svg text cold", () => sharp(svg("A")).png().toBuffer());
    await t("svg text warm", () => sharp(svg("B")).png().toBuffer());
    const ov = await sharp(svg("C")).png().toBuffer();
    await t("composite+png write", () =>
      sharp({ create: { width: 40, height: 40, channels: 3, background: "#1a1a1a" } })
        .composite([{ input: ov, left: 0, top: 0 }])
        .png()
        .toFile(join(dir, "s.png")),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
