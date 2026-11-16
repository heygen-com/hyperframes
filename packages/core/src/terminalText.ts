const isControlCode = (code: number) =>
  (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f);

export function terminalText(text: string): string {
  let shown = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    shown += isControlCode(code) ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
  }
  return shown;
}
