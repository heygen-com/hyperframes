export const CatalogOverviewLoop = ({ src, poster, title }) => {
  const videoRef = useRef(null);
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!reduced || !videoRef.current) return;

    const video = videoRef.current;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, [reduced]);

  return (
    <video
      ref={videoRef}
      aria-label={title}
      src={reduced ? undefined : src}
      poster={poster}
      autoPlay={!reduced}
      muted
      loop={!reduced}
      playsInline
      preload="metadata"
      className="aspect-video w-full rounded-xl bg-zinc-950 object-cover"
    />
  );
};
