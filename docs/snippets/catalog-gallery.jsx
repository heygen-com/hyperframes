// Ported verbatim from a reference implementation of this catalog UX. Consumes
// catalog-gallery-data.mdx from scripts/sync-docs-catalog.mjs.
export const CatalogGallery = ({ catalog, initialGroup = "", initialSection = "" }) => {
    // Mintlify's snippet bundler only preserves the exported binding's own closure;
    // sibling top-level const/function declarations in this file are dropped from the
    // deployed build, so these must live inside the component (window.__hfDocsPlayerLoading
    // still dedupes the actual script load across every instance).
    const PLAYER_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@hyperframes/player@latest/dist/hyperframes-player.global.js';
    const REST_SECONDS = 3;
    const MAX_DOM_PLAYERS = 6;
    const MAX_WEBGL_PLAYERS = 1;
    const READY_TIMEOUT_MS = 6000;
    async function ensurePlayerDefined() {
        if (customElements.get('hyperframes-player'))
            return;
        if (!window.__hfDocsPlayerLoading) {
            window.__hfDocsPlayerLoading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = PLAYER_SCRIPT_URL;
                script.onload = resolve;
                script.onerror = () => { script.remove(); delete window.__hfDocsPlayerLoading; reject(new Error('Player unavailable')); };
                document.head.appendChild(script);
            });
        }
        await window.__hfDocsPlayerLoading;
        await customElements.whenDefined('hyperframes-player');
    }
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
    const [active, setActive] = useState(null);
    const [reduced, setReduced] = useState(true);
    const [limit, setLimit] = useState(24);
    const [expandedGroups, setExpandedGroups] = useState({});
    const resultsRef = useRef(null);
    useEffect(() => {
        const read = () => {
            const params = new URLSearchParams(window.location.search);
            setFilters({ q: params.get("q") || "", group: params.get("group") || initialGroup, section: params.get("section") || initialSection, kind: params.get("kind") || "", sort: params.get("sort") || "featured" });
            setLimit(24);
            setActive(null);
        };
        read();
        window.addEventListener("popstate", read);
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
        const motion = () => { setReduced(query.matches || !pointer.matches || navigator.maxTouchPoints > 0); setActive(null); };
        const visibility = () => { if (document.hidden)
            setActive(null); };
        motion();
        query.addEventListener("change", motion);
        pointer.addEventListener("change", motion);
        document.addEventListener("visibilitychange", visibility);
        return () => { window.removeEventListener("popstate", read); query.removeEventListener("change", motion); pointer.removeEventListener("change", motion); document.removeEventListener("visibilitychange", visibility); };
    }, [initialGroup, initialSection]);
    // One effect owns the only active preview, including pending network requests.
    useEffect(() => {
        if (!active || reduced || document.hidden)
            return;
        const item = catalog.items.find(item => item.href === active);
        if (item?.preview?.mode !== 'video')
            return;
        const host = resultsRef.current?.querySelector(`[data-preview-host="${CSS.escape(active)}"]`);
        if (!host)
            return;
        let cancelled = false;
        let element;
        let timeout;
        const abort = new AbortController();
        const release = () => {
            clearTimeout(timeout);
            if (element) {
                element.pause();
                if (element.tagName === 'VIDEO') {
                    element.removeAttribute('src');
                    element.load();
                }
                element.remove();
                element = null;
            }
            delete host.dataset.ready;
        };
        const fail = () => {
            if (cancelled)
                return;
            cancelled = true;
            abort.abort();
            release();
            host.dataset.state = 'unavailable';
        };
        const show = () => {
            if (cancelled || !element)
                return;
            clearTimeout(timeout);
            host.dataset.ready = 'true';
            host.dataset.state = 'playing';
        };
        const start = async () => {
            host.dataset.state = 'loading';
            timeout = setTimeout(fail, 12000);
            try {
                element = document.createElement('video');
                element.muted = true;
                element.loop = true;
                element.playsInline = true;
                element.addEventListener('error', fail, { once: true });
                element.addEventListener('playing', show, { once: true });
                element.src = item.video;
                if (cancelled) {
                    release();
                    return;
                }
                element.setAttribute('inert', '');
                element.setAttribute('tabindex', '-1');
                element.setAttribute('aria-hidden', 'true');
                host.appendChild(element);
                element.play().catch(fail);
            }
            catch {
                if (!cancelled)
                    fail();
            }
        };
        // Avoid starting a composition while the pointer merely crosses the grid.
        const intent = setTimeout(start, 180);
        const observer = new IntersectionObserver(entries => {
            if (!cancelled && !entries[0]?.isIntersecting)
                setActive(current => current === active ? null : current);
        });
        observer.observe(host);
        return () => {
            cancelled = true;
            clearTimeout(intent);
            abort.abort();
            observer.disconnect();
            release();
            delete host.dataset.state;
        };
    }, [active, reduced, catalog]);
    // Player-mode cards mount whichever ones are near the viewport, rest paused at
    // REST_SECONDS, and only start playing on hover — unlike the single-active effect
    // above, several can be mounted at once, capped per tier so a WebGL-heavy row can't
    // blow the page's GPU memory budget.
    const capsRef = useRef({ dom: 0, webgl: 0 });
    const mountsRef = useRef(new Map());
    const hoveredRef = useRef(null);
    const promoteRef = useRef(() => { });
    useEffect(() => {
        if (reduced)
            return;
        const tierFor = (item) => item.preview.heavy ? 'webgl' : 'dom';
        const capFor = (tier) => tier === 'webgl' ? MAX_WEBGL_PLAYERS : MAX_DOM_PLAYERS;
        // Hosts in view that were refused for want of a slot; they take the next one freed.
        let waiting = new Map();
        // The one place a slot is given back. It only acts while the map still holds this exact
        // state, so a late error, a timeout after unmount, or the catch below cannot release twice.
        const release = (item, state) => {
            if (mountsRef.current.get(item.href) !== state)
                return;
            clearTimeout(state.readyTimer);
            state.player?.remove();
            capsRef.current[state.tier] -= 1;
            mountsRef.current.delete(item.href);
            const entries = [...waiting];
            const queued = [...entries.filter(([h]) => h === hoveredRef.current), ...entries.filter(([h]) => h !== hoveredRef.current)];
            waiting.clear();
            queued.forEach(([href, host]) => mount(host, catalog.items.find((i) => i.href === href)));
        };
        const unmount = (host, item) => {
            // Keyed by item.href, same as mount() below -- setHover() only ever has the
            // item, never the host node, so the map has to be addressable by href.
            waiting.delete(item.href);
            const state = mountsRef.current.get(item.href);
            if (!state)
                return;
            release(item, state);
            delete host.dataset.ready;
        };
        const mount = async (host, item) => {
            if (mountsRef.current.has(item.href))
                return;
            // The whole body is one try: a throw anywhere here (a bad tier, a missing cap
            // constant, a network failure) must log once and leave the titled placeholder in
            // place, never an empty box -- this is the exact shape of the bug that shipped.
            let state;
            try {
                const tier = tierFor(item);
                if (capsRef.current[tier] >= capFor(tier)) {
                    waiting.set(item.href, host); // over budget for this tier; mounts when a slot frees
                    return;
                }
                capsRef.current[tier] += 1;
                state = { player: null, host, tier, hover: hoveredRef.current === item.href, readyTimer: 0 };
                mountsRef.current.set(item.href, state);
                await ensurePlayerDefined();
                const response = await fetch(item.preview.source);
                if (!response.ok)
                    throw new Error(`preview fetch failed: ${response.status}`);
                const { html } = await response.json();
                if (mountsRef.current.get(item.href) !== state)
                    return; // unmounted while loading
                const player = document.createElement('hyperframes-player');
                player.setAttribute('muted', '');
                player.setAttribute('audio-locked', '');
                player.setAttribute('width', String(item.preview.width));
                player.setAttribute('height', String(item.preview.height));
                player.setAttribute('inert', '');
                player.setAttribute('tabindex', '-1');
                player.setAttribute('aria-hidden', 'true');
                // A player that neither errors nor reaches "ready" (a stalled fetch inside its
                // own srcdoc, a composition script that never resolves) must fall back the same
                // as an explicit error -- the placeholder is the safe state, a bare mounted
                // element with nothing painted is not.
                const fail = () => {
                    if (mountsRef.current.get(item.href) !== state)
                        return; // already released
                    console.error(`[catalog] preview failed to load: ${item.id}`);
                    host.dataset.state = 'unavailable';
                    delete host.dataset.ready;
                    release(item, state);
                };
                const readyTimer = state.readyTimer = setTimeout(fail, READY_TIMEOUT_MS);
                player.addEventListener('error', fail, { once: true });
                player.addEventListener('ready', () => {
                    clearTimeout(readyTimer);
                    player.seek(REST_SECONDS);
                    host.dataset.ready = 'true';
                    if (state.hover)
                        player.play();
                }, { once: true });
                player.setAttribute('srcdoc', html);
                state.player = player;
                host.appendChild(player);
            }
            catch (err) {
                // A mount that was already released and superseded must not mark the new card.
                if (state && mountsRef.current.get(item.href) !== state)
                    return;
                console.error(`[catalog] preview failed to load: ${item.id}`, err);
                host.dataset.state = 'unavailable';
                if (state)
                    release(item, state);
            }
        };
        // A hovered tile that is still waiting takes the slot of a mounted tile the pointer is not on.
        promoteRef.current = (item) => {
            const host = waiting.get(item.href);
            if (!host)
                return;
            const tier = tierFor(item);
            const victim = [...mountsRef.current].find(([, st]) => st.tier === tier && !st.hover);
            if (!victim)
                return;
            waiting = new Map([[item.href, host], ...waiting]);
            waiting.set(victim[0], victim[1].host);
            release(catalog.items.find((i) => i.href === victim[0]), victim[1]);
            delete victim[1].host.dataset.ready;
        };
        const hosts = resultsRef.current?.querySelectorAll('a[data-preview-mode="player"] [data-preview-host]') ?? [];
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const host = entry.target;
                const item = catalog.items.find((i) => i.href === host.dataset.previewHost);
                if (!item)
                    continue;
                if (entry.isIntersecting)
                    mount(host, item);
                else
                    unmount(host, item);
            }
        }, { rootMargin: '200px' });
        hosts.forEach((host) => observer.observe(host));
        const mounts = mountsRef.current;
        return () => {
            observer.disconnect();
            mounts.forEach((state) => {
                clearTimeout(state.readyTimer);
                state.player?.remove();
            });
            mounts.clear();
            capsRef.current = { dom: 0, webgl: 0 };
            hoveredRef.current = null;
        };
    }, [filters, limit, expandedGroups, reduced, catalog]);
    const setHover = (item, hovering) => {
        if (reduced)
            return;
        if (item.preview?.mode === 'player') {
            hoveredRef.current = hovering ? item.href : null;
            const state = mountsRef.current.get(item.href);
            if (!state) {
                if (hovering)
                    promoteRef.current(item);
                return;
            }
            state.hover = hovering;
            if (state.player) {
                if (hovering)
                    state.player.play();
                else
                    state.player.seek(REST_SECONDS);
            }
        }
        else if (item.preview?.mode !== 'still' && item.preview?.mode !== 'unsupported') {
            setActive(hovering ? item.href : null);
        }
    };
    const update = (patch) => {
        const next = { ...filters, ...patch };
        setFilters(next);
        setLimit(24);
        setActive(null);
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
    const card = (item) => (React.createElement("a", { className: "hfc-card", href: item.href, key: item.href, "data-preview-mode": item.preview?.mode || "still", onMouseEnter: () => setHover(item, true), onMouseLeave: () => setHover(item, false), onFocus: () => setHover(item, true), onBlur: () => setHover(item, false) },
        React.createElement("div", { className: "hfc-media" },
            item.preview?.mode === "unsupported"
                ? React.createElement("div", { className: "hfc-fallback hfc-unsupported", "aria-hidden": "true" },
                    React.createElement("span", null, "Needs a browser flag"),
                    React.createElement("code", null, `chrome://flags/#${item.preview.flag}`))
                : React.createElement("div", { className: "hfc-fallback", "aria-hidden": "true", style: { display: item.poster ? "none" : undefined } },
                    React.createElement("span", null, item.section),
                    React.createElement("strong", null, item.title)),
            item.poster && React.createElement("img", { src: item.poster, alt: `${item.title} preview`, loading: "lazy", decoding: "async", width: "640", height: "360", onError: (event) => { event.currentTarget.style.display = "none"; event.currentTarget.previousElementSibling.style.display = "flex"; } }),
            item.preview?.mode !== "still" && item.preview?.mode !== "unsupported" && React.createElement("div", { className: "hfc-preview-host", "data-preview-host": item.href, "aria-hidden": "true" })),
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
            React.createElement("p", null, initialGroup ? `${matches.length} items. Preview a piece and open it to explore its controls, code, and installation.` : "Find the scene, caption, or finishing touch for your next video. Preview the motion, pick a favorite, and make it your own.")),
        React.createElement("section", { className: "hfc-browser", "aria-label": "Browse catalog", ref: resultsRef }, searching ? React.createElement(React.Fragment, null,
            matches.length ? React.createElement("div", { className: "hfc-grid" }, matches.slice(0, limit).map(card)) : React.createElement("div", { className: "hfc-empty" },
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
            React.createElement("div", { className: "hfc-grid", id: `gallery-${group.id}` }, ordered(items.filter((item) => item.group === group.id)).slice(0, expandedGroups[group.id] ? undefined : group.pinned ? 6 : 3).map(card))))))));
};
