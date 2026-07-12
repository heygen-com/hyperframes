export function normalizeWords(input) {
  const raw = Array.isArray(input) ? input : Array.isArray(input?.words) ? input.words : [];
  return raw
    .map((w, index) => {
      const text = String(w?.text ?? w?.word ?? "").trim();
      const start = Number(w?.start);
      const end = Number(w?.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return null;
      return { id: w?.id ?? `w${index}`, text, start, end };
    })
    .filter(Boolean);
}

export function wordListsFromMediaMeta(input) {
  if (Array.isArray(input) || Array.isArray(input?.words)) return [normalizeWords(input)];
  if (!Array.isArray(input?.voices)) return [];
  return input.voices.map((voice) => normalizeWords(voice)).filter((words) => words.length > 0);
}
