import postcss from "postcss";
import { styleRoot } from "../styleRoots";
import type { LintContext, HyperframeLintFinding } from "../context";
import { readAttr, readJsonAttr, truncateSnippet } from "../utils";

// A 3D-transformed layer is rasterized close to whole, not clipped to the stage. Measured in a 1920x1080 preview: an
// 11000x5200 rotateX floor took layer area from 32 to 87 Mpx and the host app's own panels went blank.
const MAX_STAGE_MULTIPLE = 4;
// translate3d is left out: flat 3D translates are the usual promote-to-layer hack and keep 2D clipping.
const THREE_D_TRANSFORM =
  /\b(?:rotate[XY]|rotate3d|translateZ|scaleZ|scale3d|matrix3d|perspective)\s*\(/i;

type Box = { width?: number; height?: number; transform?: string };
type Stage = { width: number; height: number };

function pixels(value: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)px\s*$/i.exec(value);
  return match ? Number(match[1]) : undefined;
}

function boxOf(container: postcss.Container): Box {
  const box: Box = {};
  container.each((node) => {
    if (node.type !== "decl") return;
    const prop = node.prop.toLowerCase();
    if (prop === "width") box.width = pixels(node.value);
    else if (prop === "height") box.height = pixels(node.value);
    else if (prop === "transform") box.transform = node.value;
  });
  return box;
}

function oversizedArea(box: Box, stage: Stage): boolean {
  if (!box.width || !box.height || !box.transform || !THREE_D_TRANSFORM.test(box.transform))
    return false;
  return box.width * box.height > stage.width * stage.height * MAX_STAGE_MULTIPLE;
}

function finding(
  box: Box,
  stage: Stage,
  where: Partial<HyperframeLintFinding>,
): HyperframeLintFinding {
  const ratio = Math.round(((box.width ?? 0) * (box.height ?? 0)) / (stage.width * stage.height));
  return {
    code: "three_d_layer_far_larger_than_stage",
    severity: "warning",
    message:
      `A ${box.width}x${box.height}px element with a 3D transform is ${ratio}x the ${stage.width}x${stage.height} stage. ` +
      `A 3D-transformed layer is drawn nearly whole, not just the part on stage, so it holds GPU memory for pixels ` +
      `nobody sees. In an editor's preview that can blank the editor's own panels.`,
    fixHint: `Size it to what the camera can see (at most ${MAX_STAGE_MULTIPLE}x the stage), or use a repeating background on a stage-sized element.`,
    ...where,
  };
}

function stageOf(rootTag: LintContext["rootTag"]): Stage | undefined {
  const width = Number.parseInt(readAttr(rootTag?.raw ?? "", "data-width") ?? "", 10);
  const height = Number.parseInt(readAttr(rootTag?.raw ?? "", "data-height") ?? "", 10);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function parsed(read: () => postcss.Root): postcss.Root | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function styleBlockFindings(styles: LintContext["styles"], stage: Stage): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  for (const style of styles) {
    parsed(() => styleRoot(style))?.walkRules((rule) => {
      const box = boxOf(rule);
      if (oversizedArea(box, stage))
        findings.push(finding(box, stage, { selector: rule.selector }));
    });
  }
  return findings;
}

function inlineStyleFindings(tags: LintContext["tags"], stage: Stage): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  for (const tag of tags) {
    const inline = readJsonAttr(tag.raw, "style");
    if (!inline || !THREE_D_TRANSFORM.test(inline)) continue;
    const root = parsed(() => postcss.parse(inline));
    const box = root ? boxOf(root) : {};
    if (!oversizedArea(box, stage)) continue;
    const where = {
      elementId: readAttr(tag.raw, "id") || undefined,
      snippet: truncateSnippet(tag.raw),
    };
    findings.push(finding(box, stage, where));
  }
  return findings;
}

export const layerRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  ({ rootTag, tags, styles }) => {
    const stage = stageOf(rootTag);
    if (!stage) return [];
    return [...styleBlockFindings(styles, stage), ...inlineStyleFindings(tags, stage)];
  },
];
