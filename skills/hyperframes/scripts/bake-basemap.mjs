// bake-basemap.mjs — bake a real-imagery map camera move for a composition (references/film.md, "Maps").
//
// WHAT IT DOES (and why baking at all): drives MapLibre in headless Chrome to record ONLY the
// real-imagery basemap as an MP4 (camera zoom→hold), and projects each requested country's border
// to SCREEN coordinates at the held view. The HF composition then plays the MP4 on track 0 and
// animates a *live* SVG overlay (border draw-on, colour-block / flag fills, labels, pins) from the
// exported `<NAME>-coords.json`. Borders/fills are NOT baked into the video — they stay editable in HF.
//
// Why bake the imagery at all (this is the real reason, not "smoothness"): HF forbids render-time
// network and requires deterministic output. Live raster tiles re-fetch every render and can change
// → non-deterministic. Baking FREEZES the imagery into pixels = deterministic + offline-reproducible.
// (Exposing the engine's per-frame `onBeforeCapture` hook would let MapLibre run live and smooth, but
// it would NOT remove the need to freeze tiles for determinism — so this bake step stays relevant.)
//
// PARAMETRIC — drive everything by env. Example (Brazil + Argentina on satellite):
//   NAME=br-ar STYLE=satellite COUNTRIES="Brazil:#22d3ee,Argentina:#f59e0b" \
//   CENTER="-60,-25" ZSTART=2.4 ZEND=3.4 FPS=30 DUR=5 node bake-basemap.mjs
// From space down to a street (globe, starfield, a turn from FROM to CENTER, then the dive):
//   NAME=mbs PROJECTION=globe FROM="18,16" CENTER="103.8607,1.2834" ZSTART=1.85 ZEND=16.2 \
//   PITCH=40 DUR=10 HOLD=0.8 node bake-basemap.mjs
// It encodes frames-<NAME>/f%04d.png → <NAME>.mp4 (all-intra: -g 1) and writes <NAME>-coords.json
// for the HF composition. One bake at a time: several headless Chromes on a small machine stall.
import { join } from "node:path";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`usage: [NAME=..] [STYLE=satellite|dark|light|<{z}/{x}/{y} url>] [CENTER="lng,lat"]
       [PROJECTION=mercator|globe] [FROM="lng,lat"] [PAN=0.35] [ZSTART=..] [ZEND=..] [PITCH=..]
       [BEARING=..] [FPS=30] [DUR=5] [HOLD=0.5] [COUNTRIES="Name:#hex,Name:#hex"] [OUT=dir]
       [CHROME=path] node bake-basemap.mjs
PROJECTION=globe starts from Earth in space (starfield, atmosphere) and flattens as it zooms in.
FROM pans the camera from that point to CENTER over the first PAN of the move, while the zoom
runs from PAN/2 to HOLD; ZSTART about 1.8 frames the whole globe, ZEND 16 is a building.
Writes <OUT>/<NAME>.mp4 (all-intra basemap) and <OUT>/<NAME>-coords.json (projected borders).
Needs puppeteer-core, ffmpeg, a Chrome or chrome-headless-shell, and network for the tiles.
Run one bake at a time; it prints its pace and an estimate as it goes.`);
  process.exit(0);
}

// Loaded after the --help check so usage prints without puppeteer-core installed.
const { default: puppeteer } = await import("puppeteer-core");

// --- resolve Chrome dynamically (no hardcoded machine path) ---
function resolveChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const base = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  if (existsSync(base)) {
    for (const v of readdirSync(base).sort().reverse()) {
      // lexical sort; any working binary is fine
      try {
        for (const inner of readdirSync(join(base, v))) {
          const bin = join(base, v, inner, exe);
          if (existsSync(bin)) return bin;
        }
      } catch {
        /* skip */
      }
    }
  }
  for (const c of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ])
    if (existsSync(c)) return c;
  throw new Error(
    "Chrome not found. Set CHROME=/path/to/chrome-headless-shell, or install one:\n" +
      "  npx puppeteer browsers install chrome-headless-shell",
  );
}

