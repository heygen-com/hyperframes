import { H, NQ } from "./common.js";

interface ShaderDef {
  frag: string;
}

const shaders: Record<string, ShaderDef> = {
  "domain-warp": {
    frag:
      H +
      NQ +
      "void main(){" +
      "vec2 q=vec2(fbm(v_uv*3.),fbm(v_uv*3.+vec2(5.2,1.3)));" +
      "vec2 r=vec2(fbm(v_uv*3.+q*4.+vec2(1.7,9.2)),fbm(v_uv*3.+q*4.+vec2(8.3,2.8)));" +
      "float n=fbm(v_uv*3.+r*2.);" +
      "vec2 warpDir=(q-.5)*.4;" +
      "vec4 A=texture2D(u_from,clamp(v_uv+warpDir*u_progress,0.,1.));" +
      "vec4 B=texture2D(u_to,clamp(v_uv-warpDir*(1.-u_progress),0.,1.));" +
      "float e=smoothstep(u_progress-.08,u_progress+.08,n);" +
      "float ed=abs(n-u_progress);" +
      "float em=smoothstep(.1,0.,ed)*(1.-step(1.,u_progress));" +
      "vec3 ec=mix(u_accent_dark,u_accent_bright,smoothstep(0.,.1,ed));" +
      "gl_FragColor=vec4(mix(B,A,e).rgb+ec*em*2.,1.);}",
  },

  "ridged-burn": {
    frag:
      H +
      NQ +
      "float ridged(vec2 p){float v=0.,a=.5;mat2 R=mat2(.8,.6,-.6,.8);" +
      "for(int i=0;i<5;i++){v+=a*abs(vnoise(p)*2.-1.);p=R*p*2.02;a*=.5;}return v;}" +
      "void main(){vec4 A=texture2D(u_from,v_uv),B=texture2D(u_to,v_uv);" +
      "float n=ridged(v_uv*4.);" +
      "float e=smoothstep(u_progress-.04,u_progress+.04,n);" +
      "float heat=smoothstep(.12,0.,abs(n-u_progress))*(1.-step(1.,u_progress));" +
      "vec3 burn=mix(u_accent_dark,u_accent,smoothstep(0.,.25,heat));" +
      "burn=mix(burn,u_accent_bright,smoothstep(.25,.5,heat));" +
      "burn=mix(burn,vec3(1),smoothstep(.5,1.,heat));" +
      "float sparks=step(.92,vnoise(v_uv*80.))*heat*3.;" +
      "gl_FragColor=vec4(mix(B,A,e).rgb+burn*heat*3.5+u_accent_bright*sparks,1.);}",
  },

  "whip-pan": {
    frag:
      H +
      "void main(){" +
      "float fromOff=u_progress*1.5;vec3 fromC=vec3(0.);" +
      "for(int i=0;i<10;i++){float f=float(i)/10.;" +
      "vec2 fuv=vec2(v_uv.x+fromOff+u_progress*.08*f,v_uv.y);" +
      "fromC+=texture2D(u_from,clamp(fuv,0.,1.)).rgb;}fromC/=10.;" +
      "float toOff=(1.-u_progress)*1.5;vec3 toC=vec3(0.);" +
      "for(int i=0;i<10;i++){float f=float(i)/10.;" +
      "vec2 tuv=vec2(v_uv.x-toOff-(1.-u_progress)*.08*f,v_uv.y);" +
      "toC+=texture2D(u_to,clamp(tuv,0.,1.)).rgb;}toC/=10.;" +
      "gl_FragColor=vec4(mix(fromC,toC,u_progress),1.);}",
  },

  "sdf-iris": {
    frag:
      H +
      "void main(){vec4 A=texture2D(u_from,v_uv),B=texture2D(u_to,v_uv);" +
      "vec2 uv=(v_uv-.5)*vec2(u_resolution.x/u_resolution.y,1.);" +
      "float d=length(uv);float radius=u_progress*1.2;float fw=.003;" +
      "float edge=smoothstep(radius+fw,radius-fw,d);" +
      "float ring1=exp(-abs(d-radius)*25.);" +
      "float ring2=exp(-abs(d-radius+.04)*20.)*.5;" +
      "float ring3=exp(-abs(d-radius+.08)*15.)*.25;" +
      "float glow=(ring1+ring2+ring3)*u_progress*(1.-u_progress)*4.;" +
      "gl_FragColor=vec4(mix(A,B,edge).rgb+u_accent_bright*glow*.6,1.);}",
  },

  "ripple-waves": {
    frag:
      H +
      "void main(){vec2 uv=v_uv-.5;float dist=length(uv);vec2 dir=normalize(uv+.001);" +
      "float fromAmp=u_progress*.04;" +
      "float fw1=exp(sin(dist*25.-u_progress*12.)-1.);" +
      "float fw2=exp(sin(dist*50.-u_progress*18.)-1.)*.5;" +
      "vec2 fromUv=clamp(v_uv+dir*(fw1+fw2)*fromAmp,0.,1.);" +
      "float toAmp=(1.-u_progress)*.04;" +
      "float tw1=exp(sin(dist*25.+u_progress*12.)-1.);" +
      "float tw2=exp(sin(dist*50.+u_progress*18.)-1.)*.5;" +
      "vec2 toUv=clamp(v_uv-dir*(tw1+tw2)*toAmp,0.,1.);" +
      "vec4 A=texture2D(u_from,fromUv);vec4 B=texture2D(u_to,toUv);" +
      "float peak=fw1*u_progress;vec3 tint=u_accent_bright*peak*.1;" +
      "gl_FragColor=vec4(mix(A.rgb+tint,B.rgb,u_progress),1.);}",
  },

  "gravitational-lens": {
    frag:
      H +
      "void main(){vec4 B=texture2D(u_to,v_uv);" +
      "vec2 uv=v_uv-.5;float dist=length(uv);float pull=u_progress*2.;" +
      "float warpStr=pull*.3/(dist+.1);" +
      "vec2 warped=clamp(v_uv-uv*warpStr,0.,1.);" +
      "vec4 A=texture2D(u_from,warped);" +
      "float horizon=smoothstep(0.,.3,dist/(1.-u_progress*.85+.001));" +
      "float shift=pull*.02/(dist+.2);" +
      "float r=texture2D(u_from,clamp(v_uv-uv*(warpStr+shift),0.,1.)).r;" +
      "float b=texture2D(u_from,clamp(v_uv-uv*(warpStr-shift),0.,1.)).b;" +
      // The horizon term darkens the center to black, but it is not gated by
      // progress, so at progress 0 the from-scene rendered as a black-hole
      // vignette instead of the clean outgoing frame. Ramp the darkening in from
      // progress 0 so lensed == from-scene at the transition start, matching
      // every other shader in this file.
      "float horizonRamp=smoothstep(0.,.3,u_progress);" +
      "vec3 lensed=vec3(r,A.g,b)*mix(1.,horizon,horizonRamp);" +
      "gl_FragColor=vec4(mix(lensed,B.rgb,smoothstep(.3,.9,u_progress)),1.);}",
  },

  "cinematic-zoom": {
    frag:
      H +
      "void main(){vec2 d=v_uv-vec2(.5);" +
      "float fromS=u_progress*.08;float toS=(1.-u_progress)*.06;" +
      "float fr=0.,fg=0.,fb=0.;" +
      "for(int i=0;i<12;i++){float f=float(i)/12.;" +
      "fr+=texture2D(u_from,v_uv-d*(fromS*1.06)*f).r;" +
      "fg+=texture2D(u_from,v_uv-d*fromS*f).g;" +
      "fb+=texture2D(u_from,v_uv-d*(fromS*.94)*f).b;}" +
      "vec3 fromBl=vec3(fr,fg,fb)/12.;" +
      "float tr=0.,tg=0.,tb=0.;" +
      "for(int i=0;i<12;i++){float f=float(i)/12.;" +
      "tr+=texture2D(u_to,v_uv+d*(toS*1.06)*f).r;" +
      "tg+=texture2D(u_to,v_uv+d*toS*f).g;" +
      "tb+=texture2D(u_to,v_uv+d*(toS*.94)*f).b;}" +
      "vec3 toBl=vec3(tr,tg,tb)/12.;" +
      "gl_FragColor=vec4(mix(fromBl,toBl,u_progress),1.);}",
  },

  "chromatic-split": {
    frag:
      H +
      "void main(){vec2 c=v_uv-.5;" +
      "float fromShift=u_progress*.06;" +
      "float fr=texture2D(u_from,clamp(v_uv+c*fromShift,0.,1.)).r;" +
      "float fg=texture2D(u_from,v_uv).g;" +
      "float fb=texture2D(u_from,clamp(v_uv-c*fromShift,0.,1.)).b;" +
      "vec3 fromSplit=vec3(fr,fg,fb);" +
      "float toShift=(1.-u_progress)*.06;" +
      "float tr=texture2D(u_to,clamp(v_uv-c*toShift,0.,1.)).r;" +
      "float tg=texture2D(u_to,v_uv).g;" +
      "float tb=texture2D(u_to,clamp(v_uv+c*toShift,0.,1.)).b;" +
      "vec3 toSplit=vec3(tr,tg,tb);" +
      "gl_FragColor=vec4(mix(fromSplit,toSplit,u_progress),1.);}",
  },

  glitch: {
    frag:
      H +
      "float rand(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}" +
      "void main(){float inten=u_progress*(1.-u_progress)*4.;" +
      "float lineY=floor(v_uv.y*60.)/60.;" +
      "float lineDisp=(rand(vec2(lineY,floor(u_progress*17.)))-.5)*.18*inten;" +
      "vec2 block=floor(v_uv*vec2(12.,8.));" +
      "float br=rand(block+vec2(floor(u_progress*11.)));" +
      "float ba=step(.83,br)*inten;" +
      "vec2 bd=(vec2(rand(block*2.1),rand(block*3.7))-.5)*.35*ba;" +
      "vec2 uv=clamp(v_uv+vec2(lineDisp,0.)+bd,0.,1.);" +
      "float shift=inten*.035;" +
      "float r=texture2D(u_from,uv+vec2(shift,0.)).r;" +
      "float g=texture2D(u_from,uv).g;" +
      "float b=texture2D(u_from,uv-vec2(shift,0.)).b;" +
      "vec3 col=vec3(r,g,b);" +
      "col-=step(.5,fract(v_uv.y*u_resolution.y*.5))*.05*inten;" +
      "col*=1.+(rand(vec2(floor(u_progress*23.)))-.5)*.3*inten;" +
      "float levels=mix(256.,8.,inten*.5);" +
      "col=floor(col*levels)/levels;" +
      "gl_FragColor=mix(vec4(col,1.),texture2D(u_to,v_uv),u_progress);}",
  },

  "swirl-vortex": {
    frag:
      H +
      NQ +
      "void main(){vec2 uv=v_uv-.5;float dist=length(uv);" +
      "float warp=fbm(v_uv*4.)*.5;" +
      "float fromAng=u_progress*(1.-dist)*10.+warp*u_progress*3.;" +
      "float fs=sin(fromAng),fc=cos(fromAng);" +
      "vec2 fromUv=clamp(vec2(uv.x*fc-uv.y*fs,uv.x*fs+uv.y*fc)+.5,0.,1.);" +
      "float toAng=-(1.-u_progress)*(1.-dist)*10.-warp*(1.-u_progress)*3.;" +
      "float ts=sin(toAng),tc=cos(toAng);" +
      "vec2 toUv=clamp(vec2(uv.x*tc-uv.y*ts,uv.x*ts+uv.y*tc)+.5,0.,1.);" +
      "vec4 A=texture2D(u_from,fromUv);vec4 B=texture2D(u_to,toUv);" +
      "gl_FragColor=mix(A,B,u_progress);}",
  },

  "thermal-distortion": {
    frag:
      H +
      NQ +
      "void main(){float heat=u_progress*1.5;" +
      "float yFade=smoothstep(1.,0.,v_uv.y);" +
      "float shimmer=sin(v_uv.y*40.+fbm(v_uv*6.)*8.)*fbm(v_uv*3.+vec2(0.,u_progress*2.));" +
      "float dispX=shimmer*heat*.03*yFade;" +
      "vec2 fromUv=clamp(v_uv+vec2(dispX,0.),0.,1.);" +
      "vec4 A=texture2D(u_from,fromUv);" +
      "float invShimmer=sin(v_uv.y*40.+fbm(v_uv*6.+3.)*8.)*fbm(v_uv*3.+vec2(3.,u_progress*2.));" +
      "float dispX2=invShimmer*(1.-u_progress)*.03*yFade;" +
      "vec2 toUv=clamp(v_uv+vec2(dispX2,0.),0.,1.);" +
      "vec4 B=texture2D(u_to,toUv);" +
      "float haze=heat*yFade*.15*(1.-u_progress);" +
      "gl_FragColor=vec4(mix(A.rgb,B.rgb,u_progress)+u_accent_bright*haze,1.);}",
  },

  "flash-through-white": {
    frag:
      H +
      "void main(){vec4 A=texture2D(u_from,v_uv),B=texture2D(u_to,v_uv);" +
      "float toWhite=smoothstep(0.,.45,u_progress);" +
      "vec3 fromC=mix(A.rgb,vec3(1.),toWhite);" +
      "float fromWhite=1.-smoothstep(.5,1.,u_progress);" +
      "vec3 toC=mix(B.rgb,vec3(1.),fromWhite);" +
      "gl_FragColor=vec4(mix(fromC,toC,smoothstep(.35,.65,u_progress)),1.);}",
  },

  "cross-warp-morph": {
    frag:
      H +
      NQ +
      "void main(){vec2 disp=vec2(fbm(v_uv*3.),fbm(v_uv*3.+vec2(7.3,3.7)))-.5;" +
      "vec2 fromUv=clamp(v_uv+disp*u_progress*.5,0.,1.);" +
      "vec2 toUv=clamp(v_uv-disp*(1.-u_progress)*.5,0.,1.);" +
      "vec4 A=texture2D(u_from,fromUv);vec4 B=texture2D(u_to,toUv);" +
      "float n=fbm(v_uv*4.+vec2(3.1,1.7));" +
      "float blend=smoothstep(.4,.6,n+u_progress*1.2-.6);" +
      "gl_FragColor=mix(A,B,blend);}",
  },

  "light-leak": {
    frag:
      H +
      "vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}" +
      "void main(){vec4 A=texture2D(u_from,v_uv),B=texture2D(u_to,v_uv);" +
      "vec2 lp=vec2(1.3,-.2);float dist=length(v_uv-lp);" +
      "float leak=clamp(exp(-dist*1.8)*u_progress*4.,0.,1.);" +
      "vec3 warmColor=mix(u_accent,u_accent_bright,dist*.7);" +
      "float flare=exp(-abs(v_uv.y-(-.2+v_uv.x*.3))*15.)*leak*.3;" +
      "vec3 overexposed=A.rgb+warmColor*leak*3.+u_accent_bright*flare;" +
      "overexposed=aces(overexposed);" +
      "gl_FragColor=vec4(mix(overexposed,B.rgb,smoothstep(.15,.85,u_progress)),1.);}",
  },
};

export type ShaderName = keyof typeof shaders;
export const SHADER_NAMES = Object.keys(shaders) as ShaderName[];

export function getFragSource(name: string): string {
  const def = shaders[name];
  if (!def)
    throw new Error(
      `[HyperShader] Unknown shader: "${name}". Available: ${SHADER_NAMES.join(", ")}`,
    );
  return def.frag;
}
