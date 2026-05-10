export type BlockCategory = "vfx" | "transitions" | "social" | "data" | "scenes";

export interface BlockParam {
  key: string;
  label: string;
  type: "color" | "text" | "number" | "select";
  cssVar?: string; // CSS variable name to set
  default: string;
  options?: string[]; // for select type
  min?: number;
  max?: number;
}

export interface BlockEntry {
  name: string;
  title: string;
  description: string;
  category: BlockCategory;
  tags: string[];
  duration: number;
  file: string;
  params?: BlockParam[];
}

export const BLOCK_CATEGORY_META: Record<
  BlockCategory,
  { label: string; color: string; bg: string; border: string }
> = {
  vfx: {
    label: "VFX",
    color: "text-purple-300",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
  },
  transitions: {
    label: "Transitions",
    color: "text-blue-300",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  social: {
    label: "Social",
    color: "text-pink-300",
    bg: "bg-pink-500/10",
    border: "border-pink-500/30",
  },
  data: {
    label: "Data",
    color: "text-emerald-300",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  scenes: {
    label: "Scenes",
    color: "text-amber-300",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
};

function categorize(tags: string[]): BlockCategory {
  if (tags.some((t) => t === "html-in-canvas" || t === "webgl")) return "vfx";
  if (tags.includes("social") || tags.includes("overlay")) return "social";
  if (tags.includes("data") || tags.includes("diagram") || tags.includes("chart")) return "data";
  if (tags.includes("transition")) return "transitions";
  return "scenes";
}

function block(
  name: string,
  title: string,
  description: string,
  tags: string[],
  duration: number,
  params?: BlockParam[],
): BlockEntry {
  return {
    name,
    title,
    description,
    category: categorize(tags),
    tags,
    duration,
    file: `${name}.html`,
    ...(params ? { params } : {}),
  };
}

export const BLOCK_CATALOG: BlockEntry[] = [
  block(
    "vfx-liquid-glass",
    "Liquid Glass",
    "Glass refraction with live HTML content",
    ["html-in-canvas", "webgl"],
    20,
    [
      {
        key: "bg-color",
        label: "Background",
        type: "color",
        cssVar: "--bg-color",
        default: "#000000",
      },
      {
        key: "accent-color",
        label: "Accent",
        type: "color",
        cssVar: "--accent-color",
        default: "#00d4ff",
      },
      {
        key: "speed",
        label: "Speed",
        type: "number",
        cssVar: "--speed",
        default: "1",
        min: 0.1,
        max: 3,
      },
    ],
  ),
  block(
    "vfx-liquid-background",
    "Liquid Background",
    "Organic fluid simulation with vertex displacement",
    ["html-in-canvas", "liquid", "webgl"],
    12,
    [
      { key: "color-1", label: "Color 1", type: "color", cssVar: "--color-1", default: "#0a0a2e" },
      { key: "color-2", label: "Color 2", type: "color", cssVar: "--color-2", default: "#1a1a4e" },
      {
        key: "speed",
        label: "Speed",
        type: "number",
        cssVar: "--speed",
        default: "1",
        min: 0.1,
        max: 5,
      },
    ],
  ),
  block(
    "vfx-magnetic",
    "Magnetic",
    "Magnetic field distortion effect",
    ["html-in-canvas", "webgl"],
    15,
  ),
  block("vfx-portal", "Portal", "Dimensional portal VFX", ["html-in-canvas", "webgl"], 10, [
    {
      key: "portal-color",
      label: "Portal Color",
      type: "color",
      cssVar: "--portal-color",
      default: "#7c3aed",
    },
    {
      key: "intensity",
      label: "Intensity",
      type: "number",
      cssVar: "--intensity",
      default: "1.5",
      min: 0.5,
      max: 5,
    },
  ]),
  block(
    "vfx-shatter",
    "Shatter",
    "Glass shatter break-apart effect",
    ["html-in-canvas", "webgl"],
    12,
  ),
  block(
    "vfx-text-cursor",
    "Text Cursor VFX",
    "Dramatic text reveal with cursor glow and chromatic rays",
    ["html-in-canvas", "text", "shader"],
    8,
  ),
  block(
    "vfx-iphone-device",
    "iPhone & MacBook 3D",
    "GLTF device models with live screen content",
    ["html-in-canvas", "3d", "device", "gltf"],
    15,
  ),

  block(
    "chromatic-radial-split",
    "Chromatic Split",
    "Chromatic aberration radial split",
    ["transition", "shader"],
    4,
  ),
  block(
    "cinematic-zoom",
    "Cinematic Zoom",
    "Dramatic zoom blur transition",
    ["transition", "shader"],
    4,
  ),
  block(
    "cross-warp-morph",
    "Cross Warp",
    "Cross-warped morphing transition",
    ["transition", "shader"],
    4,
  ),
  block(
    "domain-warp-dissolve",
    "Domain Warp",
    "Fractal noise domain warping",
    ["transition", "shader"],
    4,
  ),
  block("flash-through-white", "Flash White", "White flash crossfade", ["transition", "shader"], 4),
  block("glitch", "Glitch", "Digital glitch artifacts", ["transition", "shader"], 4),
  block(
    "gravitational-lens",
    "Gravitational Lens",
    "Gravitational lensing distortion",
    ["transition", "shader"],
    4,
  ),
  block("light-leak", "Light Leak", "Cinematic light leak overlay", ["transition", "shader"], 4),
  block("ridged-burn", "Ridged Burn", "Ridged turbulence burn effect", ["transition", "shader"], 4),
  block(
    "ripple-waves",
    "Ripple Waves",
    "Concentric ripple wave distortion",
    ["transition", "shader"],
    4,
  ),
  block("sdf-iris", "SDF Iris", "Signed distance field iris reveal", ["transition", "shader"], 4),
  block("swirl-vortex", "Swirl Vortex", "Swirling vortex distortion", ["transition", "shader"], 4),
  block(
    "thermal-distortion",
    "Thermal Distortion",
    "Heat haze thermal distortion",
    ["transition", "shader"],
    4,
  ),
  block("whip-pan", "Whip Pan", "Fast camera whip pan", ["transition", "shader"], 4),
  block(
    "transitions-3d",
    "3D Transitions",
    "Perspective flip and rotate transitions",
    ["transition", "showcase"],
    11,
  ),
  block(
    "transitions-blur",
    "Blur Transitions",
    "Blur-based transitions between scenes",
    ["transition", "showcase"],
    20,
  ),
  block(
    "transitions-cover",
    "Cover Transitions",
    "Cover/uncover slide transitions",
    ["transition", "showcase"],
    21,
  ),
  block(
    "transitions-destruction",
    "Destruction",
    "Destructive break-apart transitions",
    ["transition", "showcase"],
    14,
  ),
  block(
    "transitions-dissolve",
    "Dissolve",
    "Dissolve and fade transitions",
    ["transition", "showcase"],
    24,
  ),
  block(
    "transitions-distortion",
    "Distortion",
    "Warp and distortion transitions",
    ["transition", "showcase"],
    21,
  ),
  block("transitions-grid", "Grid", "Grid-based tile transitions", ["transition", "showcase"], 11),
  block(
    "transitions-light",
    "Light",
    "Light-based glow and flash transitions",
    ["transition", "showcase"],
    21,
  ),
  block(
    "transitions-mechanical",
    "Mechanical",
    "Shutter and iris transitions",
    ["transition", "showcase"],
    15,
  ),
  block(
    "transitions-other",
    "Other",
    "Miscellaneous creative transitions",
    ["transition", "showcase"],
    20,
  ),
  block("transitions-push", "Push", "Push and slide transitions", ["transition", "showcase"], 24),
  block(
    "transitions-radial",
    "Radial",
    "Radial wipe and reveal transitions",
    ["transition", "showcase"],
    20,
  ),
  block("transitions-scale", "Scale", "Scale and zoom transitions", ["transition", "showcase"], 15),

  block(
    "instagram-follow",
    "Instagram Follow",
    "Animated Instagram follow overlay",
    ["social", "overlay", "instagram"],
    4.5,
  ),
  block(
    "tiktok-follow",
    "TikTok Follow",
    "Animated TikTok follow overlay",
    ["social", "overlay", "tiktok"],
    4.5,
  ),
  block(
    "reddit-post",
    "Reddit Post",
    "Animated Reddit post card overlay",
    ["social", "overlay", "reddit"],
    5,
  ),
  block(
    "spotify-card",
    "Spotify Now Playing",
    "Now-playing card with album art",
    ["social", "overlay", "spotify"],
    5,
  ),
  block(
    "x-post",
    "X Post Card",
    "Animated X/Twitter post card",
    ["social", "overlay", "twitter"],
    5,
  ),
  block(
    "yt-lower-third",
    "YouTube Lower Third",
    "Animated subscribe lower third",
    ["social", "overlay", "youtube"],
    4.5,
  ),
  block(
    "macos-notification",
    "macOS Notification",
    "macOS-style notification banner",
    ["social", "overlay", "notification"],
    5,
  ),

  block(
    "data-chart",
    "Data Chart",
    "Animated bar + line chart with staggered reveal",
    ["data", "chart"],
    15,
    [
      {
        key: "chart-color",
        label: "Bar Color",
        type: "color",
        cssVar: "--chart-color",
        default: "#3b82f6",
      },
      {
        key: "line-color",
        label: "Line Color",
        type: "color",
        cssVar: "--line-color",
        default: "#10b981",
      },
      {
        key: "bg-color",
        label: "Background",
        type: "color",
        cssVar: "--bg-color",
        default: "#0a0a0a",
      },
      {
        key: "style",
        label: "Style",
        type: "select",
        cssVar: "--chart-style",
        default: "bar",
        options: ["bar", "line", "area"],
      },
    ],
  ),
  block(
    "flowchart",
    "Flowchart",
    "Decision tree with SVG connectors and interaction",
    ["diagram", "flowchart"],
    12,
  ),
  block(
    "flowchart-vertical",
    "Flowchart Vertical",
    "Portrait animated decision tree",
    ["diagram", "flowchart", "portrait"],
    12,
  ),

  block(
    "app-showcase",
    "App Showcase",
    "Fitness app with floating smartphone screens",
    ["showcase", "app", "3d"],
    5.5,
  ),
  block(
    "apple-money-count",
    "Money Counter",
    "Apple-style finance counter animation",
    ["showcase", "finance", "kinetic"],
    5,
  ),
  block(
    "blue-sweater-intro-video",
    "Creator Intro",
    "AI creator intro sequence",
    ["showcase", "ai", "creator"],
    12,
  ),
  block(
    "logo-outro",
    "Logo Outro",
    "Cinematic logo reveal with glow bloom",
    ["branding", "outro", "logo"],
    6,
    [
      {
        key: "bg-color",
        label: "Background",
        type: "color",
        cssVar: "--bg-color",
        default: "#000000",
      },
      {
        key: "glow-color",
        label: "Glow Color",
        type: "color",
        cssVar: "--glow-color",
        default: "#ffffff",
      },
      {
        key: "logo-text",
        label: "Logo Text",
        type: "text",
        cssVar: "--logo-text",
        default: "LOGO",
      },
    ],
  ),
  block(
    "north-korea-locked-down",
    "Map Annotation",
    "Map zoom with annotation overlay",
    ["showcase", "map", "annotation"],
    7,
  ),
  block(
    "nyc-paris-flight",
    "Flight Map",
    "Plane animation on realistic map",
    ["showcase", "travel", "map"],
    6,
  ),
  block(
    "ui-3d-reveal",
    "3D UI Reveal",
    "Perspective 3D reveal for UI elements",
    ["showcase", "3d", "reveal"],
    13,
  ),
  block(
    "vpn-youtube-spot",
    "Product Spot",
    "Snappy Apple-style product showcase",
    ["showcase", "app", "youtube"],
    7,
  ),
];

export const BLOCK_CATEGORIES: BlockCategory[] = ["scenes", "vfx", "transitions", "social", "data"];

export function filterBlocks(
  blocks: BlockEntry[],
  category: BlockCategory | null,
  search: string,
): BlockEntry[] {
  let filtered = blocks;
  if (category) filtered = filtered.filter((b) => b.category === category);
  const query = search.trim().toLowerCase();
  if (query) {
    filtered = filtered.filter(
      (b) =>
        b.title.toLowerCase().includes(query) ||
        b.description.toLowerCase().includes(query) ||
        b.tags.some((t) => t.includes(query)),
    );
  }
  return filtered;
}
