import { ensureHfIds } from "@hyperframes/parsers/hf-ids";

export type SetField = "volume" | "rate" | "track";

export interface SetAssignment {
  field: SetField;
  value: string;
}

export function stampHfIds(source: string): string {
  return ensureHfIds(source);
}

export function parseSetAssignments(
  values: readonly string[],
): { ok: true; assignments: SetAssignment[] } | { ok: false; reason: string; fix: string } {
  const assignments: SetAssignment[] = [];
  for (const value of values) {
    const match = /^(volume|rate|track)=(.+)$/.exec(value);
    if (!match) {
      return {
        ok: false,
        reason: `unsupported set assignment ${value}`,
        fix: "use volume=<number>, rate=<number>, or track=<number>",
      };
    }
    const field = parseSetField(match[1]);
    const number = Number(match[2]);
    if (!Number.isFinite(number) || (field === "track" && !Number.isInteger(number))) {
      return {
        ok: false,
        reason: `${field} must be a valid ${field === "track" ? "integer" : "number"}`,
        fix: `pass ${field}=<number>`,
      };
    }
    if (field === "rate" && number <= 0) {
      return { ok: false, reason: "rate must be positive", fix: "pass rate=<positive number>" };
    }
    assignments.push({ field, value: String(number) });
  }
  return { ok: true, assignments };
}

function parseSetField(value: string): SetField {
  switch (value) {
    case "volume":
    case "rate":
    case "track":
      return value;
  }
  throw new Error(`unsupported set field ${value}`);
}
