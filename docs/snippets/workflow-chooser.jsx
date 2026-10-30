/**
 * The human workflow router.
 *
 * Every route begins with source material a person already recognizes. The
 * compact loops prove the kind of result before the click; the destination
 * guide carries the complete example and instructions.
 */
export const WorkflowChooser = () => {
  // Keep data inside the component. Mintlify compiles only the named export and
  // drops module-level constants from snippet files.
  const CDN = "https://static.heygen.ai/hyperframes-oss/docs/images/showcase";
  const routes = [
    {
      title: "Show a product or website",
      bring: "Bring a URL, launch brief, or product story.",
      href: "/guides/product-launch-video",
      video: `${CDN}/wfv2-product-launch.mp4`,
      poster: `${CDN}/wfv2-product-launch.jpg`,
    },
    {
      title: "Explain an idea",
      bring: "Bring notes, an article, a script, or one rough thought.",
      href: "/guides/faceless-explainer",
      video: `${CDN}/wfv2-explainer-v4.mp4`,
      poster: `${CDN}/wfv2-explainer.jpg`,
    },
    {
      title: "Work with existing footage",
      bring: "Bring a talking-head, interview, or podcast clip.",
      href: "/guides/captions-and-recuts",
      video: `${CDN}/wfv2-captions-v4.mp4`,
      poster: `${CDN}/wfv2-captions.jpg`,
    },
    {
      title: "Explain a pull request",
      bring: "Bring a GitHub pull request link.",
      href: "/guides/pr-to-video",
      video: `${CDN}/wfv2-pr.mp4`,
      poster: `${CDN}/wfv2-pr.jpg`,
    },
    {
      title: "Make a short motion graphic",
      bring: "Bring a message, number, quote, chart, or logo.",
      href: "/guides/motion-graphics",
      video: `${CDN}/wfv2-motion.mp4`,
      poster: `${CDN}/wfv2-motion.jpg`,
    },
    {
      title: "Make a 3D or animated piece",
      bring: "Bring an idea; it can be a character, an object, or a whole world.",
      href: "/guides/general-video",
      video: "https://static.heygen.ai/hyperframes-oss/homepage/showcase/card/axe-v1.mp4",
      poster: "https://static.heygen.ai/hyperframes-oss/homepage/showcase/poster/axe-v1.jpg",
    },
    {
      title: "Add VFX to footage",
      bring: "Bring a clip; cut the person out, put them in a billboard, change the world behind.",
      href: "/guides/remove-background",
      video: "https://static.heygen.ai/hyperframes-oss/homepage/showcase/card/vfx-background-removal-launch-v1.mp4",
      poster: "https://static.heygen.ai/hyperframes-oss/homepage/showcase/poster/vfx-background-removal-launch-v1.jpg",
    },
    {
      title: "Make something funny",
      bring: "Bring a joke: a parody, a skit, a meme.",
      href: "/guides/general-video",
      video: "https://static.heygen.ai/hyperframes-oss/homepage/showcase/card/cow-v1.mp4",
      poster: "https://static.heygen.ai/hyperframes-oss/homepage/showcase/poster/cow-v1.jpg",
    },
    {
      title: "Cut to music",
      bring: "Bring a track and any photos or video you want to use.",
      href: "/guides/music-to-video",
      video: `${CDN}/wfv2-music.mp4`,
      poster: `${CDN}/wfv2-music.jpg`,
    },
    {
      title: "Build a presentation",
      bring: "Bring an outline, pitch, report, or existing deck.",
      href: "/guides/slideshow",
      video: "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/wfv2-slideshow-v4.mp4",
      poster: "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/wfv2-slideshow.jpg",
    },
    {
      title: "Turn data into a video",
      bring: "Bring numbers, a spreadsheet, or places on a map.",
      href: "/prompting/data-and-maps",
      video: "https://static.heygen.ai/hyperframes-oss/docs/images/prompting/barrace-handdrawn.mp4",
      poster: "/public/images/workflows/data-video.jpg",
    },
    {
      title: "Add an AI presenter",
      bring: "Bring a script; a HeyGen avatar says it on screen.",
      href: "/guides/avatar-presenter",
      video: "https://static.heygen.ai/hyperframes-oss/docs/images/prompting/captions-anchor-rail-v2.mp4",
      poster: "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/avatar-presenter-caption-rail-v1.jpg",
    },
    {
      title: "Make any other video",
      bring: "Bring the outcome you want and whatever source material you have.",
      href: "/guides/general-video",
      video: `${CDN}/wfv2-general.mp4`,
      poster: `${CDN}/wfv2-general.jpg`,
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
    <div className="hf-workflow-routes" ref={gridRef}>
      {routes.map((route) => (
        <a
          key={route.title}
          href={route.href}
          aria-label={`${route.title}. ${route.bring}`}
          className="hf-workflow-route"
        >
          {/* A route without a preview renders no <video> at all. An empty
              video element draws a black rectangle, which reads as a broken
              tile rather than a route with no clip yet. */}
          {route.video ? (
            <video
              src={reducedMotion ? undefined : route.video}
              poster={route.poster}
              autoPlay={!reducedMotion}
              muted
              loop={!reducedMotion}
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
          ) : (
            <span className="hf-workflow-route-noclip" aria-hidden="true" />
          )}
          <span>
            <span className="hf-workflow-route-title">{route.title}</span>
            <span className="hf-workflow-route-copy">{route.bring}</span>
          </span>
        </a>
      ))}
    </div>
  );
};
