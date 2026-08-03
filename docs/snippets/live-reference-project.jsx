export const LiveReferenceProject = ({ src, poster }) => {
  const playerRef = useRef(null);
  const playerHostRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [compositionSrc, setCompositionSrc] = useState(null);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [title, setTitle] = useState("Example Domain");
  const [supportingLine, setSupportingLine] = useState(
    "For use in documentation examples without needing permission.",
  );
  const [accent, setAccent] = useState("#334488");

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return undefined;

    let cancelled = false;
    const markReady = () => {
      if (!cancelled) setPlayerReady(true);
    };

    if (window.customElements?.get("hyperframes-player")) {
      markReady();
      return () => {
        cancelled = true;
      };
    }

    let script = document.querySelector("script[data-hf-docs-player]");
    if (!script) {
      script = document.createElement("script");
      script.type = "module";
      script.src = "https://cdn.jsdelivr.net/npm/@hyperframes/player@0.7.90";
      script.dataset.hfDocsPlayer = "true";
      script.addEventListener("error", () => !cancelled && setLoadFailed(true), { once: true });
      document.head.appendChild(script);
    }

    window.customElements
      ?.whenDefined("hyperframes-player")
      .then(markReady)
      .catch(() => !cancelled && setLoadFailed(true));

    return () => {
      cancelled = true;
    };
  }, [mounted]);

  useEffect(() => {
    if (!playerReady || typeof window === "undefined") return undefined;

    const controller = new AbortController();
    let objectUrl;

    fetch(src, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Composition request failed: ${response.status}`);
        return response.text();
      })
      .then((html) => {
        const assetBase = new URL("../", src).toString();
        const preparedHtml = html.includes('<base href="../">')
          ? html.replace('<base href="../">', `<base href="${assetBase}">`)
          : html.replace("<head>", `<head><base href="${assetBase}">`);
        objectUrl = URL.createObjectURL(new Blob([preparedHtml], { type: "text/html" }));
        setCompositionSrc(objectUrl);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setLoadFailed(true);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [playerReady, src]);

  useEffect(() => {
    if (!playerReady || !compositionSrc || !playerHostRef.current) return undefined;
    const player = document.createElement("hyperframes-player");
    player.setAttribute("src", compositionSrc);
    player.setAttribute("controls", "");
    player.setAttribute("width", "1920");
    player.setAttribute("height", "1080");
    playerHostRef.current.replaceChildren(player);
    playerRef.current = player;

    return () => {
      playerRef.current = null;
      player.remove();
    };
  }, [compositionSrc, playerReady]);

  useEffect(() => {
    if (!playerReady) return undefined;
    const player = playerRef.current;
    if (!player) return undefined;

    const sendVariables = () => {
      player.iframeElement?.contentWindow?.postMessage(
        {
          type: "hyperframes-docs:variables",
          variables: { title, supportingLine, accent },
        },
        "*",
      );
    };

    player.addEventListener("ready", sendVariables);
    sendVariables();
    return () => player.removeEventListener("ready", sendVariables);
  }, [playerReady, title, supportingLine, accent]);

  const reset = () => {
    setTitle("Example Domain");
    setSupportingLine("For use in documentation examples without needing permission.");
    setAccent("#334488");
  };

  const playFromStart = () => {
    const player = playerRef.current;
    if (!player) return;
    setPreviewVisible(false);
    player.seek(0);
    player.play();
  };

  if (!mounted) {
    return (
      <button type="button" className="hf-live-reference-start" onClick={() => setMounted(true)}>
        <span aria-hidden="true">▶</span>
        <span>
          <strong>Load the live composition</strong>
          <small>Runs the actual editable HTML project in this page.</small>
        </span>
      </button>
    );
  }

  return (
    <div className="hf-live-reference">
      <div className="hf-live-reference-stage">
        {playerReady && compositionSrc ? (
          <>
            <div ref={playerHostRef} className="hf-live-reference-player-host" />
            {poster && previewVisible && (
              <button
                type="button"
                className="hf-live-reference-preview"
                onClick={playFromStart}
                aria-label="Play the live Reference Project"
                style={{ backgroundImage: `url(${poster})` }}
              >
                <span aria-hidden="true">▶</span>
              </button>
            )}
          </>
        ) : (
          <div className="hf-live-reference-loading" role="status">
            {loadFailed ? "The live project could not load." : "Loading the composition…"}
          </div>
        )}
      </div>

      <div className="hf-live-reference-controls" aria-label="Change the live composition">
        <label>
          <span>Headline</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={42} />
        </label>
        <label>
          <span>Supporting line</span>
          <input
            value={supportingLine}
            onChange={(event) => setSupportingLine(event.target.value)}
            maxLength={74}
          />
        </label>
        <fieldset>
          <legend>Accent</legend>
          <div>
            {["#334488", "#2f7d4f", "#a44b35", "#6b4fa1"].map((color) => (
              <button
                type="button"
                key={color}
                aria-label={`Use accent ${color}`}
                aria-pressed={accent === color}
                onClick={() => setAccent(color)}
                style={{ "--hf-live-accent": color }}
              />
            ))}
          </div>
        </fieldset>
        <button type="button" className="hf-live-reference-reset" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
};
