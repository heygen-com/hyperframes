import type { StoryboardGlobals } from "@hyperframes/core/storyboard";

export interface StoryboardDirectionProps {
  globals: StoryboardGlobals;
  frameCount: number;
}

/**
 * Global direction header: the message/thesis plus arc, audience, and format.
 * This is the storyboard's "north star" pulled from the manifest frontmatter.
 */
export function StoryboardDirection({ globals, frameCount }: StoryboardDirectionProps) {
  const meta = [
    { label: "Arc", value: globals.arc },
    { label: "Audience", value: globals.audience },
    { label: "Voice", value: globals.extra.voice },
    { label: "Format", value: globals.format },
    { label: "Frames", value: String(frameCount) },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));

  return (
    <header className="border-b border-neutral-800 pb-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
        Storyboard
      </div>
      {globals.message ? (
        <h1 className="mt-1 text-2xl font-semibold leading-tight text-neutral-100">
          {globals.message}
        </h1>
      ) : (
        <h1 className="mt-1 text-2xl font-semibold leading-tight text-neutral-400">
          Untitled storyboard
        </h1>
      )}
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
        {meta.map((item) => (
          <div key={item.label} className="flex items-baseline gap-2">
            <dt className="text-[11px] uppercase tracking-wider text-neutral-500">{item.label}</dt>
            <dd className="text-sm text-neutral-300">{item.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
