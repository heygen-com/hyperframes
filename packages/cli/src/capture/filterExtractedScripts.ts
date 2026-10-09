import { parseHTML } from "linkedom";

const FRAMEWORK_SRC_PATTERNS = [
  /_next\/static\/chunks\/(main|framework|webpack|pages\/)/,
  /_next\/static\/chunks\/app\//,
  /_buildManifest\.js/,
  /_ssgManifest\.js/,
];

const NEXT_BOOTSTRAP_MARKERS = [
  "__next_f",
  "self.__next_f",
  "__NEXT_LOADED_PAGES__",
  "_N_E",
  "__NEXT_P",
];

function removeMatchingScripts(source: string, shouldRemove: (script: Element) => boolean): string {
  const rootId = "__hf_root";
  const { document } = parseHTML(`<div id="${rootId}">${source}</div>`);
  for (const script of document.querySelectorAll("script")) {
    if (script.id === "__NEXT_DATA__" || shouldRemove(script)) script.remove();
  }
  return document.getElementById(rootId)?.innerHTML ?? "";
}

export function filterExtractedScripts(
  bodyHtml: string,
  headHtml: string,
): { bodyHtml: string; headHtml: string } {
  const body = removeMatchingScripts(bodyHtml, (script) =>
    NEXT_BOOTSTRAP_MARKERS.some((marker) => script.textContent?.includes(marker)),
  );
  const head = removeMatchingScripts(headHtml, (script) => {
    const src = script.getAttribute("src") ?? "";
    return FRAMEWORK_SRC_PATTERNS.some((pattern) => pattern.test(src));
  });
  return { bodyHtml: body, headHtml: head };
}
