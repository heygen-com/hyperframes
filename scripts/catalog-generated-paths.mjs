export const GENERATED_CATALOG_PATHS = [
  "registry/registry.json",
  "registry/catalog-artifact/local-vectors.json",
  "registry/catalog-artifact/local-vectors.bin",
  "docs/catalog/blocks",
  "docs/catalog/components",
  "docs/public/catalog",
  "docs/public/catalog-index.json",
  "docs/snippets/catalog-gallery-data.mdx",
  "docs/docs.json",
];

export function isGeneratedCatalogPath(path) {
  return GENERATED_CATALOG_PATHS.some((root) => path === root || path.startsWith(`${root}/`));
}
