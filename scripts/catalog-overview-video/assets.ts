export const catalogOverviewAssets = [
  { section: "Code Animations", type: "block", item: "code-particle-assemble", mediaStart: 1.7 },
  { section: "Captions", type: "component", item: "caption-kinetic-slam", mediaStart: 1.2 },
  { section: "HTML-in-Canvas", type: "block", item: "vfx-shatter", mediaStart: 2.6 },
  {
    section: "Social Overlays",
    type: "block",
    item: "editorial-flash-overlay",
    mediaStart: 0.35,
  },
  { section: "Lower Thirds", type: "block", item: "lower-third-bild", mediaStart: 0.5 },
  {
    section: "Shader Transitions",
    type: "block",
    item: "domain-warp-dissolve",
    mediaStart: 1.25,
  },
  { section: "CSS Transitions", type: "block", item: "transitions-grid", mediaStart: 4.3 },
  { section: "Showcases", type: "block", item: "app-showcase", mediaStart: 0.7 },
  { section: "Data", type: "block", item: "us-map-flow", mediaStart: 4.0 },
  { section: "Effects", type: "component", item: "parallax-unzoom", mediaStart: 1.6 },
  { section: "Blocks", type: "block", item: "hw-pipeline", mediaStart: 1.4 },
].map((asset) => ({
  ...asset,
  url: `https://static.heygen.ai/hyperframes-oss/docs/images/catalog/${asset.type}s/${asset.item}.mp4`,
}));
