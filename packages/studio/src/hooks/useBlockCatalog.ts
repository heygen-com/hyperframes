import { useState, useEffect, useMemo } from "react";
import type { RegistryItem } from "@hyperframes/core/registry";
import {
  BLOCK_CATEGORIES,
  type BlockCategory,
  resolveBlockCategory,
} from "../utils/blockCategories";

type CatalogItem = RegistryItem & {
  category: BlockCategory;
};

let catalogCache: CatalogItem[] | null = null;
let catalogRequest: Promise<CatalogItem[]> | null = null;

function loadCatalog(): Promise<CatalogItem[]> {
  catalogRequest ??= fetch("/api/registry/blocks")
    .then((response) => {
      if (!response.ok) throw new Error("Failed to load catalog");
      return response.json() as Promise<RegistryItem[]>;
    })
    .then((items) => {
      catalogCache = items
        .map((item) => ({ ...item, category: resolveBlockCategory(item.tags) }))
        .sort((a, b) => {
          const aIndex = BLOCK_CATEGORIES.findIndex((category) => category.id === a.category);
          const bIndex = BLOCK_CATEGORIES.findIndex((category) => category.id === b.category);
          return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
        });
      return catalogCache;
    })
    .catch((error: unknown) => {
      catalogRequest = null;
      throw error;
    });
  return catalogRequest;
}

/**
 * The catalog fetch, as a value rather than a throw.
 *
 * The React Compiler cannot reorder across a `finally`, so a `try`/`finally`
 * anywhere in a hook body makes it decline the whole hook and silently drop every
 * memo in it. Out here the same control flow is just a function, and the effect
 * below is left with one branch instead of three clauses.
 */
type CatalogLoad = { readonly items: CatalogItem[] } | { readonly error: string };

async function loadCatalogResult(): Promise<CatalogLoad> {
  try {
    return { items: await loadCatalog() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load catalog" };
  }
}

export function useBlockCatalog() {
  const [blocks, setBlocks] = useState<CatalogItem[]>(() => catalogCache ?? []);
  const [loading, setLoading] = useState(catalogCache === null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<BlockCategory | null>(null);

  useEffect(() => {
    if (catalogCache) return;
    let cancelled = false;
    void loadCatalogResult().then((result) => {
      if (cancelled) return;
      if ("items" in result) setBlocks(result.items);
      else setError(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredBlocks = useMemo(() => {
    let result = blocks;
    if (category) {
      result = result.filter((b) => b.category === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          b.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [blocks, category, search]);

  return {
    blocks,
    loading,
    error,
    search,
    setSearch,
    category,
    setCategory,
    filteredBlocks,
  };
}
