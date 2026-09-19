const MAX_TAIL_CHARS = 2000;
const MAX_LINE_CHARS = 160;
const STACK_FRAME = /^at\s/;
const ERROR_LINE = /error|fail|exception|cannot|not found|denied|killed|no space/i;

interface StderrTail {
  push(chunk: string): void;
  tail(): string;
}

export function createStderrTail(): StderrTail {
  let buffer = "";
  return {
    push(chunk) {
      buffer = (buffer + chunk).slice(-MAX_TAIL_CHARS);
    },
    tail: () => buffer.trim(),
  };
}

// Last error-looking stderr line, else the last non-empty line.
function lastErrorLine(tail: string): string {
  const lines = tail
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line && !STACK_FRAME.test(line));
  const line = [...lines].reverse().find((l) => ERROR_LINE.test(l)) ?? lines.at(-1) ?? "";
  return line.slice(0, MAX_LINE_CHARS);
}

export class DockerRenderExitError extends Error {
  constructor(exitCode: number | null, stderrTail: string) {
    const last = lastErrorLine(stderrTail);
    super(`Docker render exited with code ${exitCode}${last ? `: ${last}` : ""}`);
    this.name = "DockerRenderExitError";
  }
}
