/**
 * Minimal cross-platform clipboard copy. Shells out to the OS tool; gracefully
 * no-ops when no tool is available (CI, headless SSH, etc.) so callers can
 * always invoke it without guarding.
 *
 * Returns true if the copy succeeded, false otherwise.
 */

import { spawnSync } from "node:child_process";
import { platform } from "node:os";

interface ClipboardProvider {
  cmd: string;
  args: string[];
}

function detectProvider(): ClipboardProvider | undefined {
  const os = platform();
  if (os === "darwin") {
    return { cmd: "pbcopy", args: [] };
  }
  if (os === "win32") {
    return { cmd: "clip.exe", args: [] };
  }
  // Linux / BSD — pick the first tool that's on PATH.
  // WSL exposes clip.exe too; prefer it so copies land in the Windows
  // clipboard where the user actually sees them.
  const candidates: ClipboardProvider[] = [
    { cmd: "clip.exe", args: [] },
    { cmd: "wl-copy", args: [] },
    { cmd: "xclip", args: ["-selection", "clipboard"] },
    { cmd: "xsel", args: ["--clipboard", "--input"] },
  ];
  const cmd = process.platform === "win32" ? "where" : "which";
  for (const p of candidates) {
    const result = spawnSync(cmd, [p.cmd], { stdio: "ignore" });
    if (result.status === 0) return p;
  }
  return undefined;
}

let cachedProvider: ClipboardProvider | undefined | null = null;

export function copyToClipboard(text: string): boolean {
  if (cachedProvider === null) cachedProvider = detectProvider();
  const provider = cachedProvider;
  if (!provider) return false;
  try {
    const res = spawnSync(provider.cmd, provider.args, {
      input: text,
      encoding: "utf-8",
    });
    return res.status === 0;
  } catch {
    return false;
  }
}