// --- params (all overridable by env) ---
const NAME = process.env.NAME || "basemap";
const STYLE = process.env.STYLE || "satellite"; // satellite | dark | light | raw {z}/{x}/{y} template
const CENTER = (process.env.CENTER || "2.6,46.6").split(",").map(Number);
const ZSTART = +(process.env.ZSTART || 4.2);
const ZEND = +(process.env.ZEND || 5.4);
const PITCH = +(process.env.PITCH || 0);
const BEARING = +(process.env.BEARING || 0);
const FPS = +(process.env.FPS || 30),
  DUR = +(process.env.DUR || 5),
  N = Math.max(1, Math.round(FPS * DUR));
const HOLD = +(process.env.HOLD || 0.5); // p∈[0,1] at which the zoom finishes; camera holds after
const PROJECTION = process.env.PROJECTION === "globe" ? "globe" : "mercator";
const FROM = process.env.FROM ? process.env.FROM.split(",").map(Number) : null; // pan start; null = no pan
const PAN = +(process.env.PAN || 0.35); // p at which the pan from FROM reaches CENTER
const MARGIN = (process.env.KEEPMARGIN || "16,13").split(",").map(Number); // [lon°,lat°] keep-box around each country's mainland
// COUNTRIES="Name:#hex,Name:#hex" — borders to project (optional; omit for a pure zoom-to / pin shot)
const COUNTRIES = (process.env.COUNTRIES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [name, color] = s.split(":");
    return { name, color: color || "#38bdf8" };
  });

// fail fast on bad numeric env — otherwise NaN silently bakes zero/garbage frames and still prints "done"
for (const [k, v] of Object.entries({
  "CENTER.lng": CENTER[0],
  "CENTER.lat": CENTER[1],
  ZSTART,
  ZEND,
  PITCH,
  BEARING,
  FPS,
  DUR,
  HOLD,
  PAN,
  ...(FROM ? { "FROM.lng": FROM[0], "FROM.lat": FROM[1] } : {}),
}))
  if (!Number.isFinite(v))
    throw new Error(
      `bad numeric env: ${k}=${v} — check CENTER="lng,lat" / ZSTART / ZEND / FPS / DUR`,
    );

// IMPORTANT: tileSize:256 matches Esri/CARTO raster endpoints. MapLibre's INTERNAL world width is
// 512·2^zoom regardless — a 512px (@2x/retina/vector) tile source needs tileSize:512 or every zoom
// level is off by one. Keep 256 for these raster sources.
const TILES =
  {
    satellite:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    dark: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    light: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  }[STYLE] || STYLE; // STYLE may also be a raw {z}/{x}/{y} template

const OUT = process.env.OUT || process.cwd(); // artifacts → workspace (cwd), NOT the installed skill dir
const framesDir = join(OUT, "frames-" + NAME);
mkdirSync(framesDir, { recursive: true });

