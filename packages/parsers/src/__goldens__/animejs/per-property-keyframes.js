const tl = anime.createTimeline({ autoplay: false });
tl.add(".chip", { scale: [{ to: 1.2, duration: 200 }, { to: 1, duration: 300, ease: "outBack" }], opacity: [0, 1] }, 0);
hyperframesAnime.register("chip", tl);
