/**
 * Four always-visible next steps for people who already have a project.
 *
 * The videos are proof, not controls: every destination remains a normal link.
 */
export const AdvancedPathGrid = () => {
  const CDN = "https://static.heygen.ai/hyperframes-oss/docs/images/showcase";
  const paths = [
    {
      title: "Direct the agent better",
      detail: "Change the story, source material, or several scenes with one clear revision.",
      action: "Give better direction",
      href: "/prompting/overview",
      video: "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/go-further-agent-revision-loop-v1.mp4",
      poster: "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/go-further-agent-revision-loop-v1.jpg",
    },
    {
      title: "Edit in Studio",
      detail: "Change visible design, text, media, timing, and animation in the live project.",
      action: "Open the Studio guide",
      href: "/studio",
      video: `${CDN}/studio-direct-edit-loop-v2.mp4`,
      poster: `${CDN}/studio-direct-edit-loop-v2.jpg`,
    },
    {
      title: "Build richer compositions",
      detail: "Add project media and reusable Catalog scenes before adapting them to your work.",
      action: "Use Assets and Catalog",
      href: "/studio/assets-and-blocks",
      video: "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/studio-assets-catalog-loop-v1.mp4",
      poster: "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/studio-assets-catalog-loop-v1.jpg",
    },
    {
      title: "Check, render, and share",
      detail:
        "Validate the project, render through Studio, an agent, or the CLI, and review the file.",
      action: "Finish the project",
      href: "/guides/export-and-share",
      video: `${CDN}/studio-check-render-loop-v2.mp4`,
      poster: `${CDN}/studio-check-render-loop-v2.jpg`,
    },
  ];
  // Lazy initializer, not a post-mount effect: with useState(false) the first
  // committed render emits <video src autoPlay loop> and only then drops the
  // attributes, so a reduce-motion visitor has already started fetching every
  // tile. autoPlay also overrides preload="metadata", and removing src without
  // a following load() is not a reliable abort. CSS cannot reach any of this.
  const gridRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // React can drop src/autoPlay/loop from the DOM, but neither pauses a playing
  // element nor aborts its selected resource: a media element keeps its current
  // resource until the load algorithm is re-invoked, and `autoplay` only governs
  // the first play. So a visitor who turns Reduce Motion on mid-session would
  // otherwise keep every tile playing and downloading. Stop them for real.
  useEffect(() => {
    if (!reducedMotion || !gridRef.current) return;
    for (const video of gridRef.current.querySelectorAll("video")) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, [reducedMotion]);

  return (
    <div
      ref={gridRef}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
        gap: "1rem",
        margin: "1.5rem 0",
      }}
    >
      {paths.map((path) => (
        <article
          key={path.href}
          style={{
            overflow: "hidden",
            border: "1px solid var(--border-color, rgba(128, 128, 128, 0.22))",
            borderRadius: "12px",
          }}
        >
          <video
            src={reducedMotion ? undefined : path.video}
            poster={path.poster}
            autoPlay={!reducedMotion}
            muted
            loop={!reducedMotion}
            playsInline
            preload="metadata"
            aria-hidden="true"
            style={{
              display: "block",
              width: "100%",
              aspectRatio: "16 / 9",
              objectFit: "cover",
              background: "#000",
              margin: 0,
            }}
          />
          <div style={{ padding: "0.9rem 1rem 1rem" }}>
            <strong style={{ display: "block", fontSize: "1rem", lineHeight: 1.35 }}>
              {path.title}
            </strong>
            <span
              style={{
                display: "block",
                marginTop: "0.35rem",
                fontSize: "0.875rem",
                lineHeight: 1.5,
                opacity: 0.72,
              }}
            >
              {path.detail}
            </span>
            <a
              href={path.href}
              style={{
                display: "inline-block",
                marginTop: "0.75rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {path.action} →
            </a>
          </div>
        </article>
      ))}
    </div>
  );
};
