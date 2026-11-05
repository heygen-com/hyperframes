export function windowsLocalAppData(): string | undefined {
  return process.platform === "win32"
    ? process.env["LOCALAPPDATA"]?.trim() || undefined
    : undefined;
}
