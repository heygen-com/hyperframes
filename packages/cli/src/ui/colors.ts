import pc from "picocolors";

const isColorSupported =
  process.stdout.isTTY === true && !process.env["NO_COLOR"] && process.env["FORCE_COLOR"] !== "0";

function wrap(fn: (s: string) => string): (s: string) => string {
  return isColorSupported ? fn : (s: string) => s;
}

// Brand teal (#3CE6AC) via ANSI 24-bit true color
const teal = (s: string) => `\x1b[38;2;60;230;172m${s}\x1b[39m`;

export const c = {
  success: wrap(pc.green),
  error: wrap(pc.red),
  warn: wrap(pc.yellow),
  dim: wrap(pc.dim),
  bold: wrap(pc.bold),
  accent: wrap(teal),
  progress: wrap(pc.magenta),
  reset: isColorSupported ? pc.reset : (s: string) => s,
};

export { isColorSupported };
