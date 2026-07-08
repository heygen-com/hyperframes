const gridTargets = [".tile-a", ".tile-b", ".tile-c"];
const tl = anime.createTimeline({ autoplay: false });
tl.add(gridTargets, { translateY: anime.stagger(20), opacity: [0, 1], duration: 500, ease: "outQuad" }, 0);
tl.add(".grid-caption", { opacity: [0, 1], duration: 250 }, "+=100");
hyperframesAnime.register("grid", tl);
