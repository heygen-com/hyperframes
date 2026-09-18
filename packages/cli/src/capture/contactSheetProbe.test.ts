import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";

const script = `
const t = () => performance.now();
const a = t();
const sharp = (await import("sharp")).default;
const b = t();
await sharp(Buffer.from('<svg width="16" height="26"><text x="8" y="18" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#fff">A</text></svg>')).png().toBuffer();
const c = t();
console.log(JSON.stringify({ importSharp: Math.round(b - a), firstText: Math.round(c - b) }));
`;

it("probe5", () => {
  const dirs = [process.env.LOCALAPPDATA, process.env.TEMP, process.env.USERPROFILE]
    .filter(Boolean)
    .map((d) => join(d as string, "fontconfig"));
  for (const d of dirs) {
    console.log(
      `PROBE5 ${d} exists=${existsSync(d)} ${existsSync(d) ? readdirSync(d).join(",") : ""}`,
    );
  }
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  console.log(`PROBE5 fresh process: ${out.trim()}`);
}, 300_000);
