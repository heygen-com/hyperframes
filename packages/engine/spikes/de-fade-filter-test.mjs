// Can drawElementImage capture a mid-fade if the fade is filter:opacity()
// instead of opacity? Reproduces the crossfade drop (two stacked scene
// wrappers at partial opacity) and compares both fade mechanisms.
import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
const W=400,H=300;
const HTML=`<!doctype html><meta charset=utf-8>
<style>*{margin:0;padding:0}html,body{width:${W}px;height:${H}px;background:#0F172A}
#root{position:relative;width:${W}px;height:${H}px;background:#0F172A}
.scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  flex-direction:column;font:700 28px sans-serif}
#s1{background:#1E293B;color:#F8FAFC}
#s2{background:#0F172A;color:#38BDF8}
.caption{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);
  background:#fff;color:#000;padding:6px 16px;font:700 16px sans-serif;z-index:100}
</style>
<div id=root>
  <div class=scene id=s1><div>SCENE ONE</div><div style="font-size:16px;color:#94A3B8">outgoing</div></div>
  <div class=scene id=s2><div>SCENE TWO</div><div style="font-size:16px;color:#94A3B8">incoming</div></div>
  <div class=caption>CAPTION PILL</div>
</div>
<script>
window.__fade=(mode,a)=>{
  const s1=document.getElementById("s1"),s2=document.getElementById("s2");
  // zoom-crossfade like gen_os: outgoing scales up past 1, incoming scales in
  s1.style.transform="scale("+(1+a*0.3)+")";
  s2.style.transform="scale("+(0.7+a*0.3)+")";
  if(mode==="opacity"){ s1.style.filter=""; s2.style.filter="";
    s1.style.opacity=String(1-a); s2.style.opacity=String(a); }
  else { s1.style.opacity="1"; s2.style.opacity="1";
    s1.style.filter="opacity("+(1-a)+")"; s2.style.filter="opacity("+a+")"; }
};
const root=document.getElementById("root");
const canvas=document.createElement("canvas");
canvas.setAttribute("layoutsubtree","");canvas.width=${W};canvas.height=${H};
canvas.style.cssText="display:block;position:absolute;top:0;left:0";
root.parentNode.insertBefore(canvas,root);canvas.appendChild(root);
window.__cap=()=>{
  const ctx=canvas.getContext("2d");
  return new Promise(r=>requestAnimationFrame(()=>setTimeout(()=>{
    try{ctx.clearRect(0,0,${W},${H});ctx.fillStyle="#0F172A";ctx.fillRect(0,0,${W},${H});
      ctx.drawElementImage(root,0,0);}catch(e){return r({err:String(e)});}
    const url=canvas.toDataURL("image/png");ctx.clearRect(0,0,${W},${H});r({url});
  },40)));
};
</script>`;
const b=await puppeteer.launch({headless:true,args:["--no-sandbox","--enable-features=CanvasDrawElement","--use-gl=angle",`--window-size=${W},${H}`]});
const p=await b.newPage();await p.setViewport({width:W,height:H});
await p.setContent(HTML,{waitUntil:"load"});
// animate several frames first (the bug needs per-frame writes), then capture mid-fade
for(const mode of ["opacity","filter"]){
  for(let i=0;i<=10;i++){ await p.evaluate(({m,a})=>window.__fade(m,a),{m:mode,a:i/10});
    await p.evaluate(()=>new Promise(r=>requestAnimationFrame(r))); }
  await p.evaluate(({m})=>window.__fade(m,0.5),{m:mode});
  const r=await p.evaluate(()=>window.__cap());
  if(r.err){console.log(mode,"ERR",r.err);continue;}
  writeFileSync(`/tmp/fade-${mode}.png`,Buffer.from(r.url.split(",")[1],"base64"));
  console.log(mode,"captured");
}
await b.close();
