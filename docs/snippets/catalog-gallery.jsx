// Ported verbatim from a reference implementation of this catalog UX. Consumes
// catalog-gallery-data.mdx from scripts/sync-docs-catalog.mjs.
export const CatalogGallery = ({ catalog, initialGroup = "", initialSection = "" }) => {
    // Mintlify's snippet bundler only preserves the exported binding's own closure;
    // sibling top-level const/function declarations in this file are dropped from the
    // deployed build, so these must live inside the component (window.__hfDocsPlayerLoading
    // still dedupes the actual script load across every instance).
    // Each item's card: a short muted loop and its poster, at card size (480 px), from scripts/generate-catalog-previews.ts.
    const CARD_BASE = 'https://static.heygen.ai/hyperframes-oss/docs/images/catalog-card';
    const PAUSE_KEY = 'hfc-previews-paused';
    // Keep the child component type stable when gallery hover state changes.
    const MotionWord = useMemo(() => function MotionWord() {
        const root = useRef(null);
        useEffect(() => {
            const node = root.current;
            const media = matchMedia('(prefers-reduced-motion: reduce)');
            let observer, frame = 0, animations = [];
            let visible = true, previous = 0, elapsed = 0;
            const circle = [0, -10, 5.52, -10, 10, -5.52, 10, 0, 10, 5.52, 5.52, 10, 0, 10, -5.52, 10, -10, 5.52, -10, 0, -10, -5.52, -5.52, -10, 0, -10];
            const spark = [0, -17, 1.6, -7, 7, -1.6, 17, 0, 7, 1.6, 1.6, 7, 0, 17, -1.6, 7, -7, 1.6, -17, 0, -7, -1.6, -1.6, -7, 0, -17];
            const pathAt = m => { const a = circle.map((n, i) => n + (spark[i] - n) * m); return 'M' + a.slice(0, 2).join(' ') + 'C' + a.slice(2).join(' ') + 'Z'; };
            const setup = () => {
                cancelAnimationFrame(frame);
                animations.forEach(a => a.cancel());
                animations = [];
                node.style.setProperty('--phase', 0);
                node.querySelector('.dot').setAttribute('d', pathAt(0));
                if (media.matches)
                    return;
                const duration = 5600;
                node.querySelectorAll('.ch').forEach((letter, i) => {
                    animations.push(letter.animate([
                        { transform: 'translateY(0) rotate(0) skewX(0)', offset: 0 },
                        { transform: `translateY(-18%) rotate(${i % 2 ? 6 : -6}deg)`, offset: .05 },
                        { transform: 'translateY(4%) rotate(0)', offset: .12 },
                        { transform: 'translateY(-2%)', offset: .19 },
                        { transform: 'translateY(0) skewX(0)', offset: .3 },
                        { transform: 'skewX(0)', offset: .43 },
                        { transform: 'skewX(-12deg)', offset: .47 },
                        { transform: 'skewX(2deg)', offset: .56 },
                        { transform: 'skewX(0)', offset: .7 },
                        { transform: 'translateY(0) rotate(0) skewX(0)', offset: 1 }
                    ], { duration, delay: i * 60, iterations: Infinity, easing: 'ease-in-out' }));
                });
                animations.push(node.querySelector('.jump').animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-45px)', offset: .09 }, { transform: 'translateY(0)', offset: .18 }, { transform: 'translateY(-7px)', offset: .22 }, { transform: 'translateY(0)', offset: .27 }, { transform: 'translateY(0)' }], { duration, iterations: Infinity, easing: 'ease-in-out' }));
                animations.push(node.querySelector('.ring').animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(.6)', offset: .13 }, { opacity: .9, transform: 'scale(.6)', offset: .14 }, { opacity: 0, transform: 'scale(3.8)', offset: .29 }, { opacity: 0 }], { duration, iterations: Infinity }));
                const line = node.querySelector('.sq path');
                line.style.strokeDasharray = '220';
                animations.push(line.animate([{ strokeDashoffset: 220 }, { strokeDashoffset: 220, offset: .43 }, { strokeDashoffset: 0, offset: .58 }, { strokeDashoffset: 0, offset: .72 }, { strokeDashoffset: -220, offset: .84 }, { strokeDashoffset: -220 }], { duration, iterations: Infinity, easing: 'ease-in-out' }));
                const tick = now => {
                    if (visible && !document.hidden) {
                        elapsed += previous ? Math.min(now - previous, 50) : 0;
                        const t = (elapsed % duration) / duration;
                        let morph = t < .43 ? 0 : t < .51 ? (t - .43) / .08 : t < .69 ? 1 : t < .77 ? 1 - (t - .69) / .08 : 0;
                        morph = morph * morph * (3 - 2 * morph);
                        const dot = node.querySelector('.dot');
                        dot.setAttribute('d', pathAt(morph));
                        dot.setAttribute('transform', 'rotate(' + (t < .43 ? 0 : Math.min((t - .43) / .34, 1) * 360) + ')');
                        node.style.setProperty('--phase', (elapsed % 9000) / 9000);
                    }
                    previous = now;
                    frame = requestAnimationFrame(tick);
                };
                frame = requestAnimationFrame(tick);
            };
            const measure = () => { const size = parseFloat(getComputedStyle(node).fontSize); node.style.setProperty('--period', node.offsetWidth * 1.7 / size); node.querySelectorAll('.ch').forEach(ch => ch.style.setProperty('--x', ch.offsetLeft / size)); };
            const resize = new ResizeObserver(measure);
            resize.observe(node);
            measure();
            document.fonts?.ready.then(measure);
            const visibility = () => animations.forEach(a => visible && !document.hidden ? a.play() : a.pause());
            observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; visibility(); });
            observer.observe(node);
            document.addEventListener('visibilitychange', visibility);
            media.addEventListener('change', setup);
            setup();
            return () => { cancelAnimationFrame(frame); animations.forEach(a => a.cancel()); observer.disconnect(); resize.disconnect(); media.removeEventListener('change', setup); document.removeEventListener('visibilitychange', visibility); };
        }, []);
        return React.createElement("span", { className: "mw", ref: root, "aria-label": "Motion", style: { '--grad': 'linear-gradient(100deg,#3ce6ac 0%,#7cc4ff 25%,#b48cff 50%,#ffb35c 75%,#3ce6ac 100%)' } },
            ['M', 'o', 't', 'ı', 'o', 'n'].map((letter, i) => React.createElement("span", { key: i, className: 'ch' + (i === 3 ? ' i' : ''), "aria-hidden": "true" },
                letter,
                i === 3 && React.createElement("svg", { className: "dsvg", viewBox: "-50 -50 100 100" },
                    React.createElement("circle", { className: "ring", r: "10", fill: "none", stroke: "#7cc4ff", strokeWidth: "2", opacity: "0" }),
                    React.createElement("g", { className: "jump" },
                        React.createElement("path", { className: "dot", d: "M0 -10C5.52 -10 10 -5.52 10 0C10 5.52 5.52 10 0 10C-5.52 10 -10 5.52 -10 0C-10 -5.52 -5.52 -10 0 -10Z", fill: "#7cc4ff" }))))),
            React.createElement("svg", { className: "sq", viewBox: "0 0 196 12", "aria-hidden": "true" },
                React.createElement("path", { d: "M2 6Q18 -2 34 6T66 6T98 6T130 6T162 6T194 6", fill: "none", stroke: "#7cc4ff", strokeWidth: "2.4", strokeLinecap: "round" })));
    }, []);
    const [filters, setFilters] = useState({ q: "", group: initialGroup, section: initialSection, kind: "", sort: "featured" });
    const [still, setStill] = useState(true);
    // the visitor's own stop for the looping previews (WCAG 2.2.2), remembered on this device
    const [paused, setPaused] = useState(false);
    const [limit, setLimit] = useState(24);
    const [expandedGroups, setExpandedGroups] = useState({});
    const resultsRef = useRef(null);
    useEffect(() => {
        const read = () => {
            const params = new URLSearchParams(window.location.search);
            setFilters({ q: params.get("q") || "", group: params.get("group") || initialGroup, section: params.get("section") || initialSection, kind: params.get("kind") || "", sort: params.get("sort") || "featured" });
            setLimit(24);
        };
        read();
        window.addEventListener("popstate", read);
        // still posters for visitors who asked for less motion or less data
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        const motion = () => setStill(query.matches || Boolean(navigator.connection?.saveData));
        motion();
        query.addEventListener("change", motion);
        try {
            setPaused(window.localStorage.getItem(PAUSE_KEY) === "1");
        }
        catch { }
        return () => { window.removeEventListener("popstate", read); query.removeEventListener("change", motion); };
    }, [initialGroup, initialSection]);
    // Every card on screen plays its loop. A video is decoded by the device's video hardware, so a screenful costs less
    // than one live composition did; the live one, with its controls, is on the item's page. A phone plays only the card
    // nearest the middle of the screen.
    useEffect(() => {
        const root = resultsRef.current;
        if (!root || still || paused)
            return;
        const phone = !matchMedia("(hover: hover) and (pointer: fine)").matches;
        const onScreen = new Set();
        let current = null;
        const stop = (host) => {
            const video = host.firstElementChild;
            if (!video)
                return;
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.remove();
            delete host.dataset.ready;
        };
        const play = (host) => {
            if (document.hidden)
                return;
            let video = host.firstElementChild;
            if (!video) {
                video = document.createElement('video');
                video.muted = true;
                video.loop = true;
                video.playsInline = true;
                video.tabIndex = -1;
                video.addEventListener('playing', () => { host.dataset.ready = 'true'; }, { once: true });
                // no loop for this item: its poster stays
                video.addEventListener('error', () => stop(host), { once: true });
                video.src = host.dataset.src;
                host.appendChild(video);
            }
            video.play().catch(() => { });
        };
        const pick = () => {
            let best = null, bestDistance = Infinity;
            onScreen.forEach((host) => {
                const r = host.getBoundingClientRect();
                const distance = Math.abs(r.top + r.height / 2 - innerHeight / 2);
                if (distance < bestDistance)
                    [best, bestDistance] = [host, distance];
            });
            if (best === current)
                return;
            if (current)
                stop(current);
            current = best;
            if (best)
                play(best);
        };
        const observer = new IntersectionObserver((entries) => {
            for (const { target, isIntersecting, intersectionRatio } of entries) {
                if (isIntersecting && intersectionRatio >= 0.25) {
                    onScreen.add(target);
                    if (!phone)
                        play(target);
                }
                else {
                    onScreen.delete(target);
                    stop(target);
                }
            }
            if (phone)
                pick();
        }, { threshold: 0.25 });
        const hosts = root.querySelectorAll('[data-preview-host]');
        hosts.forEach((host) => observer.observe(host));
        // the nearest card changes while scrolling between observer callbacks
        const timer = phone ? setInterval(pick, 500) : 0;
        const visibility = () => onScreen.forEach((host) => document.hidden ? host.firstElementChild?.pause() : (!phone || host === current) && play(host));
        document.addEventListener('visibilitychange', visibility);
        return () => {
            observer.disconnect();
            clearInterval(timer);
            document.removeEventListener('visibilitychange', visibility);
            hosts.forEach(stop);
        };
    }, [filters, limit, expandedGroups, still, paused, catalog]);
    const togglePaused = () => {
        const next = !paused;
        setPaused(next);
        try {
            window.localStorage.setItem(PAUSE_KEY, next ? "1" : "0");
        }
        catch { }
    };
    const update = (patch) => {
        const next = { ...filters, ...patch };
        setFilters(next);
        setLimit(24);
        const url = new URL(window.location.href);
        Object.entries(next).forEach(([key, value]) => {
            if (value && !(key === "sort" && value === "featured"))
                url.searchParams.set(key, value);
            else
                url.searchParams.delete(key);
        });
        window.history.replaceState(window.history.state, "", url);
    };
    const reset = () => update({ q: "", group: "", section: "", kind: "", sort: "featured" });
    const items = catalog?.items || [];
    const groups = catalog?.groups || [];
    const searching = Boolean(filters.q || filters.group || filters.section || filters.kind || filters.sort !== "featured");
    const words = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const ordered = (list) => [...list].sort((a, b) => filters.sort === "az" ? a.title.localeCompare(b.title) : (a.featured - b.featured) || Number(Boolean(b.poster)) - Number(Boolean(a.poster)) || Number(Boolean(b.video)) - Number(Boolean(a.video)) || a.title.localeCompare(b.title));
    const matches = ordered(items.filter((item) => {
        const text = [item.title, item.description, item.section, ...item.tags].join(" ").toLowerCase();
        return (!filters.group || item.group === filters.group) && (!filters.section || item.section === filters.section) && (!filters.kind || item.kind === filters.kind) && words.every((word) => text.includes(word));
    }));
    const caret = React.createElement("svg", { className: "hfc-caret", width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        React.createElement("path", { d: "m6 9 6 6 6-6" }));
    // eager: the posters above the fold (the pinned group) start immediately instead of queueing behind the page's prefetches.
    const cardBase = (item) => `${CARD_BASE}/${item.kind === "block" ? "blocks" : "components"}/${item.id}`;
    const card = (item, eager = false) => (React.createElement("a", { className: "hfc-card", href: item.href, key: item.href, "data-preview-mode": item.preview?.mode || "still" },
        React.createElement("div", { className: "hfc-media" },
            item.preview?.mode === "unsupported"
                ? React.createElement("div", { className: "hfc-fallback hfc-unsupported", "aria-hidden": "true" },
                    React.createElement("span", null, "Needs a browser flag"),
                    React.createElement("code", null, `chrome://flags/#${item.preview.flag}`))
                : React.createElement("div", { className: "hfc-fallback", "aria-hidden": "true", style: { display: "none" } },
                    React.createElement("span", null, item.section),
                    React.createElement("strong", null, item.title)),
            item.preview?.mode !== "unsupported" && React.createElement("img", { src: `${cardBase(item)}.jpg`, alt: `${item.title} preview`, loading: eager ? "eager" : "lazy", fetchPriority: eager ? "high" : undefined, decoding: "async", width: "480", height: "270", onError: (event) => { event.currentTarget.style.display = "none"; event.currentTarget.previousElementSibling.style.display = "flex"; } }),
            item.preview?.mode !== "unsupported" && React.createElement("div", { className: "hfc-preview-host", "data-preview-host": item.href, "data-src": `${cardBase(item)}.mp4`, "aria-hidden": "true" })),
        React.createElement("div", { className: "hfc-card-body" },
            React.createElement("div", { className: "hfc-card-title" },
                React.createElement("h3", null, item.title),
                item.status && React.createElement("span", { className: "hfc-status" }, item.status)),
            React.createElement("p", { className: "hfc-meta" }, [...(item.tech || []).filter(t => !/^GSAP/.test(t)).slice(0, 2), ...item.tags.slice(0, 2)].join(" · ") || item.section))));
    return (React.createElement("div", { className: "hfc-gallery not-prose" },
        React.createElement("section", { className: "hfc-hero", "aria-label": "Explore the catalog" },
            React.createElement("h1", null,
                React.createElement(MotionWord, null),
                " ready to install."),
            React.createElement("p", null, initialGroup ? `${matches.length} items. Preview a piece and open it to explore its controls, code, and installation.` : "Find the scene, caption, or finishing touch for your next video. Preview the motion, pick a favorite, and make it your own."),
            !still && React.createElement("button", { type: "button", className: "hfc-pause", "aria-pressed": paused, onClick: togglePaused }, paused ? "Play previews" : "Pause previews")),
        React.createElement("section", { className: "hfc-browser", "aria-label": "Browse catalog", ref: resultsRef }, searching ? React.createElement(React.Fragment, null,
            matches.length ? React.createElement("div", { className: "hfc-grid" }, matches.slice(0, limit).map((item) => card(item))) : React.createElement("div", { className: "hfc-empty" },
                React.createElement("h3", null, "No matches yet."),
                React.createElement("p", null, "Try a different search, or clear the filters to explore everything."),
                React.createElement("button", { type: "button", onClick: reset }, "Explore all items")),
            matches.length > limit && React.createElement("button", { className: "hfc-load", type: "button", onClick: () => setLimit(limit + 24) },
                "Show more ",
                React.createElement("span", null,
                    "(",
                    matches.length - limit,
                    " remaining)"))) : React.createElement("div", { className: "hfc-overview" }, groups.map((group) => React.createElement("section", { className: "hfc-collection", key: group.id, "aria-label": group.label },
            React.createElement("div", { className: "hfc-section-head" },
                React.createElement("h2", null, group.label),
                React.createElement("button", { type: "button", onClick: () => setExpandedGroups(previous => ({ ...previous, [group.id]: !previous[group.id] })), "aria-label": `${expandedGroups[group.id] ? "Show less" : `Show all ${group.count}`} ${group.label}`, "aria-expanded": Boolean(expandedGroups[group.id]), "aria-controls": `gallery-${group.id}` },
                    expandedGroups[group.id] ? "Show Less" : `Show All ${group.count}`,
                    " ",
                    caret)),
            React.createElement("div", { className: "hfc-grid", id: `gallery-${group.id}` }, ordered(items.filter((item) => item.group === group.id)).slice(0, expandedGroups[group.id] ? undefined : group.pinned ? 6 : 3).map((item) => card(item, group.pinned === true)))))))));
};
