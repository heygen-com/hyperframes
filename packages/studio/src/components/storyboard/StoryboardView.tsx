import { useState, type ReactNode } from "react";
import { Copy, Check } from "@phosphor-icons/react";
import { useStoryboard } from "../../hooks/useStoryboard";
import { copyTextToClipboard } from "../../utils/clipboard";
import { Button } from "../ui/Button";
import { StoryboardLoaded } from "./StoryboardLoaded";

export interface StoryboardViewProps {
  projectId: string;
  /** Select a composition in the timeline (used by the frame focus "Open in Preview"). */
  onSelectComposition: (path: string) => void;
}

/**
 * Top-level storyboard stage. Replaces the timeline/preview when the view mode
 * is `storyboard`. Handles the load states here; once a storyboard exists,
 * {@link StoryboardLoaded} owns the Board ↔ Source experience.
 */
// fallow-ignore-next-line complexity
export function StoryboardView({ projectId, onSelectComposition }: StoryboardViewProps) {
  const { data, loading, error, reload } = useStoryboard(projectId);

  if (loading) return <StoryboardFrame>{<Message>Loading storyboard…</Message>}</StoryboardFrame>;
  if (error) {
    return (
      <StoryboardFrame>
        <Message tone="error">Couldn’t load the storyboard: {error}</Message>
        <div className="flex justify-center">
          <Button size="sm" variant="secondary" onClick={reload}>
            Retry
          </Button>
        </div>
      </StoryboardFrame>
    );
  }
  if (!data) return <StoryboardFrame>{null}</StoryboardFrame>;
  if (!data.exists) {
    return (
      <StoryboardFrame>
        <EmptyState path={data.path} />
      </StoryboardFrame>
    );
  }

  return (
    <StoryboardLoaded
      projectId={projectId}
      data={data}
      reload={reload}
      onSelectComposition={onSelectComposition}
    />
  );
}

function StoryboardFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-auto bg-neutral-950 text-neutral-200">
      <div className="mx-auto max-w-[1400px] px-8 py-8">{children}</div>
    </div>
  );
}

function Message({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <div
      className={`px-6 py-12 text-center text-sm ${
        tone === "error" ? "text-red-400" : "text-neutral-500"
      }`}
    >
      {children}
    </div>
  );
}

function handoffPrompt(path: string): string {
  return `Create a \`${path}\` at the project root to plan this video frame by frame.

Use this format:

---
format: 1920x1080
message: <the one-line takeaway of the video>
arc: <the narrative shape, e.g. Problem → Solution>
audience: <who it's for>
---

## Frame 1 — <title>
- duration: 5s
- transition_in: crossfade
- status: planned
- src: compositions/frames/01-<slug>.html

<A sentence or two: what's on screen and what the narration says.>

Add one \`## Frame N\` section per beat. Keep the arc tight.`;
}

function EmptyState({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const prompt = handoffPrompt(path);

  const onCopy = async () => {
    if (await copyTextToClipboard(prompt)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div>
      <div className="rounded-lg border border-dashed border-neutral-800 px-6 py-10 text-center">
        <h2 className="text-base font-semibold text-neutral-300">No storyboard yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
          Add a <code className="rounded bg-neutral-900 px-1 py-0.5 text-neutral-400">{path}</code>{" "}
          at the project root to plan this video frame by frame. Hand this prompt to your coding
          agent to scaffold it.
        </p>

        <div className="mx-auto mt-6 max-w-2xl overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-left">
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <span className="font-mono text-xs text-neutral-500">Prompt for your agent</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={onCopy}
              icon={copied ? <Check size={14} /> : <Copy size={14} />}
            >
              {copied ? "Copied" : "Copy prompt"}
            </Button>
          </div>
          <pre className="max-h-64 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed text-neutral-400 whitespace-pre-wrap">
            {prompt}
          </pre>
        </div>
      </div>

      <SkeletonPreview />
    </div>
  );
}

/** Faded placeholder of a filled board so landing here isn't a dead end —
 *  it previews the contact-sheet layout {@link StoryboardGrid} renders. */
function SkeletonPreview() {
  return (
    <div aria-hidden="true" className="mt-10 select-none opacity-40">
      <div className="mb-4 text-center text-xs uppercase tracking-wide text-neutral-600">
        Preview
      </div>
      <div className="grid gap-x-6 gap-y-8 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="aspect-video w-full rounded bg-neutral-800/60" />
            <div className="mt-3 h-3 w-2/3 rounded bg-neutral-800/60" />
            <div className="mt-2 h-2.5 w-full rounded bg-neutral-800/40" />
            <div className="mt-1.5 h-2.5 w-4/5 rounded bg-neutral-800/40" />
          </div>
        ))}
      </div>
    </div>
  );
}
