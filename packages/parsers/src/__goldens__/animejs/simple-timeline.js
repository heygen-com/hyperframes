const tl = anime.createTimeline({ autoplay: false, defaults: { ease: "outQuad" } });
tl.add(".hero", { opacity: [0, 1], translateX: 100, duration: 600, ease: "outCubic" }, 0);
tl.add(".subhead", { translateY: [20, 0], opacity: [0, 1], duration: 400 }, ">");
hyperframesAnime.register("simple", tl, { labels: { intro: 0 } });
