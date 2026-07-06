import { useRef, useState } from "react";
import { XIcon, WarningIcon, CheckCircleIcon, CaretRightIcon } from "@phosphor-icons/react";
import { copyTextToClipboard } from "../utils/clipboard";
import { useDialogBehavior } from "./ui/useDialogBehavior";

export interface LintFinding {
  severity: "error" | "warning";
  message: string;
  file?: string;
  fixHint?: string;
}

export function LintModal({
  findings,
  projectId,
  projectDir,
  title = "HyperFrame Lint Results",
  promptIntro = "Fix these HyperFrames lint issues",
  onClose,
}: {
  findings: LintFinding[];
  projectId: string;
  /** Real on-disk project directory for the agent prompt (not the browser URL). */
  projectDir?: string | null;
  /** Header subtitle — parameterize so console errors don't masquerade as lint results. */
  title?: string;
  /** First line of the copied agent prompt. */
  promptIntro?: string;
  onClose: () => void;
}) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const hasIssues = findings.length > 0;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useDialogBehavior({ open: true, onClose, containerRef });

  const handleCopyToAgent = async () => {
    const lines = findings.map((f) => {
      let line = `[${f.severity}] ${f.message}`;
      if (f.file) line += `\n  File: ${f.file}`;
      if (f.fixHint) line += `\n  Fix: ${f.fixHint}`;
      return line;
    });
    const pathLine = projectDir ? `Project path: ${projectDir}\n\n` : "";
    const text = `${promptIntro} for project "${projectId}":\n\n${pathLine}${lines.join("\n\n")}`;
    const copiedText = await copyTextToClipboard(text);
    if (copiedText) {
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 3000);
    }
  };

  return (
    <div
      className="hf-backdrop-in fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={requestClose}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="bg-neutral-950 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            {hasIssues ? (
              <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                <WarningIcon size={18} className="text-red-400" weight="fill" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-studio-accent/10 flex items-center justify-center">
                <CheckCircleIcon size={18} className="text-studio-accent" weight="fill" />
              </div>
            )}
            <div>
              <h2 className="text-sm font-semibold text-neutral-200">
                {hasIssues
                  ? `${errors.length} error${errors.length !== 1 ? "s" : ""}, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}`
                  : "All checks passed"}
              </h2>
              <p className="text-xs text-neutral-500">{title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors active:scale-[0.98]"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Copy to agent + findings */}
        {hasIssues && (
          <div className="flex items-center justify-end px-5 py-2 border-b border-neutral-800/50">
            <button
              onClick={handleCopyToAgent}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors active:scale-[0.98] ${
                copied
                  ? "bg-green-600 text-white"
                  : copyFailed
                    ? "bg-red-600 text-white"
                    : "bg-studio-accent hover:bg-studio-accent/80 text-white"
              }`}
            >
              {copied
                ? "Copied!"
                : copyFailed
                  ? "Copy failed — check permissions"
                  : "Copy to Agent"}
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!hasIssues && (
            <div className="py-8 text-center text-neutral-500 text-sm">
              No errors or warnings found. Your composition looks good!
            </div>
          )}
          {errors.map((f, i) => (
            <div key={`e-${i}`} className="py-3 border-b border-neutral-800/50 last:border-0">
              <div className="flex items-start gap-2">
                <WarningIcon
                  size={14}
                  className="text-red-400 flex-shrink-0 mt-0.5"
                  weight="fill"
                />
                <div className="min-w-0">
                  <p className="text-sm text-neutral-200">{f.message}</p>
                  {f.file && <p className="text-xs text-neutral-600 font-mono mt-0.5">{f.file}</p>}
                  {f.fixHint && (
                    <div className="flex items-start gap-1 mt-1.5">
                      <CaretRightIcon
                        size={10}
                        className="text-studio-accent flex-shrink-0 mt-0.5"
                      />
                      <p className="text-xs text-studio-accent">{f.fixHint}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {warnings.map((f, i) => (
            <div key={`w-${i}`} className="py-3 border-b border-neutral-800/50 last:border-0">
              <div className="flex items-start gap-2">
                <WarningIcon size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm text-neutral-300">{f.message}</p>
                  {f.file && <p className="text-xs text-neutral-600 font-mono mt-0.5">{f.file}</p>}
                  {f.fixHint && (
                    <div className="flex items-start gap-1 mt-1.5">
                      <CaretRightIcon
                        size={10}
                        className="text-studio-accent flex-shrink-0 mt-0.5"
                      />
                      <p className="text-xs text-studio-accent">{f.fixHint}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
