// QA gallery only: autoplay + loop each hyperframes-player when it scrolls into
// view, pause when off-screen. Lets every candidate be watched without manually
// scrubbing 78 players, while keeping only the visible ones running so the page
// stays smooth. Not shipped; QA surface only.
(function () {
  function wire(p) {
    if (p.__hfLoopWired) return;
    p.__hfLoopWired = true;
    p.setAttribute("loop", "");
    // The native loop attribute does not reliably restart every composition
    // (some freeze on their end frame, e.g. an OUT phase that clears the stage),
    // so force it: the player exposes restart() = seek(0)+play().
    p.addEventListener("ended", function () {
      if (typeof p.restart === "function") {
        try {
          p.restart();
        } catch {}
      } else {
        try {
          if (typeof p.seek === "function") p.seek(0);
          if (typeof p.play === "function") p.play();
        } catch {}
      }
    });
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            p.setAttribute("autoplay", "");
            if (typeof p.play === "function") {
              try {
                p.play();
              } catch {}
            }
          } else if (typeof p.pause === "function") {
            try {
              p.pause();
            } catch {}
          }
        });
      },
      { threshold: 0.3 },
    );
    io.observe(p);
  }
  function scan() {
    document.querySelectorAll("hyperframes-player").forEach(wire);
  }
  if (!("customElements" in window)) return;
  customElements.whenDefined("hyperframes-player").then(function () {
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    setTimeout(scan, 800);
    setTimeout(scan, 2500);
  });
})();
