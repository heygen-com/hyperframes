type CatalogOverviewAsset = {
  section: string;
  type: "block" | "component";
  item: string;
  mediaStart: number;
  localFile?: string;
  url: string;
};

type CatalogOverviewAssetSeed = Omit<CatalogOverviewAsset, "url">;

const catalogOverviewAssetSeeds: CatalogOverviewAssetSeed[] = [
  { section: "Code Animations", type: "block", item: "code-particle-assemble", mediaStart: 1.7 },
  {
    section: "Captions",
    type: "component",
    item: "caption-camera-follow",
    mediaStart: 0.5,
    localFile: "docs/images/catalog/components/caption-camera-follow.mp4",
  },
  {
    section: "HTML-in-Canvas",
    type: "block",
    item: "vfx-iphone-device",
    mediaStart: 9.25,
  },
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
  {
    section: "Showcases",
    type: "block",
    item: "ai-chat-reveal",
    mediaStart: 15.85,
    localFile: "docs/images/catalog/blocks/ai-chat-reveal.mp4",
  },
  { section: "Data", type: "block", item: "us-map-flow", mediaStart: 4.0 },
  { section: "Effects", type: "component", item: "parallax-unzoom", mediaStart: 1.6 },
  { section: "Blocks", type: "block", item: "hw-pipeline", mediaStart: 1.4 },
];

export const catalogOverviewAssets: CatalogOverviewAsset[] = catalogOverviewAssetSeeds.map(
  (asset) => ({
    ...asset,
    url: `https://static.heygen.ai/hyperframes-oss/docs/images/catalog/${asset.type}s/${asset.item}.mp4`,
  }),
);
