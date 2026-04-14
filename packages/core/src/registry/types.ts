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

/** Sub-composition block — installed by `hyperframes add <name>`. */
export interface BlockItem extends RegistryItemBase {
  type: "hyperframes:block";
  /** Canvas dimensions (required for blocks — they are standalone compositions). */
  dimensions: RegistryItemDimensions;
  /** Duration in seconds (required for blocks). */
  duration: number;
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
