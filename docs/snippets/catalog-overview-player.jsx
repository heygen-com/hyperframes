export const CatalogOverviewPlayer = ({ src, poster, title, children }) => {
  const [tab, setTab] = useState("preview");
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

  const localDocs =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const playbackSrc = localDocs ? "/images/showcase/catalog-overview-v3.mp4" : src;
  const playbackPoster = localDocs ? "/images/showcase/catalog-overview-v3.jpg" : poster;

  const composition = [
    "<!doctype html><html><head><meta charset='utf-8'>",
    "<meta name='viewport' content='width=1920,height=1080'>",
    "<style>html,body{width:1920px;height:1080px;margin:0;overflow:hidden;background:#05070b}",
    "video{width:100%;height:100%;object-fit:cover}</style></head><body>",
    "<main data-composition-id='catalog-overview-v3' data-no-timeline data-start='0' data-duration='19.25' data-fps='60' data-width='1920' data-height='1080'>",
    `<video id="catalog-overview-v3" src="${playbackSrc}" data-start="0" data-duration="19.25" muted playsinline></video>`,
    "</main><script>",
    "window.__timelines=window.__timelines||{};",
    "window.__timelines['catalog-overview-v3']={",
    "duration:function(){return 19.25},time:function(){return document.querySelector('video').currentTime},",
    "seek:function(t){document.querySelector('video').currentTime=t;return this},",
    "play:function(){document.querySelector('video').play();return this},",
    "pause:function(){document.querySelector('video').pause();return this}};",
    "var media=document.querySelector('video');",
    "media.addEventListener('playing',function(){parent.postMessage({type:'catalog-overview-media',state:'playing'},'*')});",
    "media.addEventListener('error',function(){parent.postMessage({type:'catalog-overview-media',state:'error'},'*')});",
    "</" + "script></body></html>",
  ].join("");
  const serializedComposition = JSON.stringify(composition).replace(/<\//g, "<\\/");

  const bootstrap = [
    "<!doctype html><html><head><meta charset='utf-8'>",
    "<style>html,body{margin:0;height:100%;overflow:hidden;background:#05070b}",
    "#fallback{position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:contain;background:#05070b;pointer-events:none}",
    "hyperframes-player{position:absolute;inset:0;display:block;width:100%;height:100%}</style>",
    '<script src="https://cdn.jsdelivr.net/npm/@hyperframes/player@0.7/dist/hyperframes-player.global.js"></' +
      "script>",
    `</head><body><img id="fallback" src=${JSON.stringify(playbackPoster)} alt=""><script>`,
    "var player=document.createElement('hyperframes-player');",
    `player.setAttribute('srcdoc',${serializedComposition});`,
    `player.setAttribute('poster',${JSON.stringify(playbackPoster)});`,
    "player.setAttribute('controls','');player.setAttribute('muted','');",
    "player.setAttribute('autoplay','');player.setAttribute('loop','');",
    "document.body.appendChild(player);",
    "window.addEventListener('message',function(event){",
    "if(event.source!==player.iframeElement.contentWindow||event.data?.type!=='catalog-overview-media')return;",
    "document.getElementById('fallback').hidden=event.data.state==='playing';",
    "});",
    "</" + "script></body></html>",
  ].join("");

  return (
    <div className="not-prose my-4">
      <div className="mb-3 inline-flex gap-1 rounded-full border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950">
        {[
          ["preview", "Preview"],
          ["code", "HTML"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              tab === id
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-950"
                : "text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div hidden={tab !== "preview"}>
        {reduced ? (
          <img
            src={playbackPoster}
            alt={title}
            className="aspect-video w-full rounded-xl bg-zinc-950 object-cover"
          />
        ) : (
          <iframe
            srcDoc={bootstrap}
            className="block aspect-video w-full rounded-xl bg-zinc-950"
            title={title}
          />
        )}
      </div>
      <div hidden={tab !== "code"}>{children}</div>
    </div>
  );
};
