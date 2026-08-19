/**
 * "Hear only this" — the boxed `S` beside a track's mute control, which is what
 * a solo button looks like in every DAW an author might have met. Session
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
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[#3CE6AC]"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle({ add: event.metaKey || event.ctrlKey });
      }}
    >
      {/* Filled when on, outlined when off — the state has to read at a glance
          from across the track column, and a colour change alone does not. */}
      <span
        aria-hidden="true"
        className={`flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border text-[10px] font-bold leading-none transition-colors ${
          isSoloed
            ? "border-[#F5C542] bg-[#F5C542] text-black"
            : "border-white/30 text-white/45 hover:border-white/60 hover:text-white/80"
        }`}
      >
        S
      </span>
    </button>
  );
}
