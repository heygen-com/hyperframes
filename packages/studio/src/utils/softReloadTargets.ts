// What a GSAP soft reload needs from the saved files; the reset itself lives in core.
import { parseGsapScript } from "@hyperframes/parsers/gsap-parser";
import { tweenedProps, type StandaloneSet } from "@hyperframes/core/runtime/soft-reload";
import { parseSavedSource } from "./authoredSource";

/** What each standalone `gsap.set` in the outgoing scripts wrote, which no timeline child records. */
export function standaloneSets(outgoingScripts: readonly string[]): StandaloneSet[] {
  return outgoingScripts.flatMap((script) =>
    script.includes("gsap.set(")
      ? parseGsapScript(script)
          .animations.filter((set) => set.method === "set" && set.global)
          .map((set) => ({ selector: set.targetSelector, props: tweenedProps(set.properties) }))
      : [],
  );
}

// Each file a reset element may be written in, parsed at most once per reload: the reloaded
// composition's own file is the one just written, any other comes from the caller.
export function fileDocs(
  ownFile: string | null,
  written: string | undefined,
  nestedFiles: Map<string, string> | null | undefined,
): (file: string | null) => Document | null {
  const docs = new Map<string | null, Document | null>();
  return (file) => {
    if (!docs.has(file)) {
      const text = file === ownFile ? written : nestedFiles?.get(file ?? "");
      try {
        docs.set(file, text ? parseSavedSource(text) : null);
      } catch {
        docs.set(file, null);
      }
    }
    return docs.get(file) ?? null;
  };
}
