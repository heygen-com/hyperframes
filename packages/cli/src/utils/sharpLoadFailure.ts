import { normalizeErrorMessage } from "./errorMessage.js";

const SHARP_LOAD_FAILURE = /^Could not load the "sharp" module/;
// Win32 error 4551, raised for Smart App Control and App Control for Business policies alike.
const APPLICATION_CONTROL_BLOCK = /An Application Control policy has blocked this file/i;

/** Why sharp's native library failed to load, in one line, or null for any other error. */
export function describeSharpLoadFailure(error: unknown): string | null {
  const message = normalizeErrorMessage(error);
  if (!SHARP_LOAD_FAILURE.test(message)) return null;
  if (APPLICATION_CONTROL_BLOCK.test(message)) {
    return "Windows App Control (Smart App Control or an App Control policy) blocked sharp's unsigned native library. Smart App Control cannot allow a single file.";
  }
  const [header = message, cause = ""] = message.split(/\r?\n/);
  const reason = cause.trim();
  return reason && !reason.startsWith("Possible solutions") ? `${header} (${reason})` : header;
}
