const PLAIN = /^[\p{L}\p{M}\p{N}_./@:+,=-]+$/u;
const PLAIN_WINDOWS_WORD_WITHOUT_BACKSLASH_COMMA_OR_SPLAT = /^(?!@)[\p{L}\p{M}\p{N}_./@:+=-]+$/u;
const SPECIAL_IN_DOUBLE_QUOTES = /["$`\\!]/;
const SPECIAL_IN_POWERSHELL_OR_BASH_DOUBLE_QUOTES = /["$`!\u201C-\u201E\p{Cc}]/u;
const CMD_VARIABLE = /%[^%]+%/;
const TRAILING_BACKSLASHES = /\\+$/;

/** `text` as one word of a pasteable command; on Windows literal in PowerShell, cmd.exe and Git Bash alike, or null. */
export function shellArg(
  text: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform === "win32") return windowsShellArg(text);
  if (PLAIN.test(text)) return text;
  if (!SPECIAL_IN_DOUBLE_QUOTES.test(text)) return `"${text}"`;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function windowsShellArg(text: string): string | null {
  if (PLAIN_WINDOWS_WORD_WITHOUT_BACKSLASH_COMMA_OR_SPLAT.test(text)) return text;
  if (SPECIAL_IN_POWERSHELL_OR_BASH_DOUBLE_QUOTES.test(text) || CMD_VARIABLE.test(text))
    return null;
  return `"${text.replace(TRAILING_BACKSLASHES, "$&$&")}"`;
}
