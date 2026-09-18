import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";

const script = `
import sharp from "sharp";
const t = () => performance.now();
const a = t();
await sharp(Buffer.from('<svg width="16" height="26"><text x="8" y="18" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#fff">A</text></svg>')).png().toBuffer();
const b = t();
await sharp(Buffer.from('<svg width="16" height="26"><text x="8" y="18" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#fff">B</text></svg>')).png().toBuffer();
console.log(JSON.stringify({ first: Math.round(b - a), second: Math.round(t() - b) }));
`;

const run = (name: string, env: Record<string, string>) => {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  console.log(`PROBE4 ${name}: ${out.trim()}`);
};

const fwd = (p: string) => p.replace(/\\/g, "/");
const conf = (dir: string, fontDirs: string[]) => {
  const file = join(dir, "fonts.conf");
  writeFileSync(
    file,
    `<?xml version="1.0"?><fontconfig>${fontDirs.map((d) => `<dir>${fwd(d)}</dir>`).join("")}<cachedir>${fwd(dir)}/cache</cachedir></fontconfig>`,
  );
  return file;
};

it("probe4", () => {
  const winFonts = join(process.env.WINDIR ?? "C:\\Windows", "Fonts");
  console.log(
    `PROBE4 windir fonts exists=${existsSync(winFonts)} count=${existsSync(winFonts) ? readdirSync(winFonts).length : 0}`,
  );
  const d1 = mkdtempSync(join(tmpdir(), "fcA-"));
  const full = conf(d1, [winFonts]);
  run("A full Windows fonts, cold private cache", { FONTCONFIG_FILE: full });
  run("B same conf+cache, new process (disk cache warm)", { FONTCONFIG_FILE: full });
  const d2 = mkdtempSync(join(tmpdir(), "fcC-"));
  const one = join(d2, "fonts");
  mkdirSync(one);
  const arial = join(winFonts, "arial.ttf");
  if (existsSync(arial)) copyFileSync(arial, join(one, "arial.ttf"));
  const min = conf(d2, [one]);
  run("C one font dir (arial.ttf only), cold private cache", { FONTCONFIG_FILE: min });
  run("D same, new process", { FONTCONFIG_FILE: min });
  run("E default env (no conf)", {});
}, 300_000);
