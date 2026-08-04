import { useRef, useState } from "react";
import type {
  ExternalFileChangeBlockedState,
  ExternalFileChangeCoordinatorHandle,
} from "../hooks/useExternalFileChangeCoordinator";
import { useDialogBehavior } from "./ui/useDialogBehavior";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function downloadText(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ConflictReview({
  conflict,
  onClose,
}: {
  conflict: Extract<ExternalFileChangeBlockedState, { status: "conflict" }>;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogBehavior({ open: true, onClose, containerRef });
  const external = conflict.error.currentContent ?? "(The server did not return file contents.)";
  const studio = conflict.error.attemptedContent;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-conflict-title"
        tabIndex={-1}
        className="max-h-[88vh] w-full max-w-5xl overflow-auto rounded-xl border border-amber-400/30 bg-neutral-950 p-5 text-neutral-100 shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="external-conflict-title" className="text-base font-semibold">
              Review both versions of {conflict.error.filePath}
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Reviewing or exporting does not change either version.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-neutral-400">
            Close
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            { title: "File on disk", content: external, suffix: "external" },
            { title: "Unsaved Studio version", content: studio, suffix: "studio" },
          ].map((side) => (
            <section key={side.suffix} aria-label={side.title}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{side.title}</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-neutral-700 px-2 py-1 text-[11px]"
                    onClick={() => void navigator.clipboard.writeText(side.content)}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="rounded border border-neutral-700 px-2 py-1 text-[11px]"
                    onClick={() =>
                      downloadText(`${conflict.error.filePath}.${side.suffix}.html`, side.content)
                    }
                  >
                    Download
                  </button>
                </div>
              </div>
              <textarea
                readOnly
                value={side.content}
                className="h-80 w-full resize-y rounded border border-neutral-800 bg-neutral-900 p-3 font-mono text-[11px] leading-relaxed text-neutral-300"
              />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function FailedDraftReview({
  path,
  content,
  onClose,
}: {
  path: string;
  content: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogBehavior({ open: true, onClose, containerRef });
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="failed-draft-title"
        tabIndex={-1}
        className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-xl border border-amber-400/30 bg-neutral-950 p-5 text-neutral-100 shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="failed-draft-title" className="text-base font-semibold">
              Recover unsaved Studio draft for {path}
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Copy or download this draft before choosing to discard it.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-neutral-400">
            Close
          </button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-neutral-700 px-2 py-1 text-[11px]"
            onClick={() => void navigator.clipboard.writeText(content)}
          >
            Copy
          </button>
          <button
            type="button"
            className="rounded border border-neutral-700 px-2 py-1 text-[11px]"
            onClick={() => downloadText(`${path}.studio.html`, content)}
          >
            Download
          </button>
        </div>
        <textarea
          readOnly
          value={content}
          className="mt-2 h-80 w-full resize-y rounded border border-neutral-800 bg-neutral-900 p-3 font-mono text-[11px] leading-relaxed text-neutral-300"
        />
      </div>
    </div>
  );
}

export function ExternalFileConflictBanner({
  coordinator,
}: {
  coordinator: ExternalFileChangeCoordinatorHandle;
}) {
  const [reviewing, setReviewing] = useState(false);
  const blocked = coordinator.blocked;
  if (!blocked) return null;

  const conflict = blocked.status === "conflict" ? blocked : null;
  const failure = blocked.status === "failed" ? blocked : null;
  return (
    <>
      <div
        role="alert"
        className="absolute left-1/2 top-14 z-[94] flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-md border border-amber-400/30 bg-amber-950/95 px-4 py-2 text-[12px] font-medium text-amber-50 shadow-lg"
      >
        <span>
          {conflict
            ? `${conflict.error.filePath} changed outside Studio. Preview is paused so neither version is lost.`
            : `Studio could not safely finish local saves: ${errorMessage(blocked.error)}. Preview is paused.`}
        </span>
        {conflict && (
          <button type="button" onClick={() => setReviewing(true)} className="underline">
            Review or export both
          </button>
        )}
        {failure?.studioContent != null && (
          <button type="button" onClick={() => setReviewing(true)} className="underline">
            Review or export Studio draft
          </button>
        )}
        {failure && !failure.recovered && failure.studioContent != null && (
          <button type="button" onClick={() => void coordinator.retry()} className="underline">
            Retry save
          </button>
        )}
        <button
          type="button"
          onClick={() => void coordinator.useExternalFile()}
          className="rounded border border-amber-200/30 px-2 py-1"
        >
          Discard Studio edits and reload file
        </button>
        {conflict && (
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Overwrite the externally changed file with the Studio version? The server will preserve its normal backup before writing.",
                )
              ) {
                void coordinator.keepStudioFile();
              }
            }}
            className="rounded border border-red-300/40 px-2 py-1 text-red-100"
          >
            Overwrite file with Studio version
          </button>
        )}
        {failure?.recovered && failure.studioContent != null && (
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Overwrite the file with the recovered Studio draft? The current file will be preserved by the server's normal backup before writing.",
                )
              ) {
                void coordinator.keepStudioFile();
              }
            }}
            className="rounded border border-red-300/40 px-2 py-1 text-red-100"
          >
            Overwrite file with recovered Studio draft
          </button>
        )}
      </div>
      {reviewing && conflict && (
        <ConflictReview conflict={conflict} onClose={() => setReviewing(false)} />
      )}
      {reviewing && failure?.studioContent != null && (
        <FailedDraftReview
          path={failure.path}
          content={failure.studioContent}
          onClose={() => setReviewing(false)}
        />
      )}
    </>
  );
}
