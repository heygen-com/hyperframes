import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";

const script = `
import sharp from "sharp";
const s = performance.now();
await sharp(Buffer.from('<svg width="16" height="26"><text x="8" y="18" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#fff">A</text></svg>')).png().toBuffer();
const s2 = performance.now();
await sharp(Buffer.from('<svg width="16" height="26"><text x="8" y="18" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#fff">B</text></svg>')).png().toBuffer();
console.log(JSON.stringify({ first: Math.round(s2 - s), second: Math.round(performance.now() - s2) }));
`;

const run = (name: string, env: Record<string, string>) => {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  console.log(`PROBE ${name}: ${out.trim()}`);
};

it("probe", () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-"));
  const conf = join(dir, "fonts.conf");
  writeFileSync(
    conf,
    `<?xml version="1.0"?><fontconfig><cachedir>${dir.replace(/\\/g, "/")}/cache</cachedir></fontconfig>`,
  );
  run("proc1 default", {});
  run("proc2 default (same machine, new process)", {});
  run("proc3 FONTCONFIG_FILE empty conf", { FONTCONFIG_FILE: conf });
  run("proc4 default again", {});
}, 120_000);
