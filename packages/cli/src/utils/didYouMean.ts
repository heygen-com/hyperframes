import { existsSync } from "node:fs";

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** The candidate `input` most likely misspells or abbreviates, or undefined when none is close. */
export function closestMatch(input: string, candidates: Iterable<string>): string | undefined {
  const names = [...candidates];
  const prefixed = input.length >= 2 ? names.find((name) => name.startsWith(input)) : undefined;
  if (prefixed) return prefixed;
  const limit = input.length <= 3 ? 1 : Math.max(2, Math.floor(input.length / 3));
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const name of names) {
    const distance = editDistance(input, name);
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}

export function closestNames(input: string, candidates: Iterable<string>, limit = 5): string[] {
  const words = new Set(input.split("-"));
  return [...candidates]
    .map((name) => ({
      name,
      shared: name.split("-").filter((word) => words.has(word)).length,
      distance: editDistance(input, name),
    }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared || a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name }) => name);
}

const COMMAND_REDIRECTS: Record<string, { command: string; then?: string }> = {
  search: { command: "catalog" },
  find: { command: "catalog" },
  browse: { command: "catalog" },
  registry: { command: "catalog" },
  list: { command: "catalog" },
  install: { command: "add" },
  captions: {
    command: "transcribe",
    then: "then read ../hyperframes/references/captions.md",
  },
};

export function commandRedirect(
  input: string,
  candidates: Iterable<string>,
): { command: string; then?: string } | undefined {
  const row = COMMAND_REDIRECTS[input];
  return row !== undefined && [...candidates].includes(row.command) ? row : undefined;
}

export const redirectLine = (word: string): string => {
  const row = COMMAND_REDIRECTS[word]!;
  return `\`${word}\` is not a command: run \`${row.command}\`${row.then ? `, ${row.then}` : ""}.`;
};
export const REDIRECTS_WITH_NEXT_STEP = Object.keys(COMMAND_REDIRECTS).filter(
  (word) => COMMAND_REDIRECTS[word]!.then,
);

export function fileHint(word: string, path: string[], names: string[]): string | undefined {
  if (path.length === 0 || names.length === 0) return undefined;
  const kind = existsSync(word) ? "is" : /[\\/]|\.\w{2,4}$/.test(word) ? "looks like" : undefined;
  if (!kind) return undefined;
  const group = ["hyperframes", ...path].join(" ");
  return `'${word}' ${kind} a file; name a command first: '${group} <${names.join("|")}> ${word}'.`;
}