// A seeded star field behind the globe, so every bake of the same move is identical.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const STARS = `<svg id="stars" width="1920" height="1080">${Array.from({ length: 260 }, () => {
  const x = (rnd() * 1920).toFixed(0),
    y = (rnd() * 1080).toFixed(0);
  const r = (rnd() * 1.3 + 0.3).toFixed(2),
    a = (rnd() * 0.6 + 0.2).toFixed(2);
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${a}"/>`;
}).join("")}</svg>`;

// Deps PINNED exact (mutable @5/@2 majors would drift the bake over time).
const PAGE = `<!doctype html><html><head>
<link href="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<script src="https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"></script>
<style>*{margin:0}html,body{width:1920px;height:1080px;overflow:hidden;background:radial-gradient(ellipse at 50% 55%,#0b1630 0%,#050812 55%,#020308 100%)}#stars{position:absolute;inset:0}#map{position:absolute;inset:0;width:1920px;height:1080px}.maplibregl-control-container{display:none!important}</style>
</head><body>${PROJECTION === "globe" ? STARS : ""}<div id="map"></div><script>
var CENTER=${JSON.stringify(CENTER)}, ZSTART=${ZSTART}, ZEND=${ZEND}, PITCH=${PITCH}, BEARING=${BEARING}, HOLD=${HOLD};
var FROM=${JSON.stringify(FROM)}, PAN=${PAN};
var MARGIN=${JSON.stringify(MARGIN)}, WANT=${JSON.stringify(COUNTRIES)};
var GLOBE=${PROJECTION === "globe"};
// On the globe the page behind the map shows through (stars), and the atmosphere fades out as the camera nears the ground.
var map=new maplibregl.Map({container:"map",style:{version:8,projection:{type:GLOBE?"globe":"mercator"},
  sky:GLOBE?{"atmosphere-blend":["interpolate",["linear"],["zoom"],0,1,5,1,7,0]}:undefined,
  sources:{s:{type:"raster",tiles:[${JSON.stringify(TILES)}],tileSize:256,maxzoom:19}},
  layers:(GLOBE?[]:[{id:"bg",type:"background",paint:{"background-color":"#05070d"}}]).concat([{id:"s",type:"raster",source:"s"}])},
  center:FROM||CENTER,zoom:ZSTART,pitch:0,bearing:0,interactive:false,attributionControl:false,fadeDuration:0,preserveDrawingBuffer:true,maxTileCacheSize:6000,
  canvasContextAttributes:{alpha:GLOBE,preserveDrawingBuffer:true}});
function ease(x){return x<0.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;} // easeInOutCubic (= Remotion interpolate+Easing)
function sine(x){return -(Math.cos(Math.PI*x)-1)/2;}
function seg(p,a,b){return b<=a?1:Math.min(1,Math.max(0,(p-a)/(b-a)));}
// With FROM, the camera turns to CENTER over [0,PAN] while the zoom runs over [PAN/2,HOLD]; without it, the zoom runs over [0,HOLD].
function camAt(p){
  var s=FROM?sine(seg(p,0,PAN)):1, t=ease(seg(p,FROM?PAN/2:0,HOLD));
  var c=FROM?[FROM[0]+(CENTER[0]-FROM[0])*s, FROM[1]+(CENTER[1]-FROM[1])*s]:CENTER;
  return {center:c, zoom:ZSTART+(ZEND-ZSTART)*t, pitch:PITCH*t, bearing:BEARING*t}; }
function ringCentroid(r){ var sx=0,sy=0; for(var k=0;k<r.length;k++){sx+=r[k][0];sy+=r[k][1];} return [sx/r.length, sy/r.length]; }
// Keep the polygons in a lon/lat box around the country's MAINLAND (the vertex-richest polygon),
// dropping far-flung overseas territories that would blow up the bbox. Generalizes per subject —
// no continent-specific constant. Keeps near islands (Corsica, Sicily); drops Guiana, Alaska, Hawaii.
function mainland(f){
  if(!f) return f;
  if(f.geometry.type!=="MultiPolygon"){ f.__anchorRing=f.geometry.coordinates[0]; return f; } // Polygon: outer ring
  var polys=f.geometry.coordinates, anchor=polys[0], amax=-1;
  polys.forEach(function(poly){ if(poly[0].length>amax){amax=poly[0].length;anchor=poly;} });
  var ac=ringCentroid(anchor[0]);
  var kept=polys.filter(function(poly){ var c=ringCentroid(poly[0]); return Math.abs(c[0]-ac[0])<=MARGIN[0] && Math.abs(c[1]-ac[1])<=MARGIN[1]; });
  var nf={type:"Feature",properties:f.properties,geometry:{type:"MultiPolygon",coordinates:kept}}; nf.__anchorRing=anchor[0]; return nf;
}
function lonSpan(f){ var mn=1e9,mx=-1e9; (f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates).forEach(function(poly){poly[0].forEach(function(c){if(c[0]<mn)mn=c[0];if(c[0]>mx)mx=c[0];});}); return mx-mn; }
// ANTIMERIDIAN unwrap (Russia/Fiji/NZ): make all lon contiguous around the camera-center ref so a
// feature touching ±180° doesn't smear when map.project() runs per-vertex (mercatorX is linear and
// accepts out-of-range lon, so 181 sits just east of center, not far-west at -179). Mutates in place;
// __anchorRing shares the same arrays so it's covered.
function unwrapLon(f, ref){ if(!f) return; function fix(r){ for(var i=0;i<r.length;i++){ var lon=r[i][0]; while(lon-ref>180)lon-=360; while(lon-ref<-180)lon+=360; r[i][0]=lon; } }
  var g=f.geometry; if(g.type==="Polygon") g.coordinates.forEach(fix); else g.coordinates.forEach(function(poly){ poly.forEach(fix); }); }
var FEATS=[]; window.__warn=[];
window.__ready=new Promise(function(res){ map.on("load", function(){
  if(!WANT.length){ res(); return; }
  fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json").then(function(r){return r.json();}).then(function(w){
    var fc=topojson.feature(w,w.objects.countries);
    WANT.forEach(function(want){
      var f=fc.features.filter(function(x){return x.properties.name===want.name;})[0];
      if(!f){ window.__warn.push("country not found in world-atlas: "+want.name); return; }
      f=mainland(f);
      unwrapLon(f, CENTER[0]); // antimeridian: unwrap lons around the camera ref (CENTER must be near the subject) before projecting
      if(lonSpan(f)>180) window.__warn.push(want.name+" spans >180° lon even after unwrap — projection may still smear.");
      FEATS.push({name:want.name, color:want.color, f:f});
    });
    res();
  });
});});
window.__setCam=function(p){ map.jumpTo(camAt(p)); };
// Resolves false once every tile for this camera is loaded and painted, true if ms passed first.
// Polls rather than waiting for "idle": that event can fire before a listener is attached, which
// left every cached frame sitting out the whole timeout.
window.__waitIdle=function(ms){ return new Promise(function(res){ var t0=performance.now();
  (function poll(){ if(map.loaded()&&map.areTilesLoaded()){ map.triggerRepaint(); requestAnimationFrame(function(){requestAnimationFrame(function(){res(false);});}); return; }
    if(performance.now()-t0>(ms||9000)){ res(!map.areTilesLoaded()); return; } setTimeout(poll,40); })(); }); };
