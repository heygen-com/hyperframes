const tl = anime.createTimeline({ autoplay: false });
tl.label("intro", 0);
tl.add(".hero", { opacity: [0, 1], duration: 300, ease: "outQuad" }, "intro");
tl.label("reveal", 400);
tl.set(".badge", { opacity: 1, translateX: 20 }, "reveal");
tl.add(".cta", { translateY: [30, 0], duration: 350, ease: "outCubic" }, "reveal+=100");
tl.label("outro", 900);
hyperframesAnime.register("labeled", tl, { labels: { intro: 0, reveal: 0.4, outro: 0.9 } });
