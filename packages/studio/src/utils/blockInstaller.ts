import type { RegistryItem } from "@hyperframes/core/registry";
import type { TimelineElement } from "../player";
import {
  insertTimelineAssetIntoSource,
  resolveTimelineAssetInitialGeometry,
} from "./timelineAssetDrop";
import { collectHtmlIds } from "./studioHelpers";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import { saveProjectFilesWithHistory } from "./studioFileHistory";
import type { EditHistoryKind } from "./editHistory";

function getMaxZIndexFromIframe(iframe: HTMLIFrameElement | null): number {
  try {
    const doc = iframe?.contentDocument;
    if (!doc) return 0;
    let max = 0;
    for (const el of doc.body.querySelectorAll("*")) {
      const z = parseInt(getComputedStyle(el).zIndex, 10);
      if (Number.isFinite(z) && z > max) max = z;
    }
    return max;
  } catch {
    return 0;
  }
}

interface AddBlockOptions {
  projectId: string;
  blockName: string;
  activeCompPath: string | null;
  placement?: { start: number; track: number };
  visualPosition?: { left: number; top: number };
  previewIframe?: HTMLIFrameElement | null;
  currentTime?: number;
  timelineElements: TimelineElement[];
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (entry: {
    label: string;
    kind: EditHistoryKind;
    coalesceKey?: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  refreshFileTree: () => Promise<void>;
  reloadPreview: () => void;
  showToast: (msg: string) => void;
}

function buildUniqueCompositionId(baseName: string, existingIds: Iterable<string>): string {
  const idSet = new Set(existingIds);
  if (!idSet.has(baseName)) return baseName;
  let i = 2;
  while (idSet.has(`${baseName}_${i}`)) i++;
  return `${baseName}_${i}`;
}

export async function addBlockToProject(
  opts: AddBlockOptions,
): Promise<{ block: RegistryItem; compositionPath: string } | null> {
  const {
    projectId,
    blockName,
    activeCompPath,
    placement,
    visualPosition,
    timelineElements,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    refreshFileTree,
    reloadPreview,
    showToast,
  } = opts;

  try {
    const res = await fetch(`/api/projects/${projectId}/registry/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockName }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Install failed" }));
      showToast((err as { error?: string }).error || "Failed to install block");
      return null;
    }

    const { written, block } = (await res.json()) as {
      written: string[];
      block: RegistryItem;
    };

    const compositionFile = written.find((f) => f.endsWith(".html")) ?? written[0];
    if (!compositionFile) {
      showToast("Installed but no composition file was written");
      return null;
    }

    if (block.type === "hyperframes:component") {
      const compContent = await readProjectFile(compositionFile);
      const transparentContent = compContent.replace(
        /background:\s*(?:#(?:0a0a0a|000000|000|0a0805)|rgba?\([^)]*\))\s*;/g,
        "background: transparent;",
      );
      if (transparentContent !== compContent) {
        await writeProjectFile(compositionFile, transparentContent);
      }
    }

    {
      const targetPath = activeCompPath || "index.html";
      const originalContent = await readProjectFile(targetPath);
      const existingIds = collectHtmlIds(originalContent);
      const compId = buildUniqueCompositionId(block.name, existingIds);

      const resolvedTargetPath = targetPath || "index.html";
      const relevantElements = timelineElements.filter(
        (te) => (te.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
      );

      const isBlock = block.type === "hyperframes:block";
      const hostDims = resolveTimelineAssetInitialGeometry(originalContent);

      const currentTime = opts.currentTime ?? 0;
      const start = placement
        ? Number(formatTimelineAttributeNumber(placement.start))
        : Number(formatTimelineAttributeNumber(currentTime));
      const blockDuration =
        "duration" in block ? (block as { duration: number }).duration : undefined;
      const duration =
        blockDuration ??
        relevantElements.reduce(
          (max, te) => Math.max(max, (te.start ?? 0) + (te.duration ?? 0)),
          10,
        );
      const track =
        placement?.track ??
        (isBlock
          ? 0
          : relevantElements.length > 0
            ? Math.max(...relevantElements.map((te) => te.track)) + 1
            : 1);

      const zIndex = getMaxZIndexFromIframe(opts.previewIframe ?? null) + 1;

      const width = hostDims.width;
      const height = hostDims.height;

      const left = visualPosition ? Math.round(visualPosition.left) : 0;
      const top = visualPosition ? Math.round(visualPosition.top) : 0;

      const subCompHtml = [
        `<div`,
        `  data-composition-id="${compId}"`,
        `  data-composition-src="${compositionFile}"`,
        `  data-start="${formatTimelineAttributeNumber(start)}"`,
        `  data-duration="${formatTimelineAttributeNumber(duration)}"`,
        `  data-track-index="${track}"`,
        `  data-width="${width}"`,
        `  data-height="${height}"`,
        `  style="position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; z-index: ${zIndex}"`,
        `></div>`,
      ].join("\n");

      let patchedContent = insertTimelineAssetIntoSource(originalContent, subCompHtml);

      const newEnd = start + duration;
      const rootDurMatch = patchedContent.match(
        /(<[^>]*data-composition-id="[^"]*"[^>]*data-duration=")([^"]*)(")/,
      );
      if (rootDurMatch) {
        const rootDur = parseFloat(rootDurMatch[2]!);
        if (newEnd > rootDur) {
          patchedContent = patchedContent.replace(
            rootDurMatch[0],
            `${rootDurMatch[1]}${formatTimelineAttributeNumber(newEnd)}${rootDurMatch[3]}`,
          );
        }
      }

      await saveProjectFilesWithHistory({
        projectId,
        label: `Add ${isBlock ? "block" : "component"}: ${block.title}`,
        kind: "timeline",
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit,
      });
    }

    await refreshFileTree();
    reloadPreview();

    return { block, compositionPath: compositionFile };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add block";
    showToast(message);
    return null;
  }
}
