// Ported from a reference implementation of this catalog UX, unchanged.
// Conservative gallery budget: GPU/shader scenes never execute on hover.
// Detail pages still expose their full live compositions.
// vendored, unchanged — not this repo's complexity to simplify
// fallow-ignore-next-line complexity
export function galleryPreview(item, detail) {
  const heavy =
    item.group === "3d-motion" ||
    detail.webgpu ||
    (detail.tech || []).some((tech) =>
      /webgl|webgpu|three\.js|shader|post-processing|gltf|html-in-canvas/i.test(tech),
    );
  if (heavy || detail.previewMode === "recorded") {
    return { mode: item.video ? "video" : "still" };
  }
  if (detail.previewMode !== "live" || !detail.base || !detail.entry) return { mode: "still" };
  return {
    mode: "live",
    source: detail.base + detail.entry,
    base: detail.base,
    width: detail.previewWidth || detail.width || 1920,
    height: detail.previewHeight || detail.height || 1080,
  };
}
