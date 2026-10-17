import {
  ELEMENT_CLIPBOARD_PREFIX,
  parseElementClipboard,
  type ElementClipboard,
} from "@hyperframes/core/element-clipboard";
import type { UseClipboardOptions, pasteTimelineClips } from "./useClipboard";
import { usePlayerStore } from "../player";
import { prepareElementClipboard } from "../utils/elementClipboardPaste";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { extendRootDurationInSource } from "../utils/rootDuration";
import { readFileContent } from "./timelineEditingHelpers";
import { buildTimelineElementKey } from "../player/lib/timelineElementHelpers";
import type { ClipboardPayload } from "../utils/clipboardPayload";

export async function readSystemClipboardText(): Promise<string | null> {
  try {
    return (await navigator.clipboard?.readText()) ?? null;
  } catch {
    return null;
  }
}

type PasteOptions = Pick<
  UseClipboardOptions,
  | "activeCompPath"
  | "writeProjectFile"
  | "recordEdit"
  | "reloadPreview"
  | "showToast"
  | "readOnlyPreview"
  | "waitForPendingDomEditSaves"
> & {
  projectId: string | null;
  ignoredText: Promise<string | null>;
  isCurrentProject: () => boolean;
};

export async function readPastePayload(
  options: PasteOptions,
  pendingPayload: Promise<ClipboardPayload | null> | null,
  insert: typeof pasteTimelineClips,
): Promise<ClipboardPayload | null> {
  if (await pasteSystemElement(options, insert)) return null;
  if (!options.isCurrentProject()) return null;
  const payload = await pendingPayload;
  if (!options.isCurrentProject()) return null;
  if (!payload) options.showToast("Nothing to paste.", "info");
  return payload;
}

function elementIdsInSource(source: string): Set<string> {
  const roots: (Document | DocumentFragment)[] = [
    new DOMParser().parseFromString(source, "text/html"),
  ];
  const ids = new Set<string>();
  for (const root of roots) {
    for (const element of root.querySelectorAll("[id],template")) {
      if (element.id) ids.add(element.id);
      if (element instanceof HTMLTemplateElement) roots.push(element.content);
    }
  }
  return ids;
}

/** Returns false only when the OS clipboard belongs to the existing internal paste path. */
async function pasteSystemElement(
  options: PasteOptions,
  insert: typeof pasteTimelineClips,
): Promise<boolean> {
  const projectId = options.projectId;
  if (!projectId) return false;
  const text = await readSystemClipboardText();
  if (
    text === null ||
    text === (await options.ignoredText) ||
    !text.startsWith(ELEMENT_CLIPBOARD_PREFIX)
  )
    return false;
  if (!options.isCurrentProject()) return true;
  const payload = parseElementClipboard(text);
  if (!payload) {
    options.showToast(
      "This element clipboard is malformed or exceeds the supported limits.",
      "error",
    );
    return true;
  }
  if (options.readOnlyPreview) {
    options.showToast("Preview is read-only.", "info");
    return true;
  }
  await saveSystemElement(options, projectId, payload, insert);
  return true;
}

async function saveSystemElement(
  options: PasteOptions,
  projectId: string,
  payload: ElementClipboard,
  insert: typeof pasteTimelineClips,
): Promise<void> {
  const path = options.activeCompPath || "index.html";
  try {
    await options.waitForPendingDomEditSaves();
    if (!options.isCurrentProject()) return;
    let ids: string[] = [];
    let warnings: string[] = [];
    await saveProjectFilesWithHistory({
      projectId,
      label: "Paste element",
      files: {
        [path]: (source) => {
          if (!options.isCurrentProject())
            throw new Error("Project changed before paste completed.");
          const taken = elementIdsInSource(source);
          let index = 1;
          while (
            [...taken].some((id) => id === `element-${index}` || id.startsWith(`element-${index}-`))
          )
            index++;
          // Composition files share one document after compilation.
          const scope = `element-${index}-${crypto.randomUUID()}`;
          const prepared = prepareElementClipboard(payload, scope);
          const template = document.createElement("template");
          template.innerHTML = prepared.html;
          const root = template.content.firstElementChild;
          if (!root) throw new Error("Element has no supported content");
          root.classList.add("clip");
          root.setAttribute("data-start", "0");
          root.setAttribute("data-duration", "5");
          root.setAttribute("data-track-index", "0");
          const { currentTime, elements } = usePlayerStore.getState();
          const pasted = insert(
            source,
            [{ html: root.outerHTML, start: 0, duration: 5, track: 0 }],
            currentTime,
            elements,
          );
          ids = pasted.ids;
          warnings = prepared.warnings;
          return extendRootDurationInSource(pasted.content, pasted.requiredEnd);
        },
      },
      readFile: (file) => readFileContent(projectId, file),
      writeFile: options.writeProjectFile,
      recordEdit: options.recordEdit,
    });
    if (!options.isCurrentProject()) return;
    if (ids.length)
      usePlayerStore
        .getState()
        .setSelection(
          ids.map((id) =>
            buildTimelineElementKey({ id, domId: id, sourceFile: path, fallbackIndex: 0 }),
          ),
        );
    options.reloadPreview();
    options.showToast(
      warnings.length ? `Pasted element. ${warnings[0]}` : "Pasted element",
      "info",
    );
  } catch (error) {
    options.showToast(error instanceof Error ? error.message : "Failed to paste element", "error");
  }
}
