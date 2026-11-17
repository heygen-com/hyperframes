// The media-use engine runs without the CLI's packages installed, so it keeps its own copy of
// core's terminalText: control characters print as visible \xNN escapes, tabs stay as they are.
const isControlCode = (code) => (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f);

export function terminalText(value) {
  let shown = "";
  for (const ch of String(value)) {
    const code = ch.charCodeAt(0);
    shown += isControlCode(code) ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
  }
  return shown;
}
