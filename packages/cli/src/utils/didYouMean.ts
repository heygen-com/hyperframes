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

const COMMAND_SYNONYMS: Record<string, string> = {
  search: "catalog",
  find: "catalog",
  browse: "catalog",
  registry: "catalog",
  list: "catalog",
  install: "add",
};

export function synonymMatch(input: string, candidates: Iterable<string>): string | undefined {
  const target = COMMAND_SYNONYMS[input];
  return target !== undefined && [...candidates].includes(target) ? target : undefined;
}
