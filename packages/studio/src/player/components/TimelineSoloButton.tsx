/**
 * "Hear only this" — the `⌗` toggle beside a track's mute control. Session
 * state only (see `audioSoloSlice`): a plain click is exclusive, ⌘/Ctrl-click
 * toggles membership without disturbing the rest of the set.
 */
export function TimelineSoloButton({
  isSoloed,
  onToggle,
}: {
  isSoloed: boolean;
  onToggle: (options?: { add?: boolean }) => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={isSoloed}
      aria-label="Hear only this"
      title="Hear only this"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[#3CE6AC] ${
        isSoloed ? "text-[#F5C542] hover:text-white" : "text-white/35 hover:text-white/75"
      }`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle({ add: event.metaKey || event.ctrlKey });
      }}
    >
      <span aria-hidden="true">⌗</span>
    </button>
  );
}
