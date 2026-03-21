import { ArrowLeft, CaretRight } from "@phosphor-icons/react";

export interface CompositionLevel {
  /** Unique id — "master" or composition file path */
  id: string;
  /** Display label — "Master" or filename without extension */
  label: string;
  /** Preview URL for this composition level */
  previewUrl: string;
}

interface CompositionBreadcrumbProps {
  stack: CompositionLevel[];
  onNavigate: (index: number) => void;
}

export function CompositionBreadcrumb({ stack, onNavigate }: CompositionBreadcrumbProps) {
  if (stack.length <= 1) return null;

  return (
    <nav
      aria-label="Composition navigation"
      className="flex items-center gap-1 px-2 h-8 border-b border-neutral-800/50 bg-neutral-900/50 flex-shrink-0"
    >
      {/* Back button — always goes to parent */}
      <button
        type="button"
        onClick={() => onNavigate(stack.length - 2)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
        title="Back (Esc)"
      >
        <ArrowLeft size={12} weight="bold" />
      </button>

      {/* Breadcrumb path */}
      {stack.map((level, i) => {
        const isLast = i === stack.length - 1;
        return (
          <span key={level.id} className="flex items-center gap-1">
            {i > 0 && <CaretRight size={10} className="text-neutral-600 flex-shrink-0" />}
            {isLast ? (
              <span className="text-xs text-neutral-200 font-medium">{level.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(i)}
                className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors"
              >
                {level.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
