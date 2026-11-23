/**
 * Minimal cross-platform clipboard copy. Shells out to the OS tool; gracefully
 * no-ops when no tool is available (CI, headless SSH, etc.) so callers can
 * always invoke it without guarding.
 *
 * Returns true if the copy succeeded, false otherwise.
 */

import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { findTrustedExecutable } from "@hyperframes/parsers/ff-binaries";

const COPY_TIMEOUT_MS = 5000;

interface ClipboardProvider {
  cmd: string;
  args: string[];
}

function candidateProviders(): ClipboardProvider[] {
  const os = platform();
  if (os === "darwin") return [{ cmd: "pbcopy", args: [] }];
  if (os === "win32") return [{ cmd: "clip", args: [] }];
  // Linux / BSD — pick the first tool installed.
  // WSL exposes clip.exe too; prefer it so copies land in the Windows
  // clipboard where the user actually sees them.
  return [
    { cmd: "clip.exe", args: [] },
    { cmd: "wl-copy", args: [] },
    { cmd: "xclip", args: ["-selection", "clipboard"] },
    { cmd: "xsel", args: ["--clipboard", "--input"] },
  ];
}

function detectProvider(): ClipboardProvider | undefined {
  for (const provider of candidateProviders()) {
    const cmd = findTrustedExecutable(provider.cmd);
    if (cmd) return { cmd, args: provider.args };
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
      stdio: ["pipe", "ignore", "ignore"],
      timeout: COPY_TIMEOUT_MS,
      windowsHide: true,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}
