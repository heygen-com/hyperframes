import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
const W=400,H=300;
const HTML=`<!doctype html><meta charset=utf-8>
<style>*{margin:0;padding:0}html,body{width:${W}px;height:${H}px;background:#ece8dd}
#root{position:relative;width:${W}px;height:${H}px;background:#ece8dd}
.headline{position:absolute;top:20px;left:0;width:100%;text-align:center;font:700 28px serif;color:#1a2640}
#el{position:absolute;top:100px;left:100px;width:200px;height:60px;background:#1a2640;color:#fff;
  font:700 24px serif;text-align:center;line-height:60px}
#footer{position:absolute;top:220px;left:0;width:100%;text-align:center;font:700 20px serif;color:#406080}</style>
<div id=root><div class=headline>HEADLINE</div><div id=el>CARD</div><div id=footer>FOOTER</div></div>
<script>
const root=document.getElementById("root");
const canvas=document.createElement("canvas");
canvas.setAttribute("layoutsubtree","");canvas.width=${W};canvas.height=${H};
canvas.style.cssText="display:block;position:absolute;top:0;left:0";
root.parentNode.insertBefore(canvas,root);canvas.appendChild(root);
window.__cap=(tf)=>{
  document.getElementById("el").style.transform=tf;
  const ctx=canvas.getContext("2d");
  return new Promise(r=>requestAnimationFrame(()=>setTimeout(()=>{
    try{ctx.clearRect(0,0,${W},${H});ctx.drawElementImage(root,0,0);}catch(e){return r({err:String(e)});}
    const url=canvas.toDataURL("image/png");ctx.clearRect(0,0,${W},${H});r({url});
  },30)));
};
</script>`;
const b=await puppeteer.launch({headless:true,args:["--no-sandbox","--enable-features=CanvasDrawElement","--use-gl=angle",`--window-size=${W},${H}`]});
const p=await b.newPage();await p.setViewport({width:W,height:H});
await p.setContent(HTML,{waitUntil:"load"});
const CASES={
  "none":"none",
  "rotate2d":"rotate(10deg)",
  "rotateX45-noPersp":"rotateX(45deg)",
  "translate3dZ":"translate3d(0px, 20px, -100px)",
  "gsap-entrance":"translate3d(0px, 60px, -100px) rotateX(-45deg)",
  "translateZ0":"translateZ(0px)",
};
for(const [name,tf] of Object.entries(CASES)){
  const r=await p.evaluate((t)=>window.__cap(t),tf);
  if(r.err){console.log(name,"ERR",r.err);continue;}
  writeFileSync(`/tmp/flat3d-${name}.png`,Buffer.from(r.url.split(",")[1],"base64"));
  // size heuristic: blank captures are tiny
  console.log(name, "bytes:", Buffer.from(r.url.split(",")[1],"base64").length);
}
await b.close();
