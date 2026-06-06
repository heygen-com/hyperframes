// The `enum` arrays in `packages/core/schemas/registry*.json` must match
// `ITEM_TYPES` / `FILE_TYPES` below — `types.test.ts` is the drift guard.

/** Top-level classification for a registry item. */
export type ItemType = "hyperframes:example" | "hyperframes:block" | "hyperframes:component";

/** File-level classification, drives installer behavior. */
export type FileType =
  | "hyperframes:composition"
  | "hyperframes:asset"
  | "hyperframes:snippet"
  | "hyperframes:style"
  | "hyperframes:timeline";

/** A single file to install as part of a registry item. */
export interface FileTarget {
  /** Path to the source file, relative to the item's `registry-item.json`. */
  path: string;
  /** Destination path in the user's project, relative to the project root. */
  target: string;
  /** File type — controls how the installer treats this file. */
  type: FileType;
}

export interface RegistryItemDimensions {
  width: number;
  height: number;
}

export interface RegistryItemPreview {
  /** Path or URL to the preview video (looping mp4). */
  video?: string;
  /** Path or URL to the preview poster image. */
  poster?: string;
}

/** Fields common to every registry item, regardless of type. */
interface RegistryItemBase {
  /** JSON Schema URL — `https://hyperframes.heygen.com/schema/registry-item.json`. */
  $schema?: string;
  /** Item name in kebab-case, unique within a registry. */
  name: string;
  /** Short human-readable title. */
  title: string;
  /** One-line description. */
  description: string;
  /** Filter tags (e.g. `["social", "portrait", "card"]`). */
  tags?: string[];
  /** Item author / maintainer. */
  author?: string;
  /** URL for the author / creator credit. */
  authorUrl?: string;
  /** Original prompt used to create or inspire the item. */
  sourcePrompt?: string;
  /** SPDX license identifier. */
  license?: string;
  /** Minimum `hyperframes` CLI version required to install this item (semver). */
  minCliVersion?: string;
  /** If set, the item is deprecated; the value is the reason or migration note. */
  deprecated?: string;
  /** Names of other registry items this item depends on. */
  registryDependencies?: string[];
  /** Files to install. Must be non-empty. */
  files: FileTarget[];
  /** Optional preview media. */
  preview?: RegistryItemPreview;
  /** Related skill slug (e.g. `hyperframes-captions`) — shown in docs. */
  relatedSkill?: string;
}

/** Full-project example — scaffolded by `hyperframes init --example <name>`. */
export interface ExampleItem extends RegistryItemBase {
  type: "hyperframes:example";
  /** Canvas dimensions (required for examples). */
  dimensions: RegistryItemDimensions;
  /** Duration in seconds (required for examples). */
  duration: number;
}

export interface BlockParam {
  key: string;
  label: string;
  type: "color" | "text" | "number" | "select";
  default: string;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
}

/** Sub-composition block — installed by `hyperframes add <name>`. */
export interface BlockItem extends RegistryItemBase {
  type: "hyperframes:block";
  /** Canvas dimensions (required for blocks — they are standalone compositions). */
  dimensions: RegistryItemDimensions;
  /** Duration in seconds (required for blocks). */
  duration: number;
  /** Customizable parameters with CSS variable mapping. */
  params?: BlockParam[];
}

/** Effect / snippet — merged into an existing composition. */
export interface ComponentItem extends RegistryItemBase {
  type: "hyperframes:component";
  /** Components have no intrinsic dimensions — they inherit from the host composition. */
  dimensions?: never;
  /** Components have no intrinsic duration — they inherit from the host composition. */
  duration?: never;
}

/**
 * A registry item — the unit of distribution. Stored on disk as
 * `registry/<examples|blocks|components>/<name>/registry-item.json`.
 */
export type RegistryItem = ExampleItem | BlockItem | ComponentItem;

/** Shorthand reference used in the top-level `registry.json` items array. */
export interface RegistryManifestEntry {
  name: string;
  type: ItemType;
}

