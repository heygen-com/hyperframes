/**
 * The homepage's showcase on a docs page: two rows of films made with HyperFrames, drifting in opposite directions.
 * As on the homepage (web-marketing HyperFramesShowcase), a row can be dragged, swiped sideways on a trackpad or moved
 * with shift+wheel, and keyboard focus brings a card into view. The card nearest the middle plays its 720p copy, the
 * others show their poster; a click opens the full film with sound. Reduced motion holds the rows still on their
 * posters and lets them scroll natively.
 */
export const FilmRows = () => {
  // Keep data inside the component: Mintlify compiles only the named export.
  const CDN = "https://static.heygen.ai/hyperframes-oss";
  const film = (id, kind, name, ar) => ({
    kind,
    name,
    ar,
    src: `${CDN}/homepage/showcase/card/${id}-v1.mp4`,
    hq: `${CDN}/homepage/showcase/hq/${id}-v1.mp4`,
    poster: `${CDN}/homepage/showcase/poster/${id}-v1.jpg`,
  });
  const launch = `${CDN}/site/studio-launch-nib-sf-audio`;
  const rows = [
    [
      { ...film("studio-launch", "Launch film", "Studio launch", 16 / 9), hq: `${launch}.mp4`, poster: `${launch}-poster.jpg` },
      film("vfx-billboard-hoodie-handoff", "VFX", "Out of the billboard", 9 / 16),
      film("frameys-opening-night", "Awards trailer", "Opening night", 16 / 9),
      film("jake-taycan-bricks", "3D build", "Jake & the Taycan", 1),
      film("cartoon-frameys-launch-one-take", "Cartoon", "The Frameys", 16 / 9),
      film("k", "Explainer", "The journey of “k”", 9 / 16),
      film("real-ui-newspaper-1969", "Real UI", "Men walk on the Moon", 16 / 9),
      film("launch-storyboard-first", "Product launch", "Storyboard first", 16 / 9),
      film("captions", "Captions", "Don’t tell my clients", 4 / 5),
      film("manga-last-onigiri", "Manga", "The last onigiri", 16 / 9),
      film("square-one-strudel", "Live-coded music", "Square one", 1),
      film("vfx-background-removal-launch", "VFX", "Background removal", 16 / 9),
      film("sitcom", "Sitcom", "Two lines", 9 / 16),
      film("just-html", "Explainer", "It’s just HTML", 16 / 9),
      film("kinetic-type-curiosity", "Kinetic type", "Going through a change", 4 / 3),
      film("home", "Many looks", "This homepage", 16 / 9),
      film("wordmark-sting", "Logo sting", "Wordmark", 1),
      film("session-story", "Cartoon", "Jake’s favorite agent", 16 / 9),
      film("launch-claude-motion", "Square", "Claude Motion", 1),
      film("real-ui-google-search", "Real UI", "How do cameras focus", 16 / 9),
      film("muybridge-horse-styles", "Style study", "One horse, many looks", 32 / 9),
      film("rackrats", "Cartoon", "Rackrats", 16 / 9),
    ],
    [
      film("tutorial-wenbo-studio-tutorial-talkinghead", "Tutorial", "Reference any video", 16 / 9),
      film("axe", "3D tutorial", "Axe chop", 9 / 16),
      film("framey-orby-halloween", "Cartoon", "Halloween party", 16 / 9),
      film("cow", "Launch parody", "Cow 1.0", 16 / 9),
      film("ascii-sharks-logo", "Logo sting", "ASCII sharks", 16 / 9),
      film("vfx-giant-keyboard-reel", "VFX", "Giant keyboard", 9 / 16),
      film("real-ui-wikipedia", "Real UI", "Wikipedia", 16 / 9),
      film("launch-heygen-video1", "AI footage", "HeyGen Video 1", 16 / 9),
      film("pixel-game-one-canvas", "Code tutorial", "A game in one canvas", 16 / 9),
      film("demo", "Talking head", "Tool demo", 9 / 16),
      film("everything-was-written", "Motion design", "Everything was written", 16 / 9),
      film("launch", "Kinetic type", "Keynote line", 16 / 9),
      film("remotion-to-hyperframes", "3D voxel", "Remotion to HyperFrames", 16 / 9),
      film("explainer-code2video-bench", "Presenter", "Code2Video Bench", 16 / 9),
      film("real-ui-cctv", "Real UI", "CCTV tracking", 16 / 9),
      film("frameys-felt-party", "3D characters", "The Frameys dance", 16 / 9),
      film("launch-moments-catalog", "Product launch", "Moments catalog", 16 / 9),
      film("shards-logo-reveal", "Logo reveal", "Shards", 16 / 9),
      film("launch-hyperframes-studio-intro", "Product reveal", "Studio intro", 16 / 9),
      film("studio-launch-pixel", "Launch film", "A launch video in 6 hours", 16 / 9),
      film("youtube-online-business", "YouTube edit", "Online business story", 16 / 9),
      film("website-to-launch", "Product launch", "From your website", 16 / 9),
      film("generative-replica", "Generative art", "Code is a material", 16 / 9),
    ],
  ];

  const rootRef = useRef(null);
  const dialogRef = useRef(null);
  const [open, setOpen] = useState(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Known on the first render, so nothing loads or moves before the preference is read.
  const [still, setStill] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const follow = (event) => setStill(event.matches);
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  // A card loads its file only near the screen, and one plays at a time, the one nearest the middle: with two 720p
  // films playing, Chrome drops the whole page from 120 to 30 fps (measured 2026-10-26), drift or not.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Reduce Motion turned on mid-visit: stop every film and let go of its file.
    if (still) {
      for (const v of root.querySelectorAll("video[data-src]")) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
      return;
    }
    const near = new Set();
    const seen = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) {
          if (!target.src) target.src = target.dataset.src;
          near.add(target);
        } else if (target.src) {
          near.delete(target);
          target.pause();
          target.removeAttribute("src");
          target.load();
        }
      }
    }, { rootMargin: "100px" });
    for (const v of root.querySelectorAll("video[data-src]")) seen.observe(v);
    const pick = () => {
      const mid = window.innerWidth / 2;
      const centre = (v) => { const r = v.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - mid); };
      // Paused rows, or a full film open in the dialog: no preview plays.
      // A film playing with sound anywhere on the page (a chosen remix, a replica pair) also rests the previews.
      const filmWithSound = [...document.querySelectorAll("video")].some((v) => !v.paused && !v.muted);
      const resting = root.classList.contains("is-paused") || root.dataset.watching === "true" || filmWithSound;
      const first = resting ? null : [...near].sort((a, b) => centre(a) - centre(b))[0];
      for (const v of near) {
        if (v === first) v.play().catch(() => {});
        else v.pause();
      }
    };
    const tick = setInterval(pick, 1000);
    return () => { seen.disconnect(); clearInterval(tick); };
  }, [still]);

  // Each row drifts by a transform the script moves (seconds per loop: 90 and 105), so a hand can move it too.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || still) return;
    const ac = new AbortController();
    const on = { signal: ac.signal };
    const stops = [...root.querySelectorAll(".hf-film-track")].map((row, r) => {
      const dir = r ? 1 : -1;
      const seconds = r ? 105 : 90;
      let x = 0;
      let fling = 0;
      let last = 0;
      let raf = 0;
      let moved = 0;
      let focused = false;
      let drag = null;
      // one loop = from a card to its twin in the second copy, gap included
      const period = () => {
        const cards = row.children;
        return cards[cards.length / 2].offsetLeft - cards[0].offsetLeft;
      };
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const loop = period();
        if (!drag?.on) {
          x += fling;
          fling = Math.abs(fling) < 0.05 ? 0 : fling * 0.86;
          if (!pausedRef.current && !focused) x += (loop / seconds) * dt;
        }
        x = ((x % loop) + loop) % loop;
        row.parentElement.scrollLeft = 0; // focus may scroll the clipped row; the transform alone places it
        row.style.transform = `translateX(${(dir < 0 ? -x : x - loop).toFixed(1)}px)`;
        raf = requestAnimationFrame(tick);
      };
      // only animates on screen
      const seen = new IntersectionObserver(([entry]) => {
        cancelAnimationFrame(raf);
        if (entry.isIntersecting) {
          last = performance.now();
          raf = requestAnimationFrame(tick);
        }
      });
      seen.observe(row);
      // a keyboard-focused card holds the row still, centred
      row.addEventListener("focusin", (e) => {
        if (!e.target.matches(":focus-visible")) return;
        focused = true;
        const into = (row.parentElement.clientWidth - e.target.offsetWidth) / 2;
        const shift = Math.max(0.5, e.target.offsetLeft - into);
        x = dir < 0 ? shift : period() - shift;
      }, on);
      row.addEventListener("focusout", () => (focused = false), on);
      // a press is a click until it moves 6px; then the row takes the pointer and becomes a drag
      row.addEventListener("pointerdown", (e) => {
        drag = { x: e.clientX, x0: x, id: e.pointerId, on: false };
        moved = 0;
        fling = 0;
      }, on);
      row.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        moved = Math.max(moved, Math.abs(dx));
        if (!drag.on && moved > 6) {
          drag.on = true;
          row.setPointerCapture(drag.id);
          row.classList.add("is-dragging");
        }
        if (drag.on) x = drag.x0 + dx * dir;
      }, on);
      const end = () => {
        drag = null;
        row.classList.remove("is-dragging");
      };
      window.addEventListener("pointerup", end, on);
      window.addEventListener("pointercancel", end, on);
      row.addEventListener("lostpointercapture", end, on);
      // the click that ends a drag doesn't open a film; Enter and Space (detail 0) always do
      row.addEventListener("click", (e) => {
        if (e.detail > 0 && moved > 6) {
          e.stopPropagation();
          e.preventDefault();
        }
        moved = 0;
      }, { capture: true, signal: ac.signal });
      // a sideways swipe or shift+wheel moves the row; a plain vertical wheel still scrolls the page
      row.addEventListener("wheel", (e) => {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
        if (!d) return;
        e.preventDefault();
        fling += d * -dir;
      }, { passive: false, signal: ac.signal });
      return () => {
        cancelAnimationFrame(raf);
        seen.disconnect();
        row.style.transform = "";
      };
    });
    return () => {
      ac.abort();
      for (const stop of stops) stop();
    };
  }, [still]);

  useEffect(() => {
    if (paused) for (const v of rootRef.current?.querySelectorAll("video") ?? []) v.pause();
  }, [paused]);

  // While a full film plays in the dialog, the previews stop, so only one film plays at a time.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.dataset.watching = open ? "true" : "false";
    if (open) for (const v of root.querySelectorAll("video[data-src]")) v.pause();
  }, [open]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const card = (f, i, twin) => (
    <button
      type="button"
      key={(twin ? "t" : "") + i}
      className="hf-film-card"
      style={{ aspectRatio: String(f.ar) }}
      aria-hidden={twin ? "true" : undefined}
      tabIndex={twin ? -1 : 0}
      onClick={() => setOpen(f)}
      aria-label={`${f.kind}: ${f.name}. Watch with sound`}
    >
      <video data-src={f.src} poster={f.poster} muted loop playsInline preload="none" />
      <span className="hf-film-label"><b>{f.kind}</b> {f.name}</span>
    </button>
  );

  return (
    <div className={"hf-film-rows not-prose" + (paused ? " is-paused" : "")} ref={rootRef}>
      {rows.map((row, r) => (
        <div className={"hf-film-row" + (r ? " is-reverse" : "")} key={r}>
          <div className="hf-film-track">
            {row.map((f, i) => card(f, i, false))}
            {row.map((f, i) => card(f, i, true))}
          </div>
        </div>
      ))}
      {/* WCAG 2.2.2: rows that move on their own get a way to stop them. Reduced motion never moves them, so no button */}
      {!still && (
        <button type="button" className="hf-film-pause" aria-pressed={paused} onClick={() => setPaused(!paused)}>
          {paused ? "Play" : "Pause"}
        </button>
      )}
      <dialog ref={dialogRef} className="hf-film-dialog" onClose={() => setOpen(null)} onClick={(e) => { if (e.target === dialogRef.current) setOpen(null); }}>
        {open && (
          <div>
            <video src={open.hq} poster={open.poster} controls autoPlay playsInline />
            <div className="hf-film-dialog-bar">
              <span><b>{open.kind}</b> {open.name} · made with HyperFrames</span>
              <button type="button" onClick={() => setOpen(null)}>Close</button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
};
