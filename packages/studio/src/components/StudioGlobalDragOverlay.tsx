export function StudioGlobalDragOverlay() {
  return (
    <div className="hf-backdrop-in absolute inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none">
      <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-xl border-2 border-dashed border-studio-accent/60 bg-studio-accent/[0.06]">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-studio-accent"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span className="text-sm font-medium text-studio-accent">
          Drop files to import into project
        </span>
      </div>
    </div>
  );
}