/** The top-level `registry.json` manifest. */
export interface RegistryManifest {
  /** JSON Schema URL — `https://hyperframes.heygen.com/schema/registry.json`. */
  $schema?: string;
  /** Registry name (e.g. `hyperframes`). */
  name: string;
  /** Registry homepage URL. */
  homepage: string;
  /** Items in this registry. */
  items: RegistryManifestEntry[];
}

// ── Constants (kept in sync with JSON Schema enums) ─────────────────────────

export const ITEM_TYPES = [
  "hyperframes:example",
  "hyperframes:block",
  "hyperframes:component",
] as const satisfies readonly ItemType[];

export const FILE_TYPES = [
  "hyperframes:composition",
  "hyperframes:asset",
  "hyperframes:snippet",
  "hyperframes:style",
  "hyperframes:timeline",
] as const satisfies readonly FileType[];

/**
 * Directory segment where each item type lives under a registry root — both
 * on disk (`registry/examples/…`) and in URL construction
 * (`<baseUrl>/examples/<name>/registry-item.json`). Shared so CLIs, docs
 * tooling, and codegen scripts all agree.
 */
export const ITEM_TYPE_DIRS = {
  "hyperframes:example": "examples",
  "hyperframes:block": "blocks",
  "hyperframes:component": "components",
} as const satisfies Record<ItemType, string>;

// Compile-time exhaustiveness: every member of the TS union appears in the constant.
// If someone adds to `ItemType`/`FileType` without updating `ITEM_TYPES`/`FILE_TYPES`,
// these lines stop compiling. (The `satisfies` above covers the other direction.)
type _AssertItemTypesExhaustive =
  Exclude<ItemType, (typeof ITEM_TYPES)[number]> extends never ? true : never;
type _AssertFileTypesExhaustive =
  Exclude<FileType, (typeof FILE_TYPES)[number]> extends never ? true : never;
const _itemTypesExhaustive: _AssertItemTypesExhaustive = true;
const _fileTypesExhaustive: _AssertFileTypesExhaustive = true;
void _itemTypesExhaustive;
void _fileTypesExhaustive;

// ── Block categories ───────────────────────────────────────────────────────

export type BlockCategory =
  | "vfx"
  | "transitions"
  | "social"
  | "data"
  | "scenes"
  | "captions"
  | "effects"
  | "text-effects";

export interface BlockCategoryMeta {
  id: BlockCategory;
  label: string;
  color: string;
}

export const BLOCK_CATEGORIES: BlockCategoryMeta[] = [
  { id: "captions", label: "Captions", color: "cyan" },
  { id: "vfx", label: "VFX", color: "purple" },
  { id: "transitions", label: "Transitions", color: "blue" },
  { id: "effects", label: "Effects", color: "rose" },
  { id: "text-effects", label: "Text Effects", color: "violet" },
  { id: "social", label: "Social", color: "pink" },
  { id: "data", label: "Data", color: "green" },
  { id: "scenes", label: "Scenes", color: "amber" },
];

export function resolveBlockCategory(tags: string[] | undefined): BlockCategory {
  if (!tags || tags.length === 0) return "scenes";
  const set = new Set(tags);
  if (set.has("captions") || set.has("caption-style")) return "captions";
  if (set.has("transition")) return "transitions";
  if (set.has("social") || set.has("overlay")) return "social";
  if (set.has("data") || set.has("chart") || set.has("map")) return "data";
  if (set.has("html-in-canvas") || set.has("webgl") || set.has("shader")) return "vfx";
  if (set.has("text-effect")) return "text-effects";
  if (set.has("effect") || set.has("grain") || set.has("vignette")) return "effects";
  return "scenes";
}

// ── Type guards ─────────────────────────────────────────────────────────────

export function isExampleItem(item: RegistryItem): item is ExampleItem {
  return item.type === "hyperframes:example";
}

export function isBlockItem(item: RegistryItem): item is BlockItem {
  return item.type === "hyperframes:block";
}

export function isComponentItem(item: RegistryItem): item is ComponentItem {
  return item.type === "hyperframes:component";
}