function featurePath(f){ function ring(r){ return r.map(function(c,i){ var p=map.project(c); return (i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1); }).join(" ")+"Z"; }
  var g=f.geometry,d=""; if(g.type==="Polygon") g.coordinates.forEach(function(r){d+=ring(r);}); else g.coordinates.forEach(function(poly){poly.forEach(function(r){d+=ring(r);});}); return d; }
function bboxOf(f){ var mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
  function eat(r){ r.forEach(function(c){ var p=map.project(c); if(p.x<mnx)mnx=p.x; if(p.y<mny)mny=p.y; if(p.x>mxx)mxx=p.x; if(p.y>mxy)mxy=p.y; }); }
  var g=f.geometry; if(g.type==="Polygon")g.coordinates.forEach(eat); else g.coordinates.forEach(function(poly){poly.forEach(eat);});
  return {x:+mnx.toFixed(1),y:+mny.toFixed(1),w:+(mxx-mnx).toFixed(1),h:+(mxy-mny).toFixed(1)}; }
window.__project=function(){ return {
  view:{center:CENTER, zoom:ZEND, pitch:PITCH, bearing:BEARING},
  countries: FEATS.map(function(e){ var lc=ringCentroid(e.f.__anchorRing); var lp=map.project(lc);
    return { name:e.name, color:e.color, d:featurePath(e.f), bbox:bboxOf(e.f), label:{x:+lp.x.toFixed(1),y:+lp.y.toFixed(1)} }; }),
}; };
</script></body></html>`;

// --no-sandbox is intentional: trusted Source-time bake, headless, often root/CI; deps are version-pinned above.
const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: true,
  args: [
    "--no-sandbox",
    "--hide-scrollbars",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--enable-webgl",
    "--window-size=1920,1080",
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.setContent(PAGE, { waitUntil: "load" });
  await page.evaluate(() => window.__ready);
  for (const w of await page.evaluate(() => window.__warn)) console.warn(`[${NAME}] WARN: ${w}`);
  console.log(
    `[${NAME}] ready (${STYLE}, ${PROJECTION}); baking ${N} frames, zoom ${ZSTART}→${ZEND} hold@p=${HOLD}, ${COUNTRIES.length} border(s)`,
  );
  const t0 = Date.now();
  let coords = null;
  const timeouts = [];
  for (let i = 0; i < N; i++) {
    const p = N === 1 ? 1 : i / (N - 1);
    await page.evaluate((pp) => window.__setCam(pp), p);
    const timedOut = await page.evaluate((ms) => window.__waitIdle(ms), 9000);
    if (timedOut) {
      timeouts.push(i);
      console.warn(`[${NAME}] idle TIMEOUT at frame ${i} — tiles may be incomplete`);
    }
    await page.screenshot({
      path: join(framesDir, `f${String(i).padStart(4, "0")}.png`),
      clip: { x: 0, y: 0, width: 1920, height: 1080 },
      optimizeForSpeed: true,
    });
    if (p >= HOLD && !coords && COUNTRIES.length)
      coords = await page.evaluate(() => window.__project()); // capture at first hold frame
    if (i % 20 === 0 || i === N - 1) {
      const per = (Date.now() - t0) / 1000 / (i + 1);
      console.log(
        `  [${NAME}] ${i + 1}/${N} · ${per.toFixed(2)} s/frame · about ${Math.ceil((per * (N - i - 1)) / 60)} min left`,
      );
    }
  }
  // encode frames → all-intra MP4 (every frame seekable for HF); fall back to printing the command if ffmpeg is absent
  const mp4 = join(OUT, NAME + ".mp4"),
    pat = join(framesDir, "f%04d.png");
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      pat,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "1",
      "-crf",
      "16",
      "-movflags",
      "+faststart",
      mp4,
    ],
    { stdio: "ignore" },
  );
  if (ff.status === 0) console.log(`[${NAME}] encoded → ${mp4}`);
  else
    console.warn(
      `[${NAME}] ffmpeg unavailable (status ${ff.status}) — encode manually:\n  ffmpeg -y -framerate ${FPS} -i ${pat} -c:v libx264 -pix_fmt yuv420p -g 1 -crf 16 -movflags +faststart ${mp4}`,
    );
  if (coords) {
    writeFileSync(join(OUT, NAME + "-coords.json"), JSON.stringify(coords));
    console.log(
      `[${NAME}] coords written: ${coords.countries.map((c) => c.name + "(" + c.d.length + "ch)").join(", ")}`,
    );
  }
  if (timeouts.length) {
    // FAIL LOUD: the asset exists but is suspect — don't let a half-loaded bake pass silently
    console.error(
      `[${NAME}] ${timeouts.length}/${N} frame(s) hit the idle timeout (frames ${timeouts.slice(0, 8).join(",")}${timeouts.length > 8 ? "…" : ""}). The basemap MP4 may have INCOMPLETE tiles. Re-run with a slower zoom / larger timeout / check the tile server.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`[${NAME}] done — all ${N} frames reached map idle (complete tiles).`);
  }
} finally {
  await browser.close();
}
