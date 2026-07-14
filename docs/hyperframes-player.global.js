"use strict";var HyperframesPlayer=(()=>{var Y=Object.defineProperty;var Be=Object.getOwnPropertyDescriptor;var Ge=Object.getOwnPropertyNames;var qe=Object.prototype.hasOwnProperty;var Xe=(i,e)=>{for(var t in e)Y(i,t,{get:e[t],enumerable:!0})},Ye=(i,e,t,r)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of Ge(e))!qe.call(i,n)&&n!==t&&Y(i,n,{get:()=>e[n],enumerable:!(r=Be(e,n))||r.enumerable});return i};var Je=i=>Ye(Y({},"__esModule",{value:!0}),i);var mt={};Xe(mt,{HyperframesPlayer:()=>X,SPEED_PRESETS:()=>Z,formatSpeed:()=>D,formatTime:()=>j});function ye(i){return i.hasRuntime||i.runtimeInjected?!1:!!(i.hasNestedCompositions||i.hasTimelines&&i.attempts>=5)}function P(i){return typeof i=="object"&&i!==null}function _e(i){return P(i)&&typeof i.getDuration=="function"}function Se(i){return P(i)&&typeof i.duration=="function"&&typeof i.time=="function"&&typeof i.seek=="function"&&typeof i.play=="function"&&typeof i.pause=="function"}var Qe="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js";function R(i){if(i===null)return null;let e=Number.parseInt(i,10);return Number.isFinite(e)&&e>0?e:null}function Ze(i){let e=i?.querySelector("[data-composition-id][data-width][data-height]")??i?.querySelector("[data-width][data-height]");if(!e)return null;let t=R(e.getAttribute("data-width")),r=R(e.getAttribute("data-height"));return t!==null&&r!==null?{width:t,height:r}:null}var U=class{constructor(e,t){this._iframe=e;this._callbacks=t}_iframe;_callbacks;_interval=null;_runtimeInjected=!1;get runtimeInjected(){return this._runtimeInjected}start(){this.stop(),this._runtimeInjected=!1;let e=0;this._interval=setInterval(()=>{e++;try{let t=this._iframe.contentWindow;if(!t)return;let r=!!(t.__hf||t.__player),n=!!(t.__timelines&&Object.keys(t.__timelines).length>0),o=!!this._iframe.contentDocument?.querySelector("[data-composition-src]");if(ye({hasRuntime:r,hasTimelines:n,hasNestedCompositions:o,runtimeInjected:this._runtimeInjected,attempts:e})){this._injectRuntime();return}if(this._runtimeInjected&&!r)return;let s=this._resolvePlaybackDurationAdapter(t);if(s&&s.getDuration()>0){this.stop();let l=Ze(this._iframe.contentDocument);this._callbacks.onReady({duration:s.getDuration(),adapter:s,compositionSize:l});return}}catch{}e>=40&&(this.stop(),this._callbacks.onError("Composition timeline not found after 8s"))},200)}stop(){this._interval!==null&&(clearInterval(this._interval),this._interval=null)}resolveDirectTimelineAdapter(){try{let e=this._iframe.contentWindow;return e?this._resolveDirectTimelineAdapterFromWindow(e):null}catch{return null}}resolveDirectTimelineAdapterFromWindow(e){return this._resolveDirectTimelineAdapterFromWindow(e)}hasRuntimeBridge(e){return Reflect.get(e,"__hf")!==void 0||P(Reflect.get(e,"__player"))}_injectRuntime(){this._runtimeInjected=!0;try{let e=this._iframe.contentDocument;if(!e)return;let t=e.createElement("script");t.src=Qe,(e.head||e.documentElement).appendChild(t),this._callbacks.onRuntimeInjected?.()}catch{}}_resolveDirectTimelineAdapterFromWindow(e){if(this.hasRuntimeBridge(e))return null;let t=Reflect.get(e,"__timelines");if(!P(t))return null;let r=Object.keys(t);if(r.length===0)return null;let n=this._iframe.contentDocument?.querySelector("[data-composition-id]")?.getAttribute("data-composition-id"),o=n&&n in t?n:r[r.length-1],s=t[o];return Se(s)?s:null}_resolvePlaybackDurationAdapter(e){let t=Reflect.get(e,"__player");if(_e(t))return{kind:"runtime",getDuration:()=>t.getDuration()};let r=this._resolveDirectTimelineAdapterFromWindow(e);return r?{kind:"direct-timeline",timeline:r,getDuration:()=>r.duration()}:null}};var Ee=`
  :host {
    display: block;
    position: relative;
    overflow: hidden;
    background: #000;
    contain: layout style;
  }

  .hfp-container {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }


  .hfp-iframe {
    position: absolute;
    top: 50%;
    left: 50%;
    border: none;
    pointer-events: none;
  }

  /* Opt-in: an interactive composition (e.g. a live slideshow/app with playable
     media or controls) \u2014 let pointer events reach the iframe content. */
  :host([interactive]) .hfp-container,
  :host([interactive]) .hfp-iframe {
    pointer-events: auto;
  }

  .hfp-poster {
    position: absolute;
    inset: 0;
    object-fit: contain;
    z-index: 1;
    pointer-events: none;
  }

  .hfp-shader-loader {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    background: #030504;
    color: #f4f7fb;
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
    transition: opacity 420ms ease-out, visibility 420ms ease-out;
  }

  .hfp-shader-loader.hfp-visible,
  .hfp-shader-loader.hfp-hiding {
    visibility: visible;
  }

  .hfp-shader-loader.hfp-visible {
    opacity: 1;
    pointer-events: auto;
  }

  .hfp-shader-loader.hfp-hiding {
    opacity: 0;
    pointer-events: none;
  }

  .hfp-shader-loader-panel {
    display: grid;
    grid-template-rows: 86px 40px 26px 12px 44px;
    justify-items: center;
    align-items: center;
    gap: 8px;
    width: min(620px, 82%);
    text-align: center;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .hfp-shader-loader-mark {
    width: 86px;
    height: 86px;
    display: grid;
    place-items: center;
    overflow: visible;
  }

  .hfp-shader-loader-mark svg {
    display: block;
    overflow: visible;
    filter: drop-shadow(0 0 5px rgba(79, 219, 94, 0.16));
    pointer-events: none;
  }

  .hfp-shader-loader-title {
    width: 100%;
    height: 40px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 26px;
    line-height: 40px;
    font-weight: 700;
    letter-spacing: 0;
  }

  .hfp-shader-loader-title-text {
    color: transparent;
    background: linear-gradient(
      90deg,
      rgba(244, 247, 251, 0.84) 0%,
      #ffffff 42%,
      #80efe4 52%,
      #ffffff 62%,
      rgba(244, 247, 251, 0.84) 100%
    );
    background-size: 220% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    animation: hfp-shader-loader-sheen 1.9s linear infinite;
  }

  .hfp-shader-loader-detail {
    width: 100%;
    height: 26px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: rgba(244, 247, 251, 0.62);
    font-size: 15px;
    line-height: 26px;
    font-weight: 500;
  }

  .hfp-shader-loader-track {
    width: min(360px, 100%);
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
  }

  .hfp-shader-loader-fill {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #06e3fa, #4fdb5e);
    transform: scaleX(0);
    transform-origin: left center;
    transition: transform 160ms ease;
  }

  .hfp-shader-loader-progress {
    width: min(420px, 100%);
    height: 44px;
    display: grid;
    grid-template-rows: repeat(2, 22px);
    color: rgba(244, 247, 251, 0.48);
    font: 600 13px/22px "IBM Plex Mono", "SF Mono", "Fira Code", "Courier New", monospace;
    font-variant-numeric: tabular-nums;
  }

  .hfp-shader-loader-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 74px;
    align-items: center;
    column-gap: 20px;
    width: 100%;
    white-space: nowrap;
  }

  .hfp-shader-loader-label {
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
  }

  .hfp-shader-loader-value {
    text-align: right;
  }

  @keyframes hfp-shader-loader-sheen {
    from {
      background-position: 140% 0;
    }
    to {
      background-position: -140% 0;
    }
  }

  /* \u2500\u2500 Theming via CSS custom properties \u2500\u2500
   *
   * Override from outside the shadow DOM:
   *   hyperframes-player {
   *     --hfp-controls-bg: linear-gradient(transparent, rgba(0,0,0,0.9));
   *     --hfp-accent: #ff6b6b;
   *     --hfp-font: "Inter", sans-serif;
   *   }
   */

  .hfp-controls {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: var(--hfp-controls-gap, 12px);
    padding: var(--hfp-controls-padding, 8px 16px);
    background: var(--hfp-controls-bg, linear-gradient(transparent, rgba(0, 0, 0, 0.7)));
    color: var(--hfp-color, #fff);
    font-family: var(--hfp-font, system-ui, -apple-system, sans-serif);
    font-size: var(--hfp-font-size, 13px);
    z-index: 10;
    pointer-events: auto;
    opacity: 1;
    transition: opacity 0.3s ease;
    user-select: none;
  }

  .hfp-controls.hfp-hidden {
    opacity: 0;
    pointer-events: none;
  }

  .hfp-play-btn {
    position: relative;
    background: none;
    border: none;
    color: var(--hfp-color, #fff);
    cursor: pointer;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    z-index: 10;
  }

  .hfp-play-btn:hover {
    opacity: 0.8;
  }

  /* Stacked play/pause glyphs that crossfade-morph on toggle (rotate + scale). */
  .hfp-play-btn .hfp-ico {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      opacity 200ms ease,
      transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .hfp-play-btn .hfp-ico-play {
    opacity: 1;
    transform: rotate(0) scale(1);
  }
  .hfp-play-btn .hfp-ico-pause {
    opacity: 0;
    transform: rotate(-90deg) scale(0.4);
  }
  .hfp-play-btn.hfp-playing .hfp-ico-play {
    opacity: 0;
    transform: rotate(90deg) scale(0.4);
  }
  .hfp-play-btn.hfp-playing .hfp-ico-pause {
    opacity: 1;
    transform: rotate(0) scale(1);
  }
  @media (prefers-reduced-motion: reduce) {
    .hfp-play-btn .hfp-ico {
      transition-duration: 0ms;
      transform: none;
    }
  }

  .hfp-play-btn svg,
  .hfp-play-btn svg * {
    pointer-events: none;
  }

  .hfp-scrubber {
    flex: 1;
    min-width: 0;
    height: var(--hfp-scrubber-height, 4px);
    background: var(--hfp-scrubber-bg, rgba(255, 255, 255, 0.3));
    border-radius: var(--hfp-scrubber-radius, 2px);
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }

  .hfp-scrubber:hover {
    height: var(--hfp-scrubber-height-hover, 6px);
  }

  .hfp-progress {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: var(--hfp-accent, #fff);
    pointer-events: none;
  }

  .hfp-time {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    opacity: 0.9;
  }

  .hfp-speed-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .hfp-speed-btn {
    background: var(--hfp-speed-btn-bg, rgba(255, 255, 255, 0.15));
    border: none;
    border-radius: var(--hfp-speed-btn-radius, 4px);
    color: var(--hfp-color, #fff);
    cursor: pointer;
    font-family: var(--hfp-font, system-ui, -apple-system, sans-serif);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    padding: 4px 8px;
    min-width: 40px;
    text-align: center;
    transition: background 0.15s ease;
  }

  .hfp-speed-btn:hover {
    background: var(--hfp-speed-btn-bg-hover, rgba(255, 255, 255, 0.3));
  }

  .hfp-speed-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    background: var(--hfp-menu-bg, rgba(20, 20, 20, 0.95));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--hfp-menu-border, rgba(255, 255, 255, 0.1));
    border-radius: var(--hfp-menu-radius, 8px);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 80px;
    opacity: 0;
    visibility: hidden;
    transform: translateY(4px);
    transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s;
    box-shadow: var(--hfp-menu-shadow, 0 8px 24px rgba(0, 0, 0, 0.4));
  }

  .hfp-speed-menu.hfp-open {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }

  .hfp-speed-option {
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--hfp-menu-color, rgba(255, 255, 255, 0.7));
    cursor: pointer;
    font-family: var(--hfp-font, system-ui, -apple-system, sans-serif);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    padding: 6px 12px;
    text-align: left;
    transition: background 0.1s ease, color 0.1s ease;
    white-space: nowrap;
  }

  .hfp-speed-option:hover {
    background: var(--hfp-menu-hover-bg, rgba(255, 255, 255, 0.1));
    color: var(--hfp-color, #fff);
  }

  .hfp-speed-option.hfp-active {
    color: var(--hfp-accent, #fff);
    font-weight: 600;
  }

  .hfp-volume-wrap {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0;
  }

  .hfp-mute-btn {
    background: none;
    border: none;
    color: var(--hfp-color, #fff);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
  }

  .hfp-mute-btn:hover {
    opacity: 0.8;
  }

  .hfp-mute-btn svg,
  .hfp-mute-btn svg * {
    pointer-events: none;
  }

  .hfp-volume-slider-wrap {
    width: 0;
    overflow: hidden;
    transition: width 0.2s ease;
    display: flex;
    align-items: center;
  }

  .hfp-volume-wrap:hover .hfp-volume-slider-wrap {
    width: 64px;
  }

  .hfp-volume-slider {
    width: 56px;
    height: var(--hfp-scrubber-height, 4px);
    background: var(--hfp-scrubber-bg, rgba(255, 255, 255, 0.3));
    border-radius: var(--hfp-scrubber-radius, 2px);
    cursor: pointer;
    position: relative;
    overflow: hidden;
    margin-left: 4px;
    margin-right: 4px;
  }

  .hfp-volume-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: var(--hfp-accent, #fff);
    pointer-events: none;
  }
`,we='<svg width="24" height="24" viewBox="46 21 54 56" fill="currentColor"><path d="M87.5129 57.5141L56.9696 73.5433C52.8371 75.7098 48.7046 73.2553 49.6688 69.2104L58.9483 30.1391C59.9125 26.0942 65.2097 23.6397 68.3154 25.8062L91.2447 41.8354C96.4668 45.4796 94.4631 53.8699 87.5129 57.5141Z"/></svg>',Ae='<svg width="24" height="24" viewBox="0 0 18 18" fill="currentColor"><rect x="3" y="2" width="4" height="14"/><rect x="11" y="2" width="4" height="14"/></svg>',J='<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',Q='<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>',Te='<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" opacity="0.3"/><line x1="18" y1="7" x2="14" y2="17" stroke="currentColor" stroke-width="2"/></svg>';var Z=[.25,.5,1,1.5,2,4];function D(i){return Number.isInteger(i)?`${i}x`:`${i}x`}function j(i){if(!Number.isFinite(i)||i<0)return"0:00";let e=Math.floor(i),t=Math.floor(e/60),r=e%60;return`${t}:${r.toString().padStart(2,"0")}`}function Ce(i,e,t={}){let r=t.speedPresets??Z,n=document.createElement("div");n.className="hfp-controls",n.addEventListener("click",a=>{a.stopPropagation()});let o=document.createElement("button");o.className="hfp-play-btn",o.type="button",o.innerHTML=`<span class="hfp-ico hfp-ico-play">${we}</span><span class="hfp-ico hfp-ico-pause">${Ae}</span>`,o.setAttribute("aria-label","Play");let s=document.createElement("div");s.className="hfp-scrubber";let l=document.createElement("div");l.className="hfp-progress",l.style.width="0%",s.appendChild(l);let u=document.createElement("span");u.className="hfp-time",u.textContent="0:00 / 0:00";let c=document.createElement("div");c.className="hfp-speed-wrap";let p=document.createElement("button");p.className="hfp-speed-btn",p.type="button",p.textContent="1x",p.setAttribute("aria-label","Playback speed");let b=document.createElement("div");b.className="hfp-speed-menu",b.setAttribute("role","menu");for(let a of r){let d=document.createElement("button");d.className="hfp-speed-option",d.type="button",d.setAttribute("role","menuitem"),d.dataset.speed=String(a),d.textContent=D(a),a===1&&d.classList.add("hfp-active"),b.appendChild(d)}c.appendChild(b),c.appendChild(p);let v=document.createElement("div");v.className="hfp-volume-wrap";let m=document.createElement("button");m.className="hfp-mute-btn",m.type="button",m.innerHTML=J,m.setAttribute("aria-label","Mute");let _=document.createElement("div");_.className="hfp-volume-slider-wrap";let h=document.createElement("div");h.className="hfp-volume-slider",h.setAttribute("role","slider"),h.setAttribute("aria-label","Volume"),h.setAttribute("aria-valuemin","0"),h.setAttribute("aria-valuemax","100"),h.setAttribute("aria-valuenow","100"),h.tabIndex=0;let y=document.createElement("div");y.className="hfp-volume-fill",y.style.width="100%",h.appendChild(y),_.appendChild(h),v.appendChild(_),v.appendChild(m),t.audioLocked&&(v.style.display="none"),n.appendChild(o),n.appendChild(s),n.appendChild(u),n.appendChild(v),n.appendChild(c),i.appendChild(n);let I=!1,A=!1,E=1,L=null,O=r.indexOf(1);O===-1&&(O=0);let H=(a,d)=>a?Te:d===0?Q:d<.5?Q:J;o.addEventListener("click",a=>{a.stopPropagation(),I?e.onPause():e.onPlay()}),m.addEventListener("click",a=>{a.stopPropagation(),e.onMuteToggle()});let T=!1,N=a=>{let d=h.getBoundingClientRect(),f=Math.max(0,Math.min(1,(a-d.left)/d.width));E=f,y.style.width=`${f*100}%`,h.setAttribute("aria-valuenow",String(Math.round(f*100))),A&&f>0&&e.onMuteToggle(),m.innerHTML=H(A,f),e.onVolumeChange(f)};h.addEventListener("mousedown",a=>{a.stopPropagation(),T=!0,N(a.clientX)});let oe=a=>{T&&N(a.clientX)},ae=()=>{T=!1};document.addEventListener("mousemove",oe),document.addEventListener("mouseup",ae),h.addEventListener("touchstart",a=>{T=!0;let d=a.touches[0];d&&N(d.clientX)},{passive:!0});let se=a=>{if(T){let d=a.touches[0];d&&N(d.clientX)}},le=()=>{T=!1};document.addEventListener("touchmove",se,{passive:!0}),document.addEventListener("touchend",le);let de=.05;h.addEventListener("keydown",a=>{let d=E;if(a.key==="ArrowRight"||a.key==="ArrowUp")d=Math.min(1,E+de);else if(a.key==="ArrowLeft"||a.key==="ArrowDown")d=Math.max(0,E-de);else return;a.preventDefault(),a.stopPropagation(),E=d,y.style.width=`${d*100}%`,h.setAttribute("aria-valuenow",String(Math.round(d*100))),A&&d>0&&e.onMuteToggle(),m.innerHTML=H(A,d),e.onVolumeChange(d)});let ue=a=>{for(let d of b.querySelectorAll(".hfp-speed-option"))d.classList.toggle("hfp-active",d.dataset.speed===String(a))};p.addEventListener("click",a=>{a.stopPropagation();let d=b.classList.toggle("hfp-open");p.setAttribute("aria-expanded",String(d))}),b.addEventListener("click",a=>{a.stopPropagation();let d=a.target.closest(".hfp-speed-option");if(!d)return;let f=parseFloat(d.dataset.speed);O=r.indexOf(f),p.textContent=D(f),ue(f),b.classList.remove("hfp-open"),p.setAttribute("aria-expanded","false"),e.onSpeedChange(f)});let pe=()=>{b.classList.remove("hfp-open"),p.setAttribute("aria-expanded","false")};document.addEventListener("click",pe);let F=a=>{let d=s.getBoundingClientRect(),f=Math.max(0,Math.min(1,(a-d.left)/d.width));e.onSeek(f)},S=!1;s.addEventListener("mousedown",a=>{a.stopPropagation(),S=!0,e.onScrubStart?.(),F(a.clientX)});let ce=a=>{S&&F(a.clientX)},he=()=>{S&&(S=!1,e.onScrubEnd?.())};document.addEventListener("mousemove",ce),document.addEventListener("mouseup",he),s.addEventListener("touchstart",a=>{S=!0,e.onScrubStart?.();let d=a.touches[0];d&&F(d.clientX)},{passive:!0});let me=a=>{if(S){let d=a.touches[0];d&&F(d.clientX)}},fe=()=>{S&&(S=!1,e.onScrubEnd?.())};document.addEventListener("touchmove",me,{passive:!0}),document.addEventListener("touchend",fe);let be=()=>{L&&clearTimeout(L),L=setTimeout(()=>{I&&n.classList.add("hfp-hidden")},3e3)},V=i instanceof ShadowRoot?i.host:i,ge=()=>{n.classList.remove("hfp-hidden"),be()},ve=()=>{I&&n.classList.add("hfp-hidden")};return V.addEventListener("mousemove",ge),V.addEventListener("mouseleave",ve),{updateTime(a,d){let f=d>0?Math.min(a,d):a,We=d>0?f/d*100:0;l.style.width=`${We}%`,u.textContent=`${j(f)} / ${j(d)}`},updatePlaying(a){I=a,o.classList.toggle("hfp-playing",a),o.setAttribute("aria-label",a?"Pause":"Play"),a?be():n.classList.remove("hfp-hidden")},updateSpeed(a){let d=r.indexOf(a);d!==-1&&(O=d),p.textContent=D(a),ue(a)},updateMuted(a){A=a,m.innerHTML=H(a,E),m.setAttribute("aria-label",a?"Unmute":"Mute")},updateVolume(a){E=a,y.style.width=`${a*100}%`,h.setAttribute("aria-valuenow",String(Math.round(a*100))),m.innerHTML=H(A,a)},setVolumeControlsHidden(a){v.style.display=a?"none":""},show(){n.style.display=""},hide(){n.style.display="none"},destroy(){document.removeEventListener("mousemove",ce),document.removeEventListener("mouseup",he),document.removeEventListener("touchmove",me),document.removeEventListener("touchend",fe),document.removeEventListener("mousemove",oe),document.removeEventListener("mouseup",ae),document.removeEventListener("touchmove",se),document.removeEventListener("touchend",le),document.removeEventListener("click",pe),V.removeEventListener("mousemove",ge),V.removeEventListener("mouseleave",ve),L&&clearTimeout(L),n.remove()}}}function xe(i,e,t,r,n,o=!1){let s=r?r.split(",").map(Number).filter(c=>!isNaN(c)&&c>0):void 0,l={...s?{speedPresets:s}:{},audioLocked:o},u=Ce(i,n,l);return u.updateMuted(e),u.updateVolume(t),u}function K(i,e,t){return e?(t||(t=document.createElement("img"),t.className="hfp-poster",i.appendChild(t)),t.src=e,t):(t?.remove(),null)}function Me(i){return i.composedPath().some(e=>e instanceof HTMLElement&&e.classList.contains("hfp-controls"))}var $=null;function ke(i,e){if(typeof CSSStyleSheet<"u")try{$||($=new CSSStyleSheet,$.replaceSync(e)),i.adoptedStyleSheets=[$];return}catch{}let t=document.createElement("style");t.textContent=e,i.appendChild(t)}function Le(){let i=document.createElement("div");i.className="hfp-container";let e=document.createElement("iframe");return e.className="hfp-iframe",e.sandbox.add("allow-scripts","allow-same-origin"),e.allow="autoplay; fullscreen",e.referrerPolicy="no-referrer",e.title="HyperFrames Composition",i.appendChild(e),{container:i,iframe:e}}function Pe(i,e,t,r){let n=i.offsetWidth,o=i.offsetHeight;if(n===0||o===0)return!1;let s=Math.min(n/t,o/r);return e.style.width=`${t}px`,e.style.height=`${r}px`,e.style.transform=`translate(-50%, -50%) scale(${s})`,!0}var z=class{constructor(e){this._callbacks=e}_callbacks;_raf=null;_lastUpdateMs=0;start(e,t,r,n){this.stop();let o=()=>{if(n()){this._raf=null;return}let s;try{s=e.time()}catch{this._raf=null;return}let l=r();l>0&&(s=Math.min(s,l));let u=l>0&&s>=l,c=performance.now();if((c-this._lastUpdateMs>100||u)&&(this._lastUpdateMs=c,this._callbacks.onTimeUpdate(s,l)),u){if(this._callbacks.getLoop()){this._callbacks.restart();return}try{e.pause()}catch{}this._callbacks.onPaused(),this._raf=null;return}this._raf=requestAnimationFrame(o)};this._raf=requestAnimationFrame(o)}stop(){this._raf!==null&&(cancelAnimationFrame(this._raf),this._raf=null)}get isRunning(){return this._raf!==null}};function Re(i){let e=Array.from(i.querySelectorAll("[data-composition-id]"));if(e.length===0)return i.body?[i.body]:[];let t=[];for(let r of e)et(r)||t.push(r);return Ke(i),t}function Ke(i){let e=i.body;if(!e||typeof console>"u"||typeof console.warn!="function")return;let t=e.querySelectorAll("audio[data-start], video[data-start]");if(t.length===0)return;let r=[];for(let n of t)n.closest("[data-composition-id]")||r.push(n);r.length!==0&&console.warn(`[hyperframes-player] selectMediaObserverTargets: composition hosts are present, but ${r.length} body-level timed media element(s) sit outside every [data-composition-id] subtree and will not be observed. Move them inside a composition host or the parent-frame proxy will never adopt them.`,r)}function et(i){let e=i.parentElement;for(;e;){if(e.hasAttribute("data-composition-id"))return!0;e=e.parentElement}return!1}function W(i){let e=i.ownerDocument?.defaultView;return e&&i instanceof e.Element?!0:i instanceof Element}function g(i){if(!W(i)||i.tagName!=="AUDIO"&&i.tagName!=="VIDEO")return!1;let e=i.ownerDocument?.defaultView;return e&&i instanceof e.HTMLMediaElement?!0:i instanceof HTMLMediaElement}var tt=.05,rt=2,B=class{_entries=[];_mediaObserver;_playbackErrorPosted=!1;_audioOwner="runtime";_urlAudioEntry=null;_urlAudioSrc=null;_dispatchEvent;_getMuted;_getVolume;_getPlaybackRate;_getCurrentTime;_isPaused;constructor(e){this._dispatchEvent=e.dispatchEvent,this._getMuted=e.getMuted,this._getVolume=e.getVolume,this._getPlaybackRate=e.getPlaybackRate,this._getCurrentTime=e.getCurrentTime,this._isPaused=e.isPaused}get audioOwner(){return this._audioOwner}get entries(){return this._entries}resetForIframeLoad(){this._playbackErrorPosted=!1;let e=this._audioOwner==="parent";this._audioOwner="runtime",this.pauseAll(),this.teardownObserver(),e&&this._dispatchEvent(new CustomEvent("audioownershipchange",{detail:{owner:"runtime",reason:"iframe-reload"}}))}destroy(){this.teardownObserver();for(let e of this._entries)e.el.pause(),e.el.src="";this._entries=[],this._urlAudioEntry=null,this._urlAudioSrc=null}updateMuted(e){for(let t of this._entries)t.el.muted=e}updateVolume(e){for(let t of this._entries)t.el.volume=e}updatePlaybackRate(e){for(let t of this._entries)t.el.playbackRate=e}_playEntry(e){e.el.src&&e.el.play().catch(t=>this._reportPlaybackError(t))}_playEntryIfActive(e){this._refreshEntryBounds(e);let t=this._getCurrentTime()-e.start;t<0||t>=e.duration||this._playEntry(e)}_refreshEntryBounds(e){if(!e.source?.isConnected)return;let t=parseFloat(e.source.getAttribute("data-start")||"0");e.start=Number.isFinite(t)?t:0;let r=parseFloat(e.source.getAttribute("data-duration")||"");e.duration=Number.isFinite(r)&&r>0?r:Number.POSITIVE_INFINITY}_gateEntryPlayback(e,t){return t<0||t>=e.duration?(e.el.paused||e.el.pause(),e.driftSamples=0,!1):(this._audioOwner==="parent"&&!this._isPaused()&&e.el.paused&&this._playEntry(e),!0)}playAll(){for(let e of this._entries)this._playEntryIfActive(e)}pauseAll(){for(let e of this._entries)e.el.pause()}stopAdoptedMedia(){for(let e of this._entries)e.source&&e.el.pause()}seekAll(e){for(let t of this._entries){this._refreshEntryBounds(t);let r=e-t.start;r>=0&&r<t.duration&&(t.el.currentTime=r)}}scrubAll(e){for(let t of this._entries){this._refreshEntryBounds(t);let r=e-t.start;r>=0&&r<t.duration?(t.el.currentTime=r,this._playEntry(t)):t.el.paused||t.el.pause()}}mirrorTime(e,t){let r=t?.force===!0;for(let n of this._entries){this._refreshEntryBounds(n);let o=e-n.start;this._gateEntryPlayback(n,o)&&(Math.abs(n.el.currentTime-o)>tt?(n.driftSamples+=1,(r||n.driftSamples>=rt)&&(n.el.currentTime=o,n.driftSamples=0)):n.driftSamples=0)}}promoteToParentProxy(e,t){if(this._audioOwner==="parent")return;if(this._audioOwner="parent",e)for(let n of e.querySelectorAll("video, audio"))g(n)&&(n.muted=!0);let r=this._getCurrentTime();t?t(r,{force:!0}):this.mirrorTime(r,{force:!0}),this._isPaused()||this.playAll(),this._dispatchEvent(new CustomEvent("audioownershipchange",{detail:{owner:"parent",reason:"autoplay-blocked"}}))}setupFromIframe(e){let t=e.querySelectorAll("audio[data-start], video[data-start]");for(let r of t)g(r)&&this._adoptIframeMedia(r);this._observeDynamicMedia(e)}setupFromUrl(e){if(this._urlAudioSrc===e&&this._urlAudioEntry)return;this.teardownUrlAudio();let t=this._createEntry(e,"audio",0,1/0);this._urlAudioEntry=t,this._urlAudioSrc=t?e:null,t&&this._audioOwner==="parent"&&!this._isPaused()&&(this.mirrorTime(this._getCurrentTime(),{force:!0}),this.playAll())}teardownUrlAudio(){let e=this._urlAudioEntry;if(this._urlAudioEntry=null,this._urlAudioSrc=null,!e)return;e.el.pause(),e.el.src="";let t=this._entries.indexOf(e);t!==-1&&this._entries.splice(t,1)}teardownObserver(){this._mediaObserver?.disconnect(),this._mediaObserver=void 0}_reportPlaybackError(e){this._playbackErrorPosted||(this._playbackErrorPosted=!0,this._dispatchEvent(new CustomEvent("playbackerror",{detail:{source:"parent-proxy",error:e}})))}_createEntry(e,t,r,n,o){if(this._entries.some(c=>c.el.src===e))return null;let s=t==="video"?document.createElement("video"):new Audio;s.preload="auto",s.src=e,s.load(),s.muted=this._getMuted(),s.volume=this._getVolume();let l=this._getPlaybackRate();l!==1&&(s.playbackRate=l);let u={el:s,start:r,duration:n,driftSamples:0,source:o};return this._entries.push(u),u}_resolveIframeMediaSrc(e){let t=e.getAttribute("src")||e.querySelector("source")?.getAttribute("src");return t?new URL(t,e.ownerDocument.baseURI).href:null}_adoptIframeMedia(e){if(e.preload==="metadata"||e.preload==="none")return;let t=this._resolveIframeMediaSrc(e);if(!t)return;let r=parseFloat(e.getAttribute("data-start")||"0"),n=parseFloat(e.getAttribute("data-duration")||"Infinity"),o=e.tagName==="VIDEO"?"video":"audio",s=this._createEntry(t,o,r,n,e);s&&this._audioOwner==="parent"&&(this.mirrorTime(this._getCurrentTime(),{force:!0}),this._isPaused()||this._playEntryIfActive(s))}_detachIframeMedia(e){let t=this._resolveIframeMediaSrc(e);if(!t)return;let r=this._entries.findIndex(o=>o.el.src===t);if(r===-1)return;let n=this._entries[r];n.el.pause(),n.el.src="",this._entries.splice(r,1)}_observeDynamicMedia(e){if(this.teardownObserver(),typeof MutationObserver>"u"||!e.body)return;let t=new MutationObserver(o=>{for(let s of o){if(s.type==="attributes"&&s.attributeName==="preload"){let l=s.target;g(l)&&l.matches("audio[data-start], video[data-start]")&&l.preload==="auto"&&this._adoptIframeMedia(l);continue}for(let l of s.addedNodes){if(!W(l))continue;let u=[];g(l)&&l.matches("audio[data-start], video[data-start]")&&u.push(l);let c=l.querySelectorAll("audio[data-start], video[data-start]");for(let p of c)g(p)&&u.push(p);for(let p of u)this._adoptIframeMedia(p)}for(let l of s.removedNodes){if(!W(l))continue;let u=[];g(l)&&l.matches("audio[data-start], video[data-start]")&&u.push(l);let c=l.querySelectorAll("audio[data-start], video[data-start]");for(let p of c)g(p)&&u.push(p);for(let p of u)this._detachIframeMedia(p)}}}),r={childList:!0,subtree:!0,attributes:!0,attributeFilter:["preload"]},n=Re(e);for(let o of n)t.observe(o,r);this._mediaObserver=t}};function De(i,e,t,r){let n=(i.frame??0)/e,o=t.duration>0?Math.min(n,t.duration):n,s=!t.paused,l=!i.isPlaying,u=t.duration>0&&o>=t.duration&&(s||i.isPlaying);if(u&&r.getLoop())return r.media.audioOwner==="parent"&&r.media.pauseAll(),r.seek(0),r.play(),{...t,currentTime:o,paused:!1};let c={...t,currentTime:o,paused:l};r.media.audioOwner==="parent"&&(s&&l?r.media.pauseAll():!s&&!l&&r.media.playAll(),r.media.mirrorTime(o));let p=performance.now(),b=l!==t.paused;return(p-t.lastUpdateMs>100||b)&&(c.lastUpdateMs=p,r.updateControlsTime(o,t.duration),r.updateControlsPlaying(!l),r.dispatchEvent(new CustomEvent("timeupdate",{detail:{currentTime:o}}))),u&&(r.media.audioOwner==="parent"&&r.media.pauseAll(),c.paused=!0,r.updateControlsPlaying(!1),r.dispatchEvent(new Event("ended"))),c}var Ie=30;function it(i){return Array.isArray(i)?i.filter(e=>typeof e=="object"&&e!==null&&typeof e.id=="string"&&typeof e.start=="number"&&typeof e.duration=="number"):[]}function Oe(i,e,t){if(i.source!==e)return;let r=i.data;if(!(!r||r.source!=="hf-preview")){if(r.type==="shader-transition-state"){let n=r.state&&typeof r.state=="object"?r.state:{};t.shaderLoader.update(n,t.getShaderLoadingMode()),t.dispatchEvent(new CustomEvent("shadertransitionstate",{detail:{compositionId:r.compositionId,state:n}}));return}if(r.type==="ready"){t.onRuntimeReady();return}if(r.type==="state"){t.setPlaybackState(De({frame:r.frame??0,isPlaying:!!r.isPlaying},Ie,t.getPlaybackState(),t));return}if(r.type==="media-autoplay-blocked"){if(t.shouldPromoteMediaAutoplayFallback?.()===!1)return;let n=null;try{n=t.getIframeDoc()}catch{}t.media.promoteToParentProxy(n,(o,s)=>t.media.mirrorTime(o,s)),t.sendControl("set-media-output-muted",{muted:!0});return}if(r.type==="timeline"&&r.durationInFrames>0){if(Number.isFinite(r.durationInFrames)){let n=t.getPlaybackState(),o=r.durationInFrames/Ie;t.setPlaybackState({...n,duration:o}),t.updateControlsTime(n.currentTime,o),t.onRuntimeTimelineReady(o)}t.setScenes(it(r.scenes));return}r.type==="stage-size"&&Number.isFinite(r.width)&&r.width>0&&Number.isFinite(r.height)&&r.height>0&&t.setCompositionSize(r.width,r.height)}}var w="shader-capture-scale",C="shader-loading",nt="__hf_shader_capture_scale",ot="__hf_shader_loading",x=["Preparing scene transitions","Sampling outgoing scene motion","Sampling incoming scene motion","Caching transition frames","Finalizing transition preview"];function ee(i){if(i===null)return null;let e=Number(i);return!Number.isFinite(e)||e<=0?null:String(Math.min(1,Math.max(.25,e)))}function at(i){if(i===null||i.trim()==="")return"composition";let e=i.trim().toLowerCase();return e==="none"||e==="false"||e==="0"||e==="off"?"none":e==="player"||e==="true"||e==="1"||e==="on"?"player":"composition"}function He(i,e,t){t===null?i.delete(e):i.set(e,t)}function st(i,e,t){let r=i.indexOf("#"),n=r>=0?i.slice(0,r):i,o=r>=0?i.slice(r):"",s=n.indexOf("?"),l=s>=0?n.slice(0,s):n,u=s>=0?n.slice(s+1):"",c=new URLSearchParams(u);He(c,nt,e),He(c,ot,t==="composition"?null:t);let p=c.toString();return`${l}${p?`?${p}`:""}${o}`}function lt(i,e,t){if(e===null&&t==="composition")return i;let r=[];e!==null&&r.push(`window.__HF_SHADER_CAPTURE_SCALE=${JSON.stringify(e)};`),t!=="composition"&&r.push(`window.__HF_SHADER_LOADING=${JSON.stringify(t)};`);let n=`<script data-hyperframes-player-shader-options>${r.join("")}</script>`;return/<head\b[^>]*>/i.test(i)?i.replace(/<head\b[^>]*>/i,o=>`${o}${n}`):/<html\b[^>]*>/i.test(i)?i.replace(/<html\b[^>]*>/i,o=>`${o}${n}`):`${n}${i}`}function M(i){return at(i.getAttribute(C))}function Ne(i){return Number(ee(i.getAttribute(w))??"1")}function Fe(i,e){return st(e,ee(i.getAttribute(w)),M(i))}function te(i,e){return lt(e,ee(i.getAttribute(w)),M(i))}function Ve(){let i=document.createElement("div");i.className="hfp-shader-loader",i.setAttribute("role","status"),i.setAttribute("aria-live","polite"),i.setAttribute("aria-label","Preparing scene transitions"),i.setAttribute("data-hyperframes-ignore",""),i.draggable=!1;let e=m=>{m.preventDefault(),m.stopPropagation()};for(let m of["selectstart","dragstart","pointerdown","mousedown","click","dblclick","contextmenu","touchstart"])i.addEventListener(m,e,{capture:!0});let t=document.createElement("div");t.className="hfp-shader-loader-panel",t.draggable=!1;let r=document.createElement("div");r.className="hfp-shader-loader-mark",r.draggable=!1,r.innerHTML=['<svg width="78" height="78" viewBox="0 0 100 100" fill="none" aria-hidden="true" draggable="false">','<path d="M10.1851 57.8021L33.1145 73.8313C36.2202 75.9978 41.5173 73.5433 42.4816 69.4984L51.7611 30.4271C52.7253 26.3822 48.5802 23.9277 44.4602 26.0942L13.917 42.1235C6.96677 45.7676 4.97564 54.1579 10.1851 57.8021Z" fill="url(#hfp-shader-loader-grad-left)"/>','<path d="M87.5129 57.5141L56.9696 73.5433C52.8371 75.7098 48.7046 73.2553 49.6688 69.2104L58.9483 30.1391C59.9125 26.0942 65.2097 23.6397 68.3154 25.8062L91.2447 41.8354C96.4668 45.4796 94.4631 53.8699 87.5129 57.5141Z" fill="url(#hfp-shader-loader-grad-right)"/>',"<defs>",'<linearGradient id="hfp-shader-loader-grad-left" x1="48.5676" y1="25" x2="44.7804" y2="71.9384" gradientUnits="userSpaceOnUse">','<stop stop-color="#06E3FA"/>','<stop offset="1" stop-color="#4FDB5E"/>',"</linearGradient>",'<linearGradient id="hfp-shader-loader-grad-right" x1="54.8282" y1="73.8392" x2="72.0989" y2="32.8932" gradientUnits="userSpaceOnUse">','<stop stop-color="#06E3FA"/>','<stop offset="1" stop-color="#4FDB5E"/>',"</linearGradient>","</defs>","</svg>"].join("");let n=document.createElement("div");n.className="hfp-shader-loader-title";let o=document.createElement("span");o.className="hfp-shader-loader-title-text",o.textContent=x[0]||"Preparing scene transitions",n.appendChild(o);let s=document.createElement("div");s.className="hfp-shader-loader-detail",s.textContent="Rendering animated scene samples for shader transitions.";let l=document.createElement("div");l.className="hfp-shader-loader-track",l.setAttribute("aria-hidden","true");let u=document.createElement("div");u.className="hfp-shader-loader-fill",l.appendChild(u);let c=document.createElement("div");c.className="hfp-shader-loader-progress";let p=m=>{let _=document.createElement("div");_.className="hfp-shader-loader-row";let h=document.createElement("span");h.className="hfp-shader-loader-label",h.textContent=m;let y=document.createElement("span");return y.className="hfp-shader-loader-value",_.appendChild(h),_.appendChild(y),c.appendChild(_),{row:_,label:h,value:y}},b=p("transition"),v=p("transition frame");return t.appendChild(r),t.appendChild(n),t.appendChild(s),t.appendChild(l),t.appendChild(c),i.appendChild(t),{root:i,fill:u,title:o,detail:s,transitionValue:b.value,frameLabel:v.label,frameValue:v.value,frameRow:v.row}}var dt=420,G=class{_el;_hideTimeout=null;constructor(e){this._el=e}show(){this._hideTimeout&&(clearTimeout(this._hideTimeout),this._hideTimeout=null),this._el.root.classList.remove("hfp-hiding"),this._el.root.classList.add("hfp-visible")}hide(){if(this._el.root.classList.contains("hfp-hiding")){this._hideTimeout||this._scheduleCleanup();return}this._el.root.classList.contains("hfp-visible")&&(this._el.root.classList.add("hfp-hiding"),this._el.root.classList.remove("hfp-visible"),this._scheduleCleanup())}reset(){this._hideTimeout&&(clearTimeout(this._hideTimeout),this._hideTimeout=null),this._el.root.classList.remove("hfp-visible","hfp-hiding"),this._el.fill.style.transform="scaleX(0)",this._el.transitionValue.textContent="",this._el.frameValue.textContent="",this._el.frameRow.style.visibility="hidden"}update(e,t){if(t!=="player"){this.reset();return}if(e.ready||!e.loading){this.hide();return}let r=typeof e.progress=="number"&&Number.isFinite(e.progress)?e.progress:0,n=typeof e.total=="number"&&Number.isFinite(e.total)?e.total:0,o=n>0?Math.min(1,Math.max(0,r/n)):0,s=Math.min(x.length-1,Math.floor(o*x.length));this._el.title.textContent=x[s]||"Preparing scene transitions",this._el.detail.textContent=e.phase==="cached"?"Loading cached transition frames before playback.":e.phase==="finalizing"?"Uploading transition textures for smooth playback.":"Rendering animated scene samples for shader transitions.",this._el.fill.style.transform=`scaleX(${o})`,this._el.transitionValue.textContent=e.currentTransition!==void 0&&e.transitionTotal!==void 0?`${e.currentTransition}/${e.transitionTotal}`:n>0?`${r}/${n}`:"";let l=e.transitionFrame!==void 0&&e.transitionFrames!==void 0?`${e.transitionFrame}/${e.transitionFrames}`:"";this._el.frameLabel.textContent=e.phase==="cached"?"cached transition frames":e.phase==="finalizing"?"finalizing transition frames":"rendering transition frames",this._el.frameValue.textContent=l,this._el.frameRow.style.visibility=l?"visible":"hidden",this._el.root.setAttribute("aria-valuenow",String(Math.round(o*100))),this.show()}get hideTimeout(){return this._hideTimeout}destroy(){this._hideTimeout&&(clearTimeout(this._hideTimeout),this._hideTimeout=null)}_scheduleCleanup(){this._hideTimeout&&clearTimeout(this._hideTimeout),this._hideTimeout=setTimeout(()=>{this._el.root.classList.remove("hfp-hiding"),this._hideTimeout=null},dt)}};var k="variables";function ut(i){return i.replace(/</g,"\\u003C")}function pt(i){return i.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function re(i){if(typeof i!="object"||i===null||Array.isArray(i))return!1;let e=Object.getPrototypeOf(i);return e===Object.prototype||e===null}function Ue(i){if(i===null)return null;try{let e=JSON.parse(i);return re(e)?e:null}catch{return null}}function je(i){return JSON.stringify(i)??"{}"}function ie(i,e){let r=`<script data-hyperframes-player-variables>window.__hfVariables = ${ut(JSON.stringify(e)??"{}")};</script>`;return/<head\b[^>]*>\s*<base\b[^>]*>/i.test(i)?i.replace(/<head\b[^>]*>\s*<base\b[^>]*>/i,n=>`${n}${r}`):/<head\b[^>]*>/i.test(i)?i.replace(/<head\b[^>]*>/i,n=>`${n}${r}`):/<html\b[^>]*>/i.test(i)?i.replace(/<html\b[^>]*>/i,n=>`${n}${r}`):`${r}${i}`}function q(i,e){try{return new URL(i,e)}catch{return null}}function $e(i,e){let t=q(i,e),r=q(e,e);return t!==null&&r!==null&&t.origin===r.origin}function ze(i,e){if(/<base\b[^>]*>/i.test(i))return i;let t=`<base href="${pt(e)}">`;return/<head\b[^>]*>/i.test(i)?i.replace(/<head\b[^>]*>/i,r=>`${r}${t}`):/<html\b[^>]*>/i.test(i)?i.replace(/<html\b[^>]*>/i,r=>`${r}<head>${t}</head>`):`<head>${t}</head>${i}`}var ct=.1,ht=5;function ne(i){return!Number.isFinite(i)||i<=0?1:Math.max(ct,Math.min(ht,i))}var X=class extends HTMLElement{static get observedAttributes(){return["src","srcdoc",k,"width","height","controls","muted","audio-locked","volume","poster","playback-rate","audio-src",w,C]}shadow;container;iframe;posterEl=null;controlsApi=null;resizeObserver;shaderLoader;probe;_ready=!1;_currentTime=0;_duration=0;_paused=!0;_scrubbing=!1;_lastUpdateMs=0;_volume=1;_compositionWidth=1920;_compositionHeight=1080;_rescaleWarned=!1;_directTimelineAdapter=null;_directTimelineClock;_parentTickRaf=null;_media;_scenes=[];_sourceGeneration=0;constructor(){super(),this.shadow=this.attachShadow({mode:"open"}),ke(this.shadow,Ee),{container:this.container,iframe:this.iframe}=Le(),this.shadow.appendChild(this.container);let e=Ve();this.shadow.appendChild(e.root),this.shaderLoader=new G(e),this._media=new B({dispatchEvent:t=>this.dispatchEvent(t),getMuted:()=>this.muted,getVolume:()=>this._volume,getPlaybackRate:()=>this.playbackRate,getCurrentTime:()=>this._currentTime,isPaused:()=>this._paused}),this._directTimelineClock=new z({onTimeUpdate:(t,r)=>{this._currentTime=t,this.controlsApi?.updateTime(t,r),this.dispatchEvent(new CustomEvent("timeupdate",{detail:{currentTime:t}}))},getLoop:()=>this.loop,restart:()=>{this.seek(0),this.play()},onPaused:()=>{this._media.audioOwner==="parent"&&this._media.pauseAll(),this._paused=!0,this.controlsApi?.updatePlaying(!1),this.dispatchEvent(new Event("ended"))},onEnded:()=>this.loop}),this.probe=new U(this.iframe,{onReady:t=>this._onProbeReady(t),onError:t=>this.dispatchEvent(new CustomEvent("error",{detail:{message:t}}))}),this.addEventListener("click",t=>{Me(t)||(this._paused?this.play():this.pause())}),this.resizeObserver=new ResizeObserver(()=>this._rescale()),this._onMessage=this._onMessage.bind(this),this._onIframeLoad=this._onIframeLoad.bind(this)}connectedCallback(){this.resizeObserver.observe(this),window.addEventListener("message",this._onMessage),this.iframe.addEventListener("load",this._onIframeLoad),this.hasAttribute("controls")&&this._setupControls(),this.hasAttribute("poster")&&(this.posterEl=K(this.shadow,this.getAttribute("poster"),this.posterEl)),this.hasAttribute("audio-src")&&this._media.setupFromUrl(this.getAttribute("audio-src")),this.hasAttribute("srcdoc")&&this._applySrcdoc(this.getAttribute("srcdoc")),this.hasAttribute("src")&&this._applySrc(this.getAttribute("src")),!this.hasAttribute("audio-locked")&&this._isLockedHostEnvironment()&&this._applyAudioLock(!0)}disconnectedCallback(){this.resizeObserver.disconnect(),window.removeEventListener("message",this._onMessage),this.iframe.removeEventListener("load",this._onIframeLoad),this.probe.stop(),this._directTimelineClock.stop(),this._stopParentTickClock(),this._directTimelineAdapter=null,this.shaderLoader.destroy(),this._media.destroy(),this.controlsApi?.destroy()}attributeChangedCallback(e,t,r){switch(e){case"src":r!==null&&(this._ready=!1,this._applySrc(r));break;case"srcdoc":this._ready=!1,r!==null?this._applySrcdoc(r):(this.iframe.removeAttribute("srcdoc"),this.hasAttribute("src")&&this._applySrc(this.getAttribute("src")??""));break;case k:this._ready=!1,this.hasAttribute("srcdoc")?this._applySrcdoc(this.getAttribute("srcdoc")??""):this.hasAttribute("src")&&this._applySrc(this.getAttribute("src")??"");break;case"width":this._compositionWidth=R(r)??1920,this._rescale();break;case"height":this._compositionHeight=R(r)??1080,this._rescale();break;case"controls":r!==null?this._setupControls():(this.controlsApi?.destroy(),this.controlsApi=null);break;case"poster":this.posterEl=K(this.shadow,r,this.posterEl);break;case"playback-rate":{let n=ne(parseFloat(r||"1"));this._media.updatePlaybackRate(n),this._sendControl("set-playback-rate",{playbackRate:n}),this._directTimelineAdapter?.timeScale?.(n),this.controlsApi?.updateSpeed(n),this.dispatchEvent(new Event("ratechange"));break}case"muted":this._handleMutedChange(r);break;case"audio-locked":this._applyAudioLock(r!==null);break;case"volume":{let n=Math.max(0,Math.min(1,parseFloat(r||"1")));this._volume=n,this._media.updateVolume(n),this._sendControl("set-volume",{volume:n}),this.controlsApi?.updateVolume(n),this.dispatchEvent(new Event("volumechange"));break}case"audio-src":r?this._media.setupFromUrl(r):this._media.teardownUrlAudio();break;case w:case C:this._reloadShaderOptions();break}}get iframeElement(){return this.iframe}get scenes(){return this._scenes}play(){this.posterEl?.remove(),this.posterEl=null,this._duration>0&&this._currentTime>=this._duration&&this.seek(0),this._paused=!1;let e=this._tryDirectTimelinePlay();e||(this._sendControl("play"),this._ready&&!this._directTimelineAdapter&&this._startParentTickClock()),this._media.audioOwner==="parent"&&this._media.playAll(),this.controlsApi?.updatePlaying(!0),this.dispatchEvent(new Event("play")),e&&this._directTimelineAdapter&&this._directTimelineClock.start(this._directTimelineAdapter,()=>this._currentTime,()=>this._duration,()=>this._paused)}pause(){this._tryDirectTimelinePause()||this._sendControl("pause"),this._directTimelineClock.stop(),this._stopParentTickClock(),this._media.audioOwner==="parent"&&this._media.pauseAll(),this._paused=!0,this.controlsApi?.updatePlaying(!1),this.dispatchEvent(new Event("pause"))}stopMedia(){this._sendControl("stop-media"),this._stopIframeMedia(),this._media.stopAdoptedMedia()}seek(e){!this._trySyncSeek(e)&&!this._tryDirectTimelineSeek(e)&&this._sendControl("seek",{frame:Math.round(e*30)}),this._directTimelineClock.stop(),this._stopParentTickClock(),this._currentTime=e,this._media.audioOwner==="parent"&&(this._scrubbing?this._media.scrubAll(e):(this._media.pauseAll(),this._media.seekAll(e))),this._paused=!0,this.controlsApi?.updatePlaying(!1),this.controlsApi?.updateTime(this._currentTime,this._duration)}setColorGrading(e,t){this._sendControl("set-color-grading",{target:e,grading:t})}clearColorGrading(e){this._sendControl("set-color-grading",{target:e,grading:null})}setColorGradingCompare(e,t){this._sendControl("set-color-grading-compare",{target:e,compare:t})}clearColorGradingCompare(e){this._sendControl("set-color-grading-compare",{target:e,compare:{enabled:!1}})}get currentTime(){return this._currentTime}set currentTime(e){this.seek(e)}get duration(){return this._duration}get paused(){return this._paused}get ready(){return this._ready}get playbackRate(){return ne(parseFloat(this.getAttribute("playback-rate")||"1"))}set playbackRate(e){this.setAttribute("playback-rate",String(ne(e)))}get shaderCaptureScale(){return Ne(this)}set shaderCaptureScale(e){this.setAttribute(w,String(e))}get shaderLoading(){return M(this)}set shaderLoading(e){e==="composition"?this.removeAttribute(C):this.setAttribute(C,e)}get variables(){return Ue(this.getAttribute(k))}set variables(e){if(e===null){this.removeAttribute(k);return}if(!re(e))throw new TypeError("hyperframes-player variables must be a plain object or null");this.setAttribute(k,je(e))}get muted(){return this.hasAttribute("muted")}set muted(e){e?this.setAttribute("muted",""):this.removeAttribute("muted")}get audioLocked(){return this.hasAttribute("audio-locked")}set audioLocked(e){e?this.setAttribute("audio-locked",""):this.removeAttribute("audio-locked")}_isLockedHostEnvironment(){if(typeof navigator>"u")return!1;let e=navigator.userAgent||"";return/\bClaude\/\d/.test(e)&&/\bElectron\b/.test(e)}_isAudioLocked(){return this.hasAttribute("audio-locked")||this._isLockedHostEnvironment()}_isSlideshowPlayer(){return this.closest("hyperframes-slideshow")!==null}_handleMutedChange(e){if(e===null&&this._isAudioLocked()){this.setAttribute("muted","");return}this._media.updateMuted(e!==null),this._setIframeMediaMuted(e!==null),this._sendControl("set-muted",{muted:e!==null}),this.controlsApi?.updateMuted(e!==null),this.dispatchEvent(new Event("volumechange"))}_applyAudioLock(e){e&&(this.muted=!0),this.controlsApi?.setVolumeControlsHidden(e)}get volume(){return this._volume}set volume(e){this.setAttribute("volume",String(Math.max(0,Math.min(1,e))))}get loop(){return this.hasAttribute("loop")}set loop(e){e?this.setAttribute("loop",""):this.removeAttribute("loop")}_sendControl(e,t={}){try{this.iframe.contentWindow?.postMessage({source:"hf-parent",type:"control",action:e,...t},"*")}catch{}}_getSameOriginIframeDocument(){try{return this.iframe.contentDocument}catch{return null}}_setIframeMediaMuted(e){let t=this._getSameOriginIframeDocument();if(t)for(let r of t.querySelectorAll("video, audio"))g(r)&&(r.muted=e||r.defaultMuted)}_stopIframeMedia(){let e=this._getSameOriginIframeDocument();if(e)for(let t of e.querySelectorAll("video, audio"))g(t)&&t.pause()}_replayBridgeState(){this._sendControl("set-muted",{muted:this.muted}),this._sendControl("set-volume",{volume:this._volume}),this._sendControl("set-playback-rate",{playbackRate:this.playbackRate}),this._sendControl("set-native-media-sync-disabled",{disabled:this._isSlideshowPlayer()}),this._sendControl("set-web-audio-media-disabled",{disabled:this._isSlideshowPlayer()})}_reloadShaderOptions(){if(M(this)!=="player"&&this.shaderLoader.reset(),this.hasAttribute("srcdoc")){this._applySrcdoc(this.getAttribute("srcdoc")??"");return}this.hasAttribute("src")&&this._applySrc(this.getAttribute("src")??"")}_applySrcdoc(e){this._sourceGeneration+=1;let t=te(this,e),r=this.variables;r!==null&&(t=ie(t,r)),this.iframe.srcdoc=t}_applySrc(e){let t=Fe(this,e),r=this._sourceGeneration+=1,n=this.variables;if(n===null||this.hasAttribute("srcdoc")){this.hasAttribute("srcdoc")||this.iframe.removeAttribute("srcdoc"),this.iframe.src=t;return}let o=this.ownerDocument?.baseURI??(typeof location<"u"?location.href:""),s=q(t,o);if(s===null||!$e(t,o)){this._warnAndDispatchVariablesError("[hyperframes-player] variables require a same-origin src so they can be injected before composition scripts run; loading without variables."),this.iframe.removeAttribute("srcdoc"),this.iframe.src=t;return}this.iframe.removeAttribute("src"),this._fetchAndApplySrcdoc(t,s,n,r)}async _fetchAndApplySrcdoc(e,t,r,n){try{let o=await fetch(t.href);if(n!==this._sourceGeneration)return;if(!o.ok){let u=[String(o.status),o.statusText].filter(Boolean).join(" ");throw new Error(u||"HTTP error")}let s=await o.text();if(n!==this._sourceGeneration)return;let l=te(this,s);l=ie(l,r),l=ze(l,t.href),this.iframe.removeAttribute("src"),this.iframe.srcdoc=l}catch(o){if(n!==this._sourceGeneration)return;let l=`[hyperframes-player] Failed to fetch same-origin src for variables injection (${o instanceof Error?o.message:String(o)}); loading without variables.`;this._warnAndDispatchVariablesError(l),this.iframe.removeAttribute("srcdoc"),this.iframe.src=e}}_warnAndDispatchVariablesError(e){console.warn(e),this.dispatchEvent(new CustomEvent("error",{detail:{message:e}}))}_trySyncSeek(e){try{let r=this.iframe.contentWindow?.__player;return typeof r?.seek!="function"?!1:(r.seek.call(r,e),!0)}catch{return!1}}_withDirectTimeline(e){let t=this._directTimelineAdapter||this.probe.resolveDirectTimelineAdapter();if(!t)return!1;try{return e(t),this._directTimelineAdapter=t,!0}catch{return!1}}_tryDirectTimelineSeek(e){return this._withDirectTimeline(t=>{t.seek(e,!1),t.pause()})}_tryDirectTimelinePlay(){return this._withDirectTimeline(e=>{e.play()})}_tryDirectTimelinePause(){return this._withDirectTimeline(e=>{e.pause()})}_startParentTickClock(){this._stopParentTickClock();let e=()=>{if(this._paused){this._parentTickRaf=null;return}this._sendControl("tick"),this._parentTickRaf=requestAnimationFrame(e)};this._parentTickRaf=requestAnimationFrame(e)}_stopParentTickClock(){this._parentTickRaf!==null&&(cancelAnimationFrame(this._parentTickRaf),this._parentTickRaf=null)}_onMessage(e){Oe(e,this.iframe.contentWindow,{getPlaybackState:()=>({currentTime:this._currentTime,duration:this._duration,paused:this._paused,lastUpdateMs:this._lastUpdateMs}),setPlaybackState:({currentTime:t,duration:r,paused:n,lastUpdateMs:o})=>{this._currentTime=t,this._duration=r,this._paused=n,this._lastUpdateMs=o},getShaderLoadingMode:()=>M(this),shaderLoader:this.shaderLoader,setCompositionSize:(t,r)=>{this._compositionWidth=t,this._compositionHeight=r,this._rescale()},sendControl:(t,r)=>this._sendControl(t,r),getIframeDoc:()=>this.iframe.contentDocument,onRuntimeReady:()=>this._replayBridgeState(),onRuntimeTimelineReady:t=>this._onRuntimeTimelineReady(t),shouldPromoteMediaAutoplayFallback:()=>!this._isSlideshowPlayer(),setScenes:t=>{this._scenes=t,this.dispatchEvent(new CustomEvent("scenes",{detail:{scenes:t}}))},updateControlsTime:(t,r)=>this.controlsApi?.updateTime(t,r),updateControlsPlaying:t=>this.controlsApi?.updatePlaying(t),dispatchEvent:t=>this.dispatchEvent(t),seek:t=>this.seek(t),play:()=>this.play(),getLoop:()=>this.loop,media:this._media})}_onRuntimeTimelineReady(e){if(this._ready)return;this.probe.stop(),this._duration=e,this._directTimelineAdapter=null,this._ready=!0,this.controlsApi?.updateTime(this._currentTime,e),this.dispatchEvent(new CustomEvent("ready",{detail:{duration:e}})),this._rescale();let t=this._getSameOriginIframeDocument();t&&this._media.setupFromIframe(t),this._replayBridgeState(),this._setIframeMediaMuted(this.muted),this.hasAttribute("autoplay")&&this.play()}_onProbeReady({duration:e,adapter:t,compositionSize:r}){this._duration=e,this._directTimelineAdapter=t.kind==="direct-timeline"?t.timeline:null,this._ready=!0,this.controlsApi?.updateTime(0,e),this.dispatchEvent(new CustomEvent("ready",{detail:{duration:e}})),r&&(this._compositionWidth=r.width,this._compositionHeight=r.height,this._rescale());try{let n=this.iframe.contentDocument;n&&this._media.setupFromIframe(n)}catch{}this._setIframeMediaMuted(this.muted),this.hasAttribute("autoplay")&&this.play()}_rescale(){!Pe(this,this.iframe,this._compositionWidth,this._compositionHeight)&&this._ready&&!this._rescaleWarned&&(this._rescaleWarned=!0,console.warn("[hyperframes-player] rescale no-op after ready \u2014 zero-size player element",{src:this.getAttribute("src"),offsetWidth:this.offsetWidth,offsetHeight:this.offsetHeight,compositionWidth:this._compositionWidth,compositionHeight:this._compositionHeight}))}_onIframeLoad(){this._directTimelineAdapter=null,this._directTimelineClock.stop(),this._stopParentTickClock(),this.shaderLoader.reset(),this._media.resetForIframeLoad(),this.probe.start()}_setupControls(){this.controlsApi||(this.controlsApi=xe(this.shadow,this.muted,this._volume,this.getAttribute("speed-presets"),{onPlay:()=>this.play(),onPause:()=>this.pause(),onSeek:e=>this.seek(e*this._duration),onScrubStart:()=>{this._scrubbing=!0},onScrubEnd:()=>{this._scrubbing=!1,this.seek(this._currentTime)},onSpeedChange:e=>{this.playbackRate=e},onMuteToggle:()=>{this.muted=!this.muted},onVolumeChange:e=>{this.volume=e}},this._isAudioLocked()))}get _audioOwner(){return this._media.audioOwner}get _parentMedia(){return this._media.entries}_mirrorParentMediaTime(e,t){this._media.mirrorTime(e,t)}_promoteToParentProxy(){let e=null;try{e=this.iframe.contentDocument}catch{}this._media.promoteToParentProxy(e,(t,r)=>this._mirrorParentMediaTime(t,r)),this._sendControl("set-media-output-muted",{muted:!0})}_observeDynamicMedia(e){this._media.setupFromIframe(e)}};customElements.get("hyperframes-player")||customElements.define("hyperframes-player",X);return Je(mt);})();
//# sourceMappingURL=hyperframes-player.global.js.map