export const CatalogOverviewPlayer = ({ title, children }) => {
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
  const catalogBase = localDocs
    ? "https://raw.githubusercontent.com/heygen-com/hyperframes/main/docs"
    : "";
  const assetBase = localDocs ? "https://hyperframes.heygen.com" : "";
  const scenes = JSON.stringify([
    {
      section: "Code Animations",
      catalog: "/public/catalog/blocks/code-particle-assemble.json",
      mediaStart: 1.7,
    },
    {
      section: "Captions",
      catalog: "/public/catalog/components/caption-camera-follow.json",
      mediaStart: 0.5,
    },
    {
      section: "HTML-in-Canvas",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/vfx-iphone-device.mp4",
      mediaStart: 9.25,
    },
    {
      section: "Social Overlays",
      catalog: "/public/catalog/blocks/editorial-flash-overlay.json",
      mediaStart: 0.35,
    },
    {
      section: "Lower Thirds",
      catalog: "/public/catalog/blocks/lower-third-bild.json",
      mediaStart: 0.5,
    },
    {
      section: "Shader Transitions",
      catalog: "/public/catalog/blocks/domain-warp-dissolve.json",
      mediaStart: 1.25,
    },
    {
      section: "CSS Transitions",
      catalog: "/public/catalog/blocks/transitions-grid.json",
      mediaStart: 4.3,
    },
    {
      section: "Showcases",
      catalog: "/public/catalog/blocks/ai-chat-reveal.json",
      mediaStart: 15.85,
    },
    {
      section: "Data",
      catalog: "/public/catalog/blocks/us-map-flow.json",
      mediaStart: 4,
    },
    {
      section: "Effects",
      catalog: "/public/catalog/components/parallax-unzoom.json",
      mediaStart: 1.6,
    },
    {
      section: "Blocks",
      catalog: "/public/catalog/blocks/hw-pipeline.json",
      mediaStart: 1.4,
    },
  ]).replace(/<\//g, "<\\/");
  const bootstrap = [
    "<!doctype html><html><head><meta charset='utf-8'>",
    "<style>html,body{margin:0;height:100%;overflow:hidden;background:#05070b}",
    "#stage,hyperframes-player{position:absolute;inset:0;display:block;width:100%;height:100%}",
    "#label{position:absolute;z-index:2;top:24px;left:24px;padding:10px 16px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(5,7,11,.82);color:#fff;font:700 18px/1.2 ui-sans-serif,system-ui,sans-serif;pointer-events:none}",
    "#error{position:absolute;z-index:3;inset:0;display:none;place-items:center;background:#05070b;color:#fff;font:600 18px ui-sans-serif,system-ui,sans-serif}</style>",
    // `latest`, not a pinned line. See the note in variables-explorer.jsx: a
    // pin here fails silently, because the page still works on the old build.
    '<script src="https://cdn.jsdelivr.net/npm/@hyperframes/player@latest/dist/hyperframes-player.global.js"></' +
      "script>",
    `</head><body><div id="stage"></div><div id="label"></div><div id="error">Preview unavailable</div><script>var scenes=${scenes};var reduced=${JSON.stringify(reduced)};var catalogBase=${JSON.stringify(catalogBase)};var assetBase=${JSON.stringify(assetBase)};var current=0;var request=0;`,
    "function videoComposition(scene){return \"<!doctype html><html><head><meta charset='utf-8'><style>html,body{width:1920px;height:1080px;margin:0;overflow:hidden;background:#05070b}video{width:100%;height:100%;object-fit:cover}</style></head><body><main data-composition-id='catalog-video' data-start='0' data-duration='15' data-width='1920' data-height='1080'><video id='catalog-video-media' src='\"+scene.video+\"' data-start='0' data-duration='15' muted playsinline></video></main><script>window.__timelines=window.__timelines||{};var media=document.querySelector('video');window.__timelines['catalog-video']={duration:function(){return 15},time:function(){return media.currentTime},seek:function(t){media.currentTime=t;return this},play:function(){media.play();return this},pause:function(){media.pause();return this}};</\"+\"script></body></html>\"}",
    "async function compositionFor(scene){if(scene.catalog){var response=await fetch(catalogBase+scene.catalog);if(!response.ok)throw new Error('Catalog '+response.status);var html=(await response.json()).html;if(assetBase)html=html.replace('<head>','<head><base href=\"'+assetBase+'/\">');return html}return videoComposition(scene)}",
    "async function show(index){var token=++request;var scene=scenes[index];try{var html=await compositionFor(scene);if(token!==request)return;var player=document.createElement('hyperframes-player');player.setAttribute('srcdoc',html);player.setAttribute('controls','');player.setAttribute('muted','');player.addEventListener('ready',function(){player.seek(scene.mediaStart||0);if(!reduced)player.play()},{once:true});document.getElementById('stage').replaceChildren(player);document.getElementById('label').textContent=scene.section;document.getElementById('error').style.display='none'}catch(error){if(token===request){document.getElementById('label').textContent=scene.section;document.getElementById('error').style.display='grid'}}}",
    "show(0);if(!reduced)setInterval(function(){current=(current+1)%scenes.length;show(current)},2500);",
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
        <iframe
          srcDoc={bootstrap}
          className="block aspect-video w-full rounded-xl bg-zinc-950"
          title={title}
        />
      </div>
      <div hidden={tab !== "code"}>{children}</div>
    </div>
  );
};
