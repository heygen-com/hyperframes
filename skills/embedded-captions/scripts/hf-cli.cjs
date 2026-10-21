// Resolve CLI ownership once for matting, transcription, and shell rendering.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
function hfCli(checkout) {
  const root = path.resolve(__dirname, "../../..");
  for (const dir of [checkout, process.env.HYPERFRAMES_ROOT].filter(Boolean)) {
    const cli = path.join(dir, "packages/cli/dist/cli.js");
    if (fs.existsSync(cli)) return cli;
  }
  const manifests = [
    "plugin.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    "gemini-extension.json",
  ];
  if (
    !fs.existsSync(path.join(root, "packages/cli/dist/cli.js")) &&
    manifests.some((p) => fs.existsSync(path.join(root, p)))
  ) {
    return path.join(root, "skills/hyperframes/scripts/plugin-cli.mjs");
  }
  for (const dir of [root, path.join(os.homedir(), "Downloads/hyperframes")].filter(Boolean)) {
    const cli = path.join(dir, "packages/cli/dist/cli.js");
    if (fs.existsSync(cli)) return cli;
  }
  throw new Error(
    "HyperFrames CLI unavailable: install the full plugin or set HYPERFRAMES_ROOT to a built checkout.",
  );
}
// Folders from `start` up to the filesystem root.
function upFrom(start) {
  const dirs = [];
  for (let d = path.resolve(start); ; d = path.dirname(d)) {
    dirs.push(d);
    if (path.dirname(d) === d) return dirs;
  }
}
const isExe = (p) => {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
/** The headless Chrome these scripts launch. Never the installed Google Chrome app: on macOS a killed Chrome.app
 * leaves a ~1.4 GB code_sign_clone behind, and chrome-headless-shell is a plain binary that leaves none.
 * Order: HYPERFRAMES_BROWSER_PATH (taken as set: the user chose it), the pinned build `hyperframes browser path`
 * prints, the newest cached chrome-headless-shell; otherwise throw with an install hint. The CLI's answer must be a
 * chrome-headless-shell: with no cached shell it prints the system Chrome. */
function hfBrowser() {
  const env = process.env.HYPERFRAMES_BROWSER_PATH;
  if (env && isExe(env)) return env;
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const isShell = (p) => !!p && path.basename(p) === exe && fs.existsSync(p);
  const { execFileSync } = require("node:child_process");
  const asks = [() => [process.execPath, [hfCli(), "browser", "path"]]];
  const bins = new Set(); // cwd and script folder share parents: ask each CLI once
  for (const s of [process.cwd(), __dirname])
    for (const d of upFrom(s)) {
      const bin = path.join(d, "node_modules", ".bin", "hyperframes");
      if (bins.has(bin) || !isExe(bin)) continue;
      bins.add(bin);
      asks.push(() => [bin, ["browser", "path"]]);
    }
  asks.push(() => ["hyperframes", ["browser", "path"]]);
  for (const ask of asks) {
    try {
      const [command, args] = ask();
      const out = execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 30000,
      });
      const found = out.trim().split("\n").pop();
      if (isShell(found)) return found;
    } catch {}
  }
  const ver = (dir) => (dir.split("-").pop() || "").split(".").map((n) => parseInt(n, 10) || 0);
  const byNewest = (a, b) => {
    const x = ver(a),
      y = ver(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  };
  for (const base of [
    path.join(os.homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell"),
    path.join(os.homedir(), ".cache", "puppeteer", "chrome-headless-shell"),
  ]) {
    let versions = [];
    try {
      versions = fs.readdirSync(base).sort(byNewest);
    } catch {
      continue;
    }
    for (const v of versions) {
      try {
        for (const inner of fs.readdirSync(path.join(base, v))) {
          const bin = path.join(base, v, inner, exe);
          if (isShell(bin) && isExe(bin)) return bin;
        }
      } catch {}
    }
  }
  throw new Error(
    "No headless Chrome found. Run `npx hyperframes browser ensure`, or set HYPERFRAMES_BROWSER_PATH " +
      "to a chrome-headless-shell binary.",
  );
}
/** Close Chrome without leaving it running: ask politely for 5 s, then SIGKILL the process if it is still alive. */
async function closeBrowser(browser, ms = 5000) {
  if (!browser) return;
  const proc = browser.process && browser.process();
  let timer;
  const closed = await Promise.race([
    browser.close().then(
      () => true,
      () => false,
    ),
    new Promise((r) => {
      timer = setTimeout(() => r(false), ms);
    }),
  ]);
  clearTimeout(timer);
  if (!closed && proc && proc.exitCode === null && proc.signalCode === null) {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }
}
module.exports = { hfCli, hfBrowser, closeBrowser };
if (require.main === module) console.log(hfCli(process.argv[2]));
