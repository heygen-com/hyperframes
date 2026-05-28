/**
 * Strip ANSI SGR escape sequences for visible-length column alignment.
 *
 * Earlier impl used `/\[\d+m/g` which (a) missed the ESC prefix
 * (under-counting overhead by 1 per code) and (b) didn't match
 * `ESC[38;2;…m` 24-bit truecolor sequences used by `c.accent`. This
 * regex covers the full CSI SGR family.
 *
 * Constructed via `new RegExp("\\u001b...")` rather than a `/.../`
 * literal because oxlint's `no-control-regex` rule flags ESC (0x1B)
 * even in literal form, and the string-construction path keeps the
 * intent obvious without needing a per-file disable.
 */

// CSI SGR: ESC `[` { params with digits + semicolons } `m`.
// oxlint-disable-next-line no-control-regex
const ANSI_SGR_RE = new RegExp("\\u001b\\[[\\d;]*m", "g");

export function stripAnsi(s: string): string {
  return s.replace(ANSI_SGR_RE, "");
}

/** Length of `s` after ANSI SGR codes are stripped. */
export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

/** Like `String.prototype.padEnd` but counts visible chars only. */
export function padEndVisible(s: string, target: number): string {
  const overhead = s.length - visibleLength(s);
  return s.padEnd(target + overhead);
}
