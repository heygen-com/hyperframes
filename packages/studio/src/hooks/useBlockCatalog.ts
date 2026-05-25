import { useState, useEffect, useMemo } from "react";
import type { RegistryItem } from "@hyperframes/core/registry";
import { type BlockCategory, resolveBlockCategory } from "../utils/blockCategories";

export type CatalogItem = RegistryItem & {
  category: BlockCategory;
};

export function useBlockCatalog() {
  const [blocks, setBlocks] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<BlockCategory | null>(null);

  // fallow-ignore-next-line complexity
  useEffect(() => {
    const CATEGORY_ORDER: Record<BlockCategory, number> = {
      captions: 0,
      vfx: 1,
      transitions: 2,
      effects: 3,
      social: 4,
      data: 5,
      scenes: 6,
    };

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/registry/blocks");
        if (!res.ok) throw new Error("Failed to load catalog");
        const data = (await res.json()) as RegistryItem[];
        if (cancelled) return;
        const items = data
          .map((b) => ({ ...b, category: resolveBlockCategory(b.tags) }))
          .sort((a, b) => (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9));
        setBlocks(items);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load catalog");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
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
