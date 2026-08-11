export const catalogOverviewAssets = [
  { section: "Code Animations", item: "code-morph", mediaStart: 1.8 },
  { section: "Captions", item: "caption-kinetic-slam", mediaStart: 1.2 },
  { section: "HTML-in-Canvas", item: "vfx-shatter", mediaStart: 1.4 },
  { section: "Social Overlays", item: "x-post", mediaStart: 1.0 },
  { section: "Lower Thirds", item: "lt-mask-reveal", mediaStart: 0.8 },
  { section: "Shader Transitions", item: "gravitational-lens", mediaStart: 1.3 },
  { section: "CSS Transitions", item: "beat-freeze-cut", mediaStart: 1.2 },
  { section: "Showcases", item: "app-showcase", mediaStart: 1.6 },
  { section: "Data", item: "world-map", mediaStart: 1.4 },
  { section: "Effects", item: "parallax-zoom", mediaStart: 1.0 },
  { section: "Blocks", item: "flowchart", mediaStart: 1.2 },
].map((asset) => ({
  ...asset,
  url: `https://static.heygen.ai/hyperframes-oss/docs/images/catalog/${
    ["caption-kinetic-slam", "parallax-zoom"].includes(asset.item) ? "components" : "blocks"
  }/${asset.item}.mp4`,
}));
