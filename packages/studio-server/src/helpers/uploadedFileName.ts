const WINDOWS_DEVICE_NAME =
  /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³]) *(\..*)?$/i;
const ENDS_IN_DOT_OR_SPACE = /[. ]$/;

export function uploadedFileName(sentName: string): string | null {
  const lastComponent = sentName.split("/").pop()?.split("\\").pop() ?? "";
  const climbsOut = lastComponent === "." || lastComponent === "..";
  if (!lastComponent || lastComponent.includes("\0") || climbsOut) return null;
  return lastComponent;
}

export function savesUnderItsOwnName(
  name: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (ENDS_IN_DOT_OR_SPACE.test(name) || WINDOWS_DEVICE_NAME.test(name)) return false;
  return platform !== "win32" || !name.includes(":");
}
