import { Eye, Layers } from "../../icons/SystemIcons";

export function PropertyPanelEmptyState({ multiSelectCount }: { multiSelectCount: number }) {
  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        {multiSelectCount > 1 ? (
          <>
            <Layers size={18} className="mb-3 text-neutral-600" />
            <p className="text-sm font-medium text-neutral-200">
              {multiSelectCount} elements selected
            </p>
            <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
              Select a single element to edit its properties. Click an element in the preview or use
              the timeline layer panel.
            </p>
          </>
        ) : (
          <>
            <Eye size={18} className="mb-3 text-neutral-600" />
            <p className="text-sm font-medium text-neutral-200">
              Select an element in the preview.
            </p>
            <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
              The inspector is tuned for element edits with safer geometry controls, color picking,
              and cleaner grouped layer controls.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
