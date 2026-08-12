export const ReplicaCompare = ({
  title,
  meta,
  refSrc,
  refPoster,
  replicaSrc,
  replicaPoster,
}) => {
  const wrapRef = useRef(null);
  const refVideo = useRef(null);
  const repVideo = useRef(null);
  const [muted, setMuted] = useState(true);
  const [inView, setInView] = useState(false);

  // Only assign/decode the two films near the viewport, so the pair doesn't
  // download offscreen. Falls back to eager if there's no observer.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver !== "function") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? false),
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Lazy initializer, not a post-mount effect: with useState(false) the first
  // committed render would emit `<video src autoPlay loop>` and only then pull the
  // attributes, so a reduce-motion visitor has already started fetching both films.
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Off-screen: release both decoded resources — React props alone neither pause
  // an element nor abort its download, so pause() + removeAttribute("src") +
  // load() are all required. On the reduce edge, stop an autoplaying (muted) clip
  // but keep a source assigned so the sound button can still start it: reduced
  // motion disables autoplay, not voluntary playback.
  useEffect(() => {
    const videos = [refVideo.current, repVideo.current];
    if (!inView) {
      for (const video of videos) {
        if (!video) continue;
        video.pause();
        video.muted = true;
        video.removeAttribute("src");
        video.load();
      }
      // Reset the control's state too, so a card unmuted before it scrolled away
      // doesn't return reading "Sound on" over a paused, sourceless pair.
      setMuted(true);
      return;
    }
    if (reduced) {
      for (const video of videos) if (video && video.muted) video.pause();
    }
  }, [reduced, inView]);

  // Keep the replica (right) locked to the reference (left) clock. Attached
  // whenever the pair is in view — including under reduced motion — so that once
  // the reference starts (autoplay, or a voluntary press) the replica follows.
  useEffect(() => {
    const a = refVideo.current;
    const b = repVideo.current;
    if (!a || !b || !inView) return;

    const resync = () => {
      if (Number.isFinite(a.currentTime) && Math.abs((b.currentTime || 0) - a.currentTime) > 0.15) {
        try {
          b.currentTime = a.currentTime;
        } catch {}
      }
      if (a.paused && !b.paused) b.pause();
      if (!a.paused && b.paused) b.play().catch(() => {});
    };
    const onPlay = () => b.play().catch(() => {});
    const onPause = () => b.pause();

    a.addEventListener("timeupdate", resync);
    a.addEventListener("seeked", resync);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", resync);
      a.removeEventListener("seeked", resync);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, [reduced, inView]);

  // Start/pause both films together — the sync effect keeps the replica locked to
  // the reference clock once the reference is playing.
  const startBoth = () => {
    refVideo.current?.play().catch(() => {});
    repVideo.current?.play().catch(() => {});
  };
  const pauseBoth = () => {
    refVideo.current?.pause();
    repVideo.current?.pause();
  };

  const toggleSound = () => {
    const a = refVideo.current;
    if (!a) return;
    const next = !muted;
    setMuted(next);
    a.muted = next; // only the reference carries audio; replica stays silent
    if (!next) {
      startBoth(); // voluntary play — starts the whole pair, incl. under reduced motion
    } else if (reduced) {
      pauseBoth(); // no autoplay to fall back to under reduced motion
    }
  };

  const active = inView && !reduced;

  const card =
    "overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
  const video = "aspect-video w-full object-cover bg-zinc-100 dark:bg-zinc-900";
  const cap = "text-xs font-semibold uppercase tracking-wide";

  return (
    <div ref={wrapRef}>
      <div className="mb-3 flex items-baseline justify-between">
        <strong className="text-sm">{title}</strong>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{meta}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={`relative ${card}`}>
          <video
            ref={refVideo}
            className={video}
            src={inView ? refSrc : undefined}
            poster={refPoster}
            autoPlay={active}
            muted={muted}
            loop={active}
            playsInline
            preload="none"
          />
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={!muted}
            aria-label={
              muted
                ? reduced
                  ? "Sound off — play the comparison with sound"
                  : "Sound off — unmute the reference"
                : reduced
                  ? "Sound on — pause the comparison"
                  : "Sound on — mute the reference"
            }
            className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {muted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
            )}
            {muted ? "Sound off" : "Sound on"}
          </button>
          <div className="p-3">
            <span className={`${cap} text-zinc-500 dark:text-zinc-400`}>Reference — original film</span>
          </div>
        </div>
        <div className={card}>
          <video
            ref={repVideo}
            className={video}
            src={inView ? replicaSrc : undefined}
            poster={replicaPoster}
            autoPlay={active}
            muted
            loop={active}
            playsInline
            preload="none"
          />
          <div className="p-3">
            <span className={`${cap} text-zinc-700 dark:text-zinc-300`}>HyperFrames replica</span>
          </div>
        </div>
      </div>
    </div>
  );
};
