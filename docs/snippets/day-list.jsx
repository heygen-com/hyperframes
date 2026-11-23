export const DayList = ({ part }) => {
  // [part, day, title, post id, account, film file, one line]
  const days = [
    [0, 1, "Install HyperFrames", "2074176916819685648", "HeyGen", "01", "Give your coding agent the HyperFrames skills. One router reads the request and picks the workflow."],
    [0, 2, "Give your brand a motion language", "2074574265714905167", "HeyGen", "02", "Turn a visual identity into reusable motion direction, written down once as `FRAME.md` and read on every later build."],
    [0, 3, "PR-to-Video", "2074954182583554051", "HeyGen", "03-s", "Explain an open pull request as a short video."],
    [0, 4, "Music-to-Video", "2075262117964615956", "HeyGen", "04-s", "Build a video around a track and its beat."],
    [0, 5, "Faceless explainer", "2075682104302882908", "HeyGen", "05-s", "Turn a topic into a designed explainer without footage. The visuals are invented per scene."],
    [0, 6, "Talking-head recut", "2075998619325604238", "HeyGen", "06-s", "Add synchronized graphics to an existing speaker video. The source clip plays untouched underneath."],
    [0, 7, "Motion graphics", "2076381187640324427", "HeyGen", "07", "Make a short, design-led animation where the motion carries the message."],
    [0, 8, "Music and SFX with the HeyGen CLI", "2076719036742922504", "HeyGen", "08-s", "Find and use audio from the command line, then let the mix duck itself under the narration."],
    [0, 9, "Figma to HyperFrames", "2077072141309382770", "HeyGen", "09", "Turn an existing design into a video composition — as live HTML, not a flattened export."],
    [1, 10, "Anatomy of a prompt", "2077438104982667282", "HeyGen", "10", "Structure a request so the agent gets the important intent right the first time."],
    [1, 11, "Repurpose an existing video", "2077798995762823593", "HeyGen", "11-s", "Extract useful patterns from a reference instead of describing them from memory."],
    [1, 12, "Dynamic captions", "2078190361932103716", "HeyGen", "12-s", "Make captions part of the visual design rather than a track laid on top."],
    [1, 13, "Studio preview, part 1", "2078589328562016559", "HeyGen", "13", "Inspect a composition before rendering — in the browser editor, through your agent, or from the terminal."],
    [1, 14, "Studio preview, part 2: keyframes", "2078945075787452660", "HeyGen", "14", "Adjust motion with visible keyframe controls, one lane per animated property."],
    [1, 15, "Sample the web", "2079251321484722675", "HeyGen", "15", "Bring useful web motion into a composition by capturing the real page."],
    [1, 16, "Media use", "2079609229737111978", "HeyGen", "16-s", "Work with the available asset libraries, and control how each one crops and fits."],
    [1, 17, "Storyboard", "2080012076454719554", "HeyGen", "17-s", "Agree on the sequence before building every scene, so revisions land on the plan rather than the render."],
    [1, 18, "HyperFrames in Video Agent", "2080407266755510452", "HeyGen", "18-s", "Create with HyperFrames inside HeyGen Video Agent."],
    [1, 19, "Background removal", "2080762012330807438", "HeyGen", "19-s", "Use alpha channels to layer subjects into a scene, with the matte holding while the subject moves."],
    [2, 20, "Claude Design", "2081184676430160379", "HyperFrames_", "20", "Take a design direction into a HyperFrames project without redrawing it by hand."],
    [2, 21, "Cloud rendering", "2081491370485952790", "HyperFrames_", "21", "Render without making one local computer the bottleneck. Two commands hand the job to the cloud."],
    [2, 22, "Components Catalog", "2081798071353278651", "HyperFrames_", "22-s", "Add reusable scenes and effects instead of rebuilding them each time."],
    [2, 23, "Templates and variables", "2082197435246600341", "HyperFrames_", "23-s", "Turn one composition into repeatable versions."],
    [2, 24, "Color grading", "2082536413829235004", "HyperFrames_", "24-s", "Correct or stylize images and footage in code, and bring your own LUT packs."],
    [2, 25, "Prompt Guide", "2082892893027749917", "HyperFrames_", "25-s", "Find practical language and examples for directing an agent. The written guide lives in these docs, at [Prompting overview](/prompting/overview)."],
    [2, 26, "Media effects and overlays", "2083324288632045910", "HyperFrames_", "26", "Add designed treatments to real media. Two to six authored colour ramps change the whole visual language."],
    [2, 27, "Deploy", "2083633492894900456", "HyperFrames_", "27-s", "Run rendering on your own cloud infrastructure. See [Deploy](/guides/deploy) for the four render routes."],
    [2, 28, "Contribute to the Catalog", "2084070152975634743", "HyperFrames_", "28-s", "Publish reusable building blocks for other creators. The [Catalog](/catalog) lists what has landed so far."],
    [2, 29, "Components update", "2084338269194732003", "HyperFrames_", "29-s", "Combine the expanded component set in a single project."]
  ];
  const CDN = "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/thirty-days-day-";
  // Inline `code` and [links](/path) in the one-liners.
  const rich = (text) =>
    text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/).map((bit, i) => {
      if (bit.startsWith("`")) return <code key={i}>{bit.slice(1, -1)}</code>;
      const link = bit.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      return link ? <a key={i} href={link[2]}>{link[1]}</a> : bit;
    });
  // Hover previews follow the visitor's reduced-motion setting, known on the first render. The film itself is a
  // button, so a keyboard or touch visitor can play and pause it on purpose; that is allowed under reduced motion.
  const listRef = useRef(null);
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [chosen, setChosen] = useState(null);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const follow = (event) => {
      setReduced(event.matches);
      // Turned on mid-visit: stop any hover preview that is running.
      if (event.matches) for (const v of listRef.current?.querySelectorAll("video") ?? []) if (v.dataset.hover) v.pause();
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  // One film at a time across the whole page, though each list (and every other player) is its own component: a film
  // started with sound is a deliberate choice, so when any video on the page starts playing unmuted, this list stops
  // its own films and lets go of its choice. Previews are muted and never evict anything.
  useEffect(() => {
    const onPlay = (event) => {
      const v = event.target;
      if (!(v instanceof HTMLVideoElement) || v.muted) return;
      for (const own of listRef.current?.querySelectorAll("video") ?? []) {
        if (own === v) continue;
        own.pause();
        own.muted = true;
      }
      setChosen((c) => (listRef.current?.querySelector(`[data-day="${c}"] video`) === v ? c : null));
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);
  const filmWithSound = () => [...document.querySelectorAll("video")].some((v) => !v.paused && !v.muted);
  const hover = (event, on) => {
    const video = event.currentTarget.querySelector("video");
    // While a film plays with sound anywhere on the page, rows don't preview.
    if (!video || chosen !== null || (on && filmWithSound())) return;
    if (on && !reduced) {
      video.dataset.hover = "1";
      video.play().catch(() => {});
    } else if (!on) {
      delete video.dataset.hover;
      video.pause();
      video.currentTime = 0;
    }
  };
  const toggle = (event, n) => {
    const video = event.currentTarget.querySelector("video");
    if (!video) return;
    if (chosen === n && !video.paused) {
      video.pause();
      video.muted = true;
      setChosen(null);
      return;
    }
    // A chosen film plays with its sound; its unmuted start stops every other film on the page (see onPlay).
    delete video.dataset.hover;
    video.muted = false;
    video.play().catch(() => {});
    setChosen(n);
  };
  return (
    <ol className="hf-days not-prose" ref={listRef}>
      {days.filter((d) => d[0] === part).map(([, n, title, post, account, file, line]) => (
        <li key={n} data-day={n} className="hf-day" onMouseEnter={(e) => hover(e, true)} onMouseLeave={(e) => hover(e, false)}>
          <span className="hf-day-n">{String(n).padStart(2, "0")}</span>
          <div className="hf-day-text">
            <a className="hf-day-title" href={`https://x.com/${account}/status/${post}`} target="_blank" rel="noopener">{title}</a>
            <p>{rich(line)}</p>
          </div>
          <button
            type="button"
            className="hf-day-play"
            aria-label={`${chosen === n ? "Pause" : "Play with sound:"} the day ${n} film`}
            aria-pressed={chosen === n}
            onClick={(e) => toggle(e, n)}
          >
            <video className="hf-day-film" src={`${CDN}${file}.mp4`} poster={`${CDN}${file.replace(/-s$/, "")}.jpg`} muted loop playsInline preload="none" />
          </button>
        </li>
      ))}
    </ol>
  );
};
