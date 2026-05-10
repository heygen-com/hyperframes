import { memo, useState, useCallback } from "react";
import { Search, Plus, Layers, Square } from "../../icons/SystemIcons";
import {
  BLOCK_CATALOG,
  BLOCK_CATEGORIES,
  BLOCK_CATEGORY_META,
  filterBlocks,
  type BlockCategory,
  type BlockEntry,
} from "./blockCatalog";
import { TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";

interface BlocksPanelProps {
  onAddBlock: (block: BlockEntry) => void;
  adding: string | null;
}

const CATEGORY_ACCENTS: Record<BlockCategory, string> = {
  vfx: "#8b5cf6",
  transitions: "#3b82f6",
  social: "#ec4899",
  data: "#10b981",
  scenes: "#f59e0b",
};

const CATEGORY_ICONS: Record<BlockCategory, string> = {
  vfx: "◆",
  transitions: "↔",
  social: "◉",
  data: "▤",
  scenes: "▣",
};

function BlockCard({
  block,
  onAdd,
  isAdding,
}: {
  block: BlockEntry;
  onAdd: () => void;
  isAdding: boolean;
}) {
  const meta = BLOCK_CATEGORY_META[block.category];
  const accent = CATEGORY_ACCENTS[block.category];
  const icon = CATEGORY_ICONS[block.category];

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          TIMELINE_BLOCK_MIME,
          JSON.stringify({
            name: block.name,
            file: block.file,
            title: block.title,
            duration: block.duration,
            category: block.category,
          }),
        );
        const ghost = document.createElement("div");
        ghost.textContent = block.title;
        ghost.style.cssText =
          "position:fixed;top:-100px;left:-100px;padding:6px 12px;background:#18181b;color:#fff;border-radius:8px;font-size:11px;font-weight:600;white-space:nowrap;pointer-events:none;z-index:9999;";
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        requestAnimationFrame(() => ghost.remove());
      }}
      className="group relative flex flex-col rounded-2xl border border-neutral-800 bg-neutral-950 transition-all hover:border-neutral-700 hover:bg-neutral-900/80"
    >
      {/* Visual preview area */}
      <div
        className="relative flex h-[72px] items-center justify-center overflow-hidden rounded-t-2xl"
        style={{
          background: `linear-gradient(135deg, ${accent}08 0%, ${accent}14 50%, ${accent}06 100%)`,
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(${accent} 1px, transparent 1px)`,
            backgroundSize: "16px 16px",
          }}
        />
        <span className="relative text-2xl opacity-40" style={{ color: accent }}>
          {icon}
        </span>
        {/* Add button overlay */}
        <button
          type="button"
          onClick={onAdd}
          disabled={isAdding}
          className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 disabled:cursor-wait"
        >
          {isAdding ? (
            <div
              className="h-5 w-5 animate-spin rounded-full border-2 border-white/20"
              style={{ borderTopColor: accent }}
            />
          ) : (
            <div
              className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-[11px] font-semibold text-white shadow-lg"
              style={{ backgroundColor: accent }}
            >
              <Plus size={12} />
              Add
            </div>
          )}
        </button>
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[11px] font-semibold text-neutral-100">
            {block.title}
          </span>
        </div>
        <p className="line-clamp-2 text-[10px] leading-[1.4] text-neutral-500">
          {block.description}
        </p>
        <div className="mt-auto flex items-center gap-2 pt-1">
          <span
            className={`rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${meta.color} ${meta.bg} ${meta.border}`}
          >
            {meta.label}
          </span>
          <span className="text-[9px] text-neutral-600">{block.duration}s</span>
        </div>
      </div>
    </div>
  );
}

export const BlocksPanel = memo(function BlocksPanel({ onAddBlock, adding }: BlocksPanelProps) {
  const [activeCategory, setActiveCategory] = useState<BlockCategory | null>(null);
  const [search, setSearch] = useState("");

  const filtered = filterBlocks(BLOCK_CATALOG, activeCategory, search);

  const handleAdd = useCallback(
    (block: BlockEntry) => {
      onAddBlock(block);
    },
    [onAddBlock],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900 text-neutral-100">
      {/* Header */}
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <Layers size={15} className="flex-shrink-0 text-neutral-500" />
          <h3 className="text-[12px] font-semibold text-neutral-200">Blocks</h3>
          <span className="ml-auto text-[10px] text-neutral-600">{filtered.length}</span>
        </div>

        {/* Search */}
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 transition-colors focus-within:border-neutral-600">
          <Search size={12} className="flex-shrink-0 text-neutral-600" />
          <input
            type="text"
            placeholder="Search blocks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-neutral-200 outline-none placeholder:text-neutral-600"
          />
        </div>

        {/* Category pills */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${
              activeCategory === null
                ? "bg-neutral-700 text-white"
                : "bg-neutral-800/50 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            }`}
          >
            All
          </button>
          {BLOCK_CATEGORIES.map((cat) => {
            const meta = BLOCK_CATEGORY_META[cat];
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(isActive ? null : cat)}
                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${
                  isActive
                    ? `${meta.bg} ${meta.color} ${meta.border} border`
                    : "bg-neutral-800/50 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {filtered.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
            <Square size={18} className="text-neutral-700" />
            <p className="text-[11px] text-neutral-600">No blocks match your search</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map((block) => (
              <BlockCard
                key={block.name}
                block={block}
                onAdd={() => handleAdd(block)}
                isAdding={adding === block.name}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
