// GENERATED — do not hand-edit. Source: packages/core/src/terminalText.ts, bundled by
// scripts/generate-media-use-terminal-text.mjs so the unbundled media-use engine shows control
// characters the way the rest of the CLI does. Regenerate: node scripts/generate-media-use-terminal-text.mjs
var s=t=>t<32&&t!==9||t>=127&&t<=159;function o(t){let r="";for(let n of t){let e=n.charCodeAt(0);r+=s(e)?`\\x${e.toString(16).padStart(2,"0")}`:n}return r}function p(t){return t.split(`
`).map(o).join(`
`)}var c=t=>{let r=Object.getPrototypeOf(t);return r===Object.prototype||r===null};function i(t){return typeof t=="string"?o(t):Array.isArray(t)?t.map(i):t!==null&&typeof t=="object"&&c(t)?Object.fromEntries(Object.entries(t).map(([r,n])=>[o(r),i(n)])):t}export{p as terminalLines,o as terminalText,i as terminalTextDeep};
