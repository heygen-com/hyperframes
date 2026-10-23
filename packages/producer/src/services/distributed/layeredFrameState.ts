export type LayeredFallbackReason =
  | "observation_error"
  | "unsupported_sampling"
  | "scene_complexity"
  | "no_video"
  | "nested_video"
  | "unsupported_stacking"
  | "unsupported_effect"
  | "unsupported_geometry"
  | "video_decoration"
  | "missing_video_frame"
  | "changing_video_layout"
  | "incomplete_frames";

export type LayeredFrame =
  | { kind: "candidate"; signature: string; videoCount: number }
  | { kind: "fallback"; reason: LayeredFallbackReason };

export const LAYERED_NODE_LIMIT = 512;

export interface LayeredNodeState {
  tag: string;
  rect: [number, number, number, number];
  position: string;
  zIndex: string;
  display: string;
  visibility: string;
  opacity: string;
  transforms: string[];
  matrix: { is2D: boolean; a: number; b: number; c: number; d: number };
  filter: string;
  clipPath: string;
  maskImage: string;
  mixBlendMode: string;
  backdropFilter: string;
  perspective: string;
  transformStyle: string;
  radii: string[];
  pseudoContents: string[];
  objectFit: string;
  objectPosition: string;
  boxShadow: string;
  backgroundImage: string;
  backgroundColor: string;
  outlineStyle: string;
  spacing: string[];
  overflow: string[];
  shadowRoot: boolean;
  topLayer: boolean;
}

export type LayeredFrameState =
  | { kind: "scene_limit" }
  | {
      kind: "observed";
      root: LayeredNodeState | null;
      rootText: boolean;
      ancestors: { node: LayeredNodeState; extraPaint: boolean }[];
      nodes: LayeredNodeState[];
      children: { node: LayeredNodeState; proxy: boolean }[];
      videos: { id: string; direct: boolean; ready: boolean; proxy: LayeredNodeState | null }[];
    };

function hasEffect(node: LayeredNodeState): boolean {
  return (
    node.mixBlendMode !== "normal" ||
    node.backdropFilter !== "none" ||
    node.perspective !== "none" ||
    node.transformStyle !== "flat"
  );
}

function hasPseudo(node: LayeredNodeState): boolean {
  return node.pseudoContents.some((content) => content !== "none" && content !== "normal");
}

function hasUnsupportedClipBox(node: LayeredNodeState): boolean {
  if (node.overflow.some((value) => !["visible", "hidden", "clip"].includes(value))) return true;
  return (
    node.overflow.some((value) => value !== "visible") &&
    node.spacing.some((value) => value !== "0px")
  );
}

function hasNonRectangularClip(node: LayeredNodeState): boolean {
  return (
    node.clipPath !== "none" ||
    node.maskImage !== "none" ||
    node.radii.some((radius) => radius !== "0px")
  );
}

function hasUnsupportedContainer(node: LayeredNodeState): boolean {
  return (
    node.opacity !== "1" ||
    node.transforms.some((value) => value !== "none") ||
    node.filter !== "none" ||
    hasEffect(node) ||
    hasPseudo(node) ||
    hasNonRectangularClip(node) ||
    hasUnsupportedClipBox(node)
  );
}

function hasUnmodeledPaint(node: LayeredNodeState): boolean {
  return (
    ["CANVAS", "IFRAME", "SVG", "DIALOG"].includes(node.tag) ||
    node.tag.includes("-") ||
    node.topLayer ||
    node.shadowRoot ||
    hasEffect(node)
  );
}

function isTranslation(matrix: LayeredNodeState["matrix"]): boolean {
  return matrix.is2D && matrix.a === 1 && matrix.d === 1 && matrix.b === 0 && matrix.c === 0;
}

function hasVideoBox(node: LayeredNodeState): boolean {
  return (
    node.display !== "none" &&
    node.visibility === "visible" &&
    node.rect.every(Number.isFinite) &&
    node.rect[2] > 0 &&
    node.rect[3] > 0
  );
}

function hasUnsupportedVideoStyle(node: LayeredNodeState): boolean {
  return (
    node.objectFit !== "fill" ||
    node.objectPosition !== "50% 50%" ||
    node.clipPath !== "none" ||
    node.filter !== "none" ||
    node.maskImage !== "none" ||
    node.radii.some((radius) => !/^\d+(\.\d+)?px$/.test(radius))
  );
}

function hasVideoDecoration(node: LayeredNodeState): boolean {
  return (
    hasPseudo(node) ||
    node.boxShadow !== "none" ||
    node.backgroundImage !== "none" ||
    node.backgroundColor !== "rgba(0, 0, 0, 0)" ||
    node.outlineStyle !== "none" ||
    node.spacing.some((value) => value !== "0px")
  );
}

function videoRefusal(node: LayeredNodeState): LayeredFallbackReason | null {
  if (
    !isTranslation(node.matrix) ||
    node.transforms.slice(1).some((value) => value !== "none") ||
    !hasVideoBox(node) ||
    hasUnsupportedVideoStyle(node)
  )
    return "unsupported_geometry";
  if (hasVideoDecoration(node)) return "video_decoration";
  return null;
}

function hasUnsupportedStacking(node: LayeredNodeState): boolean {
  return (
    !["absolute", "relative"].includes(node.position) ||
    node.zIndex === "auto" ||
    !Number.isSafeInteger(Number(node.zIndex)) ||
    Number(node.zIndex) < 0
  );
}

type ObservedFrame = Extract<LayeredFrameState, { kind: "observed" }>;

function containerRefusal(
  state: ObservedFrame,
  root: LayeredNodeState,
): LayeredFallbackReason | null {
  if (state.ancestors.some(({ node, extraPaint }) => extraPaint || hasUnsupportedContainer(node)))
    return "unsupported_stacking";
  if (
    state.rootText ||
    !["relative", "absolute"].includes(root.position) ||
    hasUnsupportedContainer(root)
  )
    return "unsupported_stacking";
  if (state.nodes.some(hasUnmodeledPaint)) return "unsupported_effect";
  return null;
}

type VideoLayout = [string, LayeredNodeState["rect"], string, string[]];
type VideoInputs = Extract<LayeredFrameState, { kind: "observed" }>["videos"];

function classifyVideos(
  videos: VideoInputs,
): { kind: "videos"; layouts: VideoLayout[] } | Extract<LayeredFrame, { kind: "fallback" }> {
  if (new Set(videos.map((video) => video.id)).size !== videos.length) {
    return { kind: "fallback", reason: "missing_video_frame" };
  }
  const videoLayouts: VideoLayout[] = [];
  for (const video of videos) {
    const node = video.proxy;
    if (!video.id || !node || !video.ready)
      return { kind: "fallback", reason: "missing_video_frame" };
    const reason = videoRefusal(node);
    if (reason) return { kind: "fallback", reason };
    videoLayouts.push([video.id, node.rect, node.opacity, node.radii]);
  }
  return { kind: "videos", layouts: videoLayouts };
}

export function classifyLayeredFrame(state: LayeredFrameState): LayeredFrame {
  if (state.kind === "scene_limit") return { kind: "fallback", reason: "scene_complexity" };
  if (state.videos.length === 0) return { kind: "fallback", reason: "no_video" };
  if (!state.root || state.videos.some((video) => !video.direct))
    return { kind: "fallback", reason: "nested_video" };
  const refusal = containerRefusal(state, state.root);
  if (refusal) return { kind: "fallback", reason: refusal };
  const videos = classifyVideos(state.videos);
  if (videos.kind === "fallback") return videos;
  const layers = [];
  for (const { node, proxy } of state.children) {
    if (["VIDEO", "SCRIPT", "STYLE", "LINK"].includes(node.tag) || node.display === "none")
      continue;
    if (hasUnsupportedStacking(node)) return { kind: "fallback", reason: "unsupported_stacking" };
    layers.push([proxy ? "video" : "dom", Number(node.zIndex)]);
  }
  return {
    kind: "candidate",
    videoCount: state.videos.length,
    signature: JSON.stringify({
      videoLayouts: videos.layouts,
      layers,
      clip: [state.root, ...state.ancestors.map(({ node }) => node)].map((node) => [
        node.rect,
        node.overflow,
      ]),
    }),
  };
}
