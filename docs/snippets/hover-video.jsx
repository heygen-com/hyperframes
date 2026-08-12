export const HoverVideo = ({ src, poster, className, hasAudio = true }) => {
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);

  // Lazy initializer, not a post-mount effect: the preference is known on the
  // first committed render, so a reduce-motion visitor never autoplays first.
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

  // A source is assigned whenever the card is near the viewport, but with
  // preload="none" the browser fetches nothing until playback is requested — so
  // offscreen cards don't download, yet a reduced-motion visitor can still press
  // play. IntersectionObserver just tracks the in/out transition.
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

  // Off-screen: release the decoded resource — React props alone neither pause an
  // element nor abort its download, so pause() + removeAttribute("src") + load().
  // On the reduce edge, stop a clip that was autoplaying (still muted) but leave a
  // deliberate playback alone: reduced motion disables autoplay, not voluntary play.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!inView) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      setMuted(true);
      setPlaying(false);
      return;
    }
    if (reduced && video.muted) video.pause();
  }, [inView, reduced]);

  const start = () => {
    const video = videoRef.current;
    if (video) video.play().catch(() => {});
  };
  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = !muted;
    setMuted(next);
    video.muted = next;
    if (!next) start(); // voluntary playback — allowed under reduced motion
  };
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) start();
    else video.pause();
  };

  const autoplaying = inView && !reduced;
  const icon = (paths) => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths}
    </svg>
  );

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className ?? ""}`}>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={inView ? src : undefined}
        poster={poster}
        autoPlay={autoplaying}
        muted={muted}
        loop={autoplaying}
        playsInline
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onMouseEnter={() => {
          if (hasAudio && !reduced && muted) toggleSound();
        }}
        onMouseLeave={() => {
          if (hasAudio && !muted) toggleSound();
        }}
      />
      <button
        type="button"
        onClick={(e) => {
          // Cards can be wrapped in an <a> (source link) — keep the control's
          // click (mouse or keyboard) from bubbling up and navigating away.
          e.preventDefault();
          e.stopPropagation();
          (hasAudio ? toggleSound : togglePlay)();
        }}
        aria-pressed={hasAudio ? !muted : playing}
        aria-label={
          hasAudio
            ? muted
              ? reduced
                ? "Play this preview with sound"
                : "Unmute this preview"
              : "Mute this preview"
            : playing
              ? "Pause this preview"
              : "Play this preview"
        }
        className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur transition hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {hasAudio
          ? muted
            ? icon(<><path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>)
            : icon(<><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>)
          : playing
            ? icon(<><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>)
            : icon(<polygon points="5 3 19 12 5 21 5 3" />)}
        {hasAudio ? (muted ? "Sound" : "On") : playing ? "Pause" : "Play"}
      </button>
    </div>
  );
};
