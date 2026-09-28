export const ExamplePlayer = ({ src, poster, title, className }) => {
  // Keep this bootstrap self-contained: Mintlify evaluates snippet exports only.
  const mount = (source, image) => {
    const fallback = document.createElement("video");
    fallback.controls = true;
    fallback.playsInline = true;
    fallback.preload = "metadata";
    fallback.poster = image || "";
    fallback.style.cssText = "display:block;width:100%;height:100%;object-fit:contain";
    document.body.appendChild(fallback);
    const upgrade = () => {
      if (!customElements.get("hyperframes-player") || !Number.isFinite(fallback.duration)) return;
      const width = fallback.videoWidth || 1920;
      const height = fallback.videoHeight || 1080;
      const composition = document.createElement("div");
      composition.setAttribute("data-composition-id", "example-film");
      composition.setAttribute("data-width", String(width));
      composition.setAttribute("data-height", String(height));
      composition.setAttribute("data-duration", String(fallback.duration));
      const clip = document.createElement("video");
      clip.src = source;
      clip.className = "clip";
      clip.setAttribute("data-start", "0");
      clip.setAttribute("data-duration", String(fallback.duration));
      clip.setAttribute("playsinline", "");
      clip.style.cssText = "width:100%;height:100%;object-fit:contain";
      composition.appendChild(clip);
      const player = document.createElement("hyperframes-player");
      player.setAttribute("controls", "");
      player.setAttribute("low-power-idle", "");
      player.setAttribute("width", String(width));
      player.setAttribute("height", String(height));
      if (image) player.setAttribute("poster", image);
      player.style.cssText = "position:absolute;inset:0;width:100%;height:100%;visibility:hidden";
      player.setAttribute("srcdoc", "<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%}body>div{width:100%;height:100%}</style></head><body>" + composition.outerHTML + "</body></html>");
      player.addEventListener("ready", () => {
        const resume = !fallback.paused;
        player.seek(fallback.currentTime);
        player.muted = fallback.muted;
        player.volume = fallback.volume;
        fallback.pause();
        fallback.removeAttribute("src");
        fallback.load();
        fallback.remove();
        player.style.visibility = "visible";
        if (resume) player.play();
      }, { once: true });
      document.body.appendChild(player);
    };
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@hyperframes/player@latest/dist/hyperframes-player.global.js";
    script.onload = () => {
      if (fallback.readyState >= 1) upgrade();
      else fallback.addEventListener("loadedmetadata", upgrade, { once: true });
    };
    document.head.appendChild(script);
    fallback.src = source;
  };
  const args = JSON.stringify([src, poster]).replace(/</g, "\\u003c");
  const html = "<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}</style>" +
    "</head><body><script>(" +
    mount.toString() + ")(..." + args + ");</" + "script></body></html>";
  return <iframe title={title} className={className} style={{ display: "block", width: "100%", aspectRatio: "16 / 9", border: 0 }} srcDoc={html} loading="lazy" allow="fullscreen" allowFullScreen />;
};
