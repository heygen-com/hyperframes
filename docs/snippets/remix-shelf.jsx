// A shelf of videos remixed in the Studio app: each card plays HeyGen's remix on hover, credits the original
// (linked to its post), and says how to remix it yourself. Originals are never hosted here.
export const RemixShelf = ({ items, tall = false }) => {
  // Hover previews follow the visitor's reduced-motion setting, known on the first render; the film is a button, so
  // playing it on purpose works for keyboard and touch, and under reduced motion.
  // The setting lives in a ref, not state: a preference change must not re-render the shelf, which would remount
  // every card (RemixCard is declared in here, as Mintlify snippets keep helpers inside the export) and lose a
  // playing film, focus and open instructions.
  const shelfRef = useRef(null);
  const reduced = useRef(null);
  if (reduced.current === null)
    reduced.current = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const follow = (event) => {
      reduced.current = event.matches;
      // Turned on mid-visit: stop any hover preview that is running.
      if (event.matches) for (const v of shelfRef.current?.querySelectorAll("video") ?? []) if (v.dataset.hover) v.pause();
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  const RemixCard = ({ item }) => {
    const videoRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [chosen, setChosen] = useState(false);
    // One film at a time across the page: any other video starting with sound (another remix, the full-film dialog, a
    // replica pair) is a deliberate choice, so this card stops and lets go of its own.
    useEffect(() => {
      const onPlay = (event) => {
        const v = event.target;
        const own = videoRef.current;
        if (!(v instanceof HTMLVideoElement) || v.muted || v === own || !own) return;
        own.pause();
        own.muted = true;
        setChosen(false);
      };
      document.addEventListener("play", onPlay, true);
      return () => document.removeEventListener("play", onPlay, true);
    }, []);
    const preview = (on) => {
      const v = videoRef.current;
      const filmWithSound = [...document.querySelectorAll("video")].some((x) => !x.paused && !x.muted);
      if (!v || chosen || (on && filmWithSound)) return;
      if (on && !reduced.current) {
        v.dataset.hover = "1";
        v.play().catch(() => {});
      } else if (!on) {
        delete v.dataset.hover;
        v.pause();
        v.currentTime = 0;
      }
    };
    const toggle = () => {
      const v = videoRef.current;
      if (!v) return;
      // A chosen film plays with its sound; hover previews stay muted.
      if (chosen && !v.paused) {
        v.pause();
        v.muted = true;
        setChosen(false);
      } else {
        delete v.dataset.hover;
        v.muted = false;
        v.play().catch(() => {});
        setChosen(true);
      }
    };
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(item.post);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {}
    };
    return (
      <div className="hf-remix-card overflow-hidden rounded-xl border">
        <button
          type="button"
          className="hf-remix-media relative block w-full cursor-pointer border-0 p-0"
          style={{ aspectRatio: item.ratio }}
          aria-label={`${chosen ? "Pause" : "Play with sound:"} ${item.name}, remixed in HyperFrames`}
          aria-pressed={chosen}
          onMouseEnter={() => preview(true)}
          onMouseLeave={() => preview(false)}
          onClick={toggle}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            src={item.result}
            poster={item.resultPoster}
            preload="none"
            muted
            loop
            playsInline
          />
        </button>
        <div className="flex flex-col gap-1.5 p-3">
          <strong className="hf-remix-name text-sm leading-snug">{item.name}</strong>
          <span className="hf-remix-credit text-xs">
            Remix of a video by{" "}
            <a href={item.post} target="_blank" rel="noopener noreferrer">{item.handle}</a>
          </span>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="hf-remix-btn mt-1 self-start rounded-full px-3 py-1 text-xs font-semibold"
          >
            Remix in Studio
          </button>
          {open && (
            <div className="hf-remix-help text-xs leading-relaxed">
              Copy the original's link, then paste it in <strong>Reference</strong> on the Studio app's Home.{" "}
              <button type="button" onClick={copy} className="font-semibold underline">
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };
  return (
    <div ref={shelfRef} className={`hf-remix-shelf not-prose my-6${tall ? " is-tall" : ""}`}>
      {items.map((item) => <RemixCard key={item.id} item={item} />)}
    </div>
  );
};
