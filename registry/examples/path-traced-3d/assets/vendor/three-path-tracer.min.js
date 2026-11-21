var Gv=Object.defineProperty;var Wv=(r,t)=>{for(var e in t)Gv(r,e,{get:t[e],enumerable:!0})};var ca="180",Xv={LEFT:0,MIDDLE:1,RIGHT:2,ROTATE:0,DOLLY:1,PAN:2},qv={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},mg=0,Ld=1,gg=2,Yv=3,$v=0,Nd=1,xg=2,oi=3,yn=0,He=1,Sn=2,ke=0,Yn=1,la=2,Ud=3,Bd=4,vg=5,Ni=100,_g=101,yg=102,bg=103,Sg=104,Mg=200,Tg=201,wg=202,Ag=203,Rc=204,Cc=205,Eg=206,Rg=207,Cg=208,Ig=209,Pg=210,Dg=211,Fg=212,Lg=213,Ng=214,zl=0,kl=1,Vl=2,_r=3,Hl=4,Gl=5,Wl=6,Xl=7,ua=0,Ug=1,Bg=2,Zn=0,Og=1,zg=2,kg=3,Vg=4,Hg=5,Gg=6,Wg=7,bf="attached",Xg="detached",ql=300,Si=301,Vi=302,Mi=303,ha=304,Ns=306,Ke=1e3,we=1001,Ao=1002,Vt=1003,Od=1004,Zv=1004,Us=1005,Jv=1005,re=1006,fa=1007,Kv=1007,ai=1008,zd=1008,on=1009,Bs=1010,da=1011,Hi=1012,Gi=1013,an=1014,$t=1015,Ge=1016,Yl=1017,$l=1018,Os=1020,kd=35902,Vd=35899,Hd=1021,Gd=1022,Gt=1023,xs=1026,zs=1027,Jn=1028,Dr=1029,Fr=1030,Wi=1031,Qv=1032,Xi=1033,pa=33776,ma=33777,ga=33778,xa=33779,Zl=35840,Jl=35841,Kl=35842,Ql=35843,jl=36196,tu=37492,eu=37496,nu=37808,iu=37809,ru=37810,su=37811,ou=37812,au=37813,cu=37814,lu=37815,uu=37816,hu=37817,fu=37818,du=37819,pu=37820,mu=37821,gu=36492,xu=36494,vu=36495,_u=36283,yu=36284,bu=36285,Su=36286,qg=2200,Yg=2201,$g=2202,Eo=2300,Ic=2301,Ec=2302,mr=2400,gr=2401,Ro=2402,Mu=2500,Wd=2501,jv=0,t_=1,e_=2,Zg=3200,Jg=3201,n_=3202,i_=3203,qi=0,Kg=1,Ti="",vn="srgb",yr="srgb-linear",Co="linear",me="srgb",r_=0,pr=7680,s_=7681,o_=7682,a_=7683,c_=34055,l_=34056,u_=5386,h_=512,f_=513,d_=514,p_=515,m_=516,g_=517,x_=518,Sf=519,Qg=512,jg=513,t0=514,Xd=515,e0=516,n0=517,i0=518,r0=519,Io=35044,v_=35048,__=35040,y_=35045,b_=35049,S_=35041,M_=35046,T_=35050,w_=35042,A_="100",qd="300 es",Rn=2e3,vs=2001,E_={COMPUTE:"compute",RENDER:"render"},R_={PERSPECTIVE:"perspective",LINEAR:"linear",FLAT:"flat"},C_={NORMAL:"normal",CENTROID:"centroid",SAMPLE:"sample",FIRST:"first",EITHER:"either"},On=class{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[t]===void 0&&(n[t]=[]),n[t].indexOf(e)===-1&&n[t].push(e)}hasEventListener(t,e){let n=this._listeners;return n===void 0?!1:n[t]!==void 0&&n[t].indexOf(e)!==-1}removeEventListener(t,e){let n=this._listeners;if(n===void 0)return;let i=n[t];if(i!==void 0){let s=i.indexOf(e);s!==-1&&i.splice(s,1)}}dispatchEvent(t){let e=this._listeners;if(e===void 0)return;let n=e[t.type];if(n!==void 0){t.target=this;let i=n.slice(0);for(let s=0,o=i.length;s<o;s++)i[s].call(this,t);t.target=null}}},en=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],cm=1234567,vr=Math.PI/180,br=180/Math.PI;function Cn(){let r=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(en[r&255]+en[r>>8&255]+en[r>>16&255]+en[r>>24&255]+"-"+en[t&255]+en[t>>8&255]+"-"+en[t>>16&15|64]+en[t>>24&255]+"-"+en[e&63|128]+en[e>>8&255]+"-"+en[e>>16&255]+en[e>>24&255]+en[n&255]+en[n>>8&255]+en[n>>16&255]+en[n>>24&255]).toLowerCase()}function Bt(r,t,e){return Math.max(t,Math.min(e,r))}function Yd(r,t){return(r%t+t)%t}function I_(r,t,e,n,i){return n+(r-t)*(i-n)/(e-t)}function P_(r,t,e){return r!==t?(e-r)/(t-r):0}function Mo(r,t,e){return(1-e)*r+e*t}function D_(r,t,e,n){return Mo(r,t,1-Math.exp(-e*n))}function F_(r,t=1){return t-Math.abs(Yd(r,t*2)-t)}function L_(r,t,e){return r<=t?0:r>=e?1:(r=(r-t)/(e-t),r*r*(3-2*r))}function N_(r,t,e){return r<=t?0:r>=e?1:(r=(r-t)/(e-t),r*r*r*(r*(r*6-15)+10))}function U_(r,t){return r+Math.floor(Math.random()*(t-r+1))}function B_(r,t){return r+Math.random()*(t-r)}function O_(r){return r*(.5-Math.random())}function z_(r){r!==void 0&&(cm=r);let t=cm+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function k_(r){return r*vr}function V_(r){return r*br}function H_(r){return(r&r-1)===0&&r!==0}function G_(r){return Math.pow(2,Math.ceil(Math.log(r)/Math.LN2))}function W_(r){return Math.pow(2,Math.floor(Math.log(r)/Math.LN2))}function X_(r,t,e,n,i){let s=Math.cos,o=Math.sin,a=s(e/2),c=o(e/2),l=s((t+n)/2),f=o((t+n)/2),h=s((t-n)/2),u=o((t-n)/2),d=s((n-t)/2),g=o((n-t)/2);switch(i){case"XYX":r.set(a*f,c*h,c*u,a*l);break;case"YZY":r.set(c*u,a*f,c*h,a*l);break;case"ZXZ":r.set(c*h,c*u,a*f,a*l);break;case"XZX":r.set(a*f,c*g,c*d,a*l);break;case"YXY":r.set(c*d,a*f,c*g,a*l);break;case"ZYZ":r.set(c*g,c*d,a*f,a*l);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+i)}}function hn(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return r/4294967295;case Uint16Array:return r/65535;case Uint8Array:return r/255;case Int32Array:return Math.max(r/2147483647,-1);case Int16Array:return Math.max(r/32767,-1);case Int8Array:return Math.max(r/127,-1);default:throw new Error("Invalid component type.")}}function Zt(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return Math.round(r*4294967295);case Uint16Array:return Math.round(r*65535);case Uint8Array:return Math.round(r*255);case Int32Array:return Math.round(r*2147483647);case Int16Array:return Math.round(r*32767);case Int8Array:return Math.round(r*127);default:throw new Error("Invalid component type.")}}var q_={DEG2RAD:vr,RAD2DEG:br,generateUUID:Cn,clamp:Bt,euclideanModulo:Yd,mapLinear:I_,inverseLerp:P_,lerp:Mo,damp:D_,pingpong:F_,smoothstep:L_,smootherstep:N_,randInt:U_,randFloat:B_,randFloatSpread:O_,seededRandom:z_,degToRad:k_,radToDeg:V_,isPowerOfTwo:H_,ceilPowerOfTwo:G_,floorPowerOfTwo:W_,setQuaternionFromProperEuler:X_,normalize:Zt,denormalize:hn},q=class r{constructor(t=0,e=0){r.prototype.isVector2=!0,this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){let e=this.x,n=this.y,i=t.elements;return this.x=i[0]*e+i[3]*n+i[6],this.y=i[1]*e+i[4]*n+i[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Bt(this.x,t.x,e.x),this.y=Bt(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=Bt(this.x,t,e),this.y=Bt(this.y,t,e),this}clampLength(t,e){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Bt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){let e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;let n=this.dot(t)/e;return Math.acos(Bt(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let e=this.x-t.x,n=this.y-t.y;return e*e+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){let n=Math.cos(e),i=Math.sin(e),s=this.x-t.x,o=this.y-t.y;return this.x=s*n-o*i+t.x,this.y=s*i+o*n+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Ze=class{constructor(t=0,e=0,n=0,i=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=n,this._w=i}static slerpFlat(t,e,n,i,s,o,a){let c=n[i+0],l=n[i+1],f=n[i+2],h=n[i+3],u=s[o+0],d=s[o+1],g=s[o+2],x=s[o+3];if(a===0){t[e+0]=c,t[e+1]=l,t[e+2]=f,t[e+3]=h;return}if(a===1){t[e+0]=u,t[e+1]=d,t[e+2]=g,t[e+3]=x;return}if(h!==x||c!==u||l!==d||f!==g){let p=1-a,m=c*u+l*d+f*g+h*x,v=m>=0?1:-1,_=1-m*m;if(_>Number.EPSILON){let b=Math.sqrt(_),T=Math.atan2(b,m*v);p=Math.sin(p*T)/b,a=Math.sin(a*T)/b}let y=a*v;if(c=c*p+u*y,l=l*p+d*y,f=f*p+g*y,h=h*p+x*y,p===1-a){let b=1/Math.sqrt(c*c+l*l+f*f+h*h);c*=b,l*=b,f*=b,h*=b}}t[e]=c,t[e+1]=l,t[e+2]=f,t[e+3]=h}static multiplyQuaternionsFlat(t,e,n,i,s,o){let a=n[i],c=n[i+1],l=n[i+2],f=n[i+3],h=s[o],u=s[o+1],d=s[o+2],g=s[o+3];return t[e]=a*g+f*h+c*d-l*u,t[e+1]=c*g+f*u+l*h-a*d,t[e+2]=l*g+f*d+a*u-c*h,t[e+3]=f*g-a*h-c*u-l*d,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,n,i){return this._x=t,this._y=e,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){let n=t._x,i=t._y,s=t._z,o=t._order,a=Math.cos,c=Math.sin,l=a(n/2),f=a(i/2),h=a(s/2),u=c(n/2),d=c(i/2),g=c(s/2);switch(o){case"XYZ":this._x=u*f*h+l*d*g,this._y=l*d*h-u*f*g,this._z=l*f*g+u*d*h,this._w=l*f*h-u*d*g;break;case"YXZ":this._x=u*f*h+l*d*g,this._y=l*d*h-u*f*g,this._z=l*f*g-u*d*h,this._w=l*f*h+u*d*g;break;case"ZXY":this._x=u*f*h-l*d*g,this._y=l*d*h+u*f*g,this._z=l*f*g+u*d*h,this._w=l*f*h-u*d*g;break;case"ZYX":this._x=u*f*h-l*d*g,this._y=l*d*h+u*f*g,this._z=l*f*g-u*d*h,this._w=l*f*h+u*d*g;break;case"YZX":this._x=u*f*h+l*d*g,this._y=l*d*h+u*f*g,this._z=l*f*g-u*d*h,this._w=l*f*h-u*d*g;break;case"XZY":this._x=u*f*h-l*d*g,this._y=l*d*h-u*f*g,this._z=l*f*g+u*d*h,this._w=l*f*h+u*d*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){let n=e/2,i=Math.sin(n);return this._x=t.x*i,this._y=t.y*i,this._z=t.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(t){let e=t.elements,n=e[0],i=e[4],s=e[8],o=e[1],a=e[5],c=e[9],l=e[2],f=e[6],h=e[10],u=n+a+h;if(u>0){let d=.5/Math.sqrt(u+1);this._w=.25/d,this._x=(f-c)*d,this._y=(s-l)*d,this._z=(o-i)*d}else if(n>a&&n>h){let d=2*Math.sqrt(1+n-a-h);this._w=(f-c)/d,this._x=.25*d,this._y=(i+o)/d,this._z=(s+l)/d}else if(a>h){let d=2*Math.sqrt(1+a-n-h);this._w=(s-l)/d,this._x=(i+o)/d,this._y=.25*d,this._z=(c+f)/d}else{let d=2*Math.sqrt(1+h-n-a);this._w=(o-i)/d,this._x=(s+l)/d,this._y=(c+f)/d,this._z=.25*d}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let n=t.dot(e)+1;return n<1e-8?(n=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=n):(this._x=0,this._y=-t.z,this._z=t.y,this._w=n)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=n),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Bt(this.dot(t),-1,1)))}rotateTowards(t,e){let n=this.angleTo(t);if(n===0)return this;let i=Math.min(1,e/n);return this.slerp(t,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){let n=t._x,i=t._y,s=t._z,o=t._w,a=e._x,c=e._y,l=e._z,f=e._w;return this._x=n*f+o*a+i*l-s*c,this._y=i*f+o*c+s*a-n*l,this._z=s*f+o*l+n*c-i*a,this._w=o*f-n*a-i*c-s*l,this._onChangeCallback(),this}slerp(t,e){if(e===0)return this;if(e===1)return this.copy(t);let n=this._x,i=this._y,s=this._z,o=this._w,a=o*t._w+n*t._x+i*t._y+s*t._z;if(a<0?(this._w=-t._w,this._x=-t._x,this._y=-t._y,this._z=-t._z,a=-a):this.copy(t),a>=1)return this._w=o,this._x=n,this._y=i,this._z=s,this;let c=1-a*a;if(c<=Number.EPSILON){let d=1-e;return this._w=d*o+e*this._w,this._x=d*n+e*this._x,this._y=d*i+e*this._y,this._z=d*s+e*this._z,this.normalize(),this}let l=Math.sqrt(c),f=Math.atan2(l,a),h=Math.sin((1-e)*f)/l,u=Math.sin(e*f)/l;return this._w=o*h+this._w*u,this._x=n*h+this._x*u,this._y=i*h+this._y*u,this._z=s*h+this._z*u,this._onChangeCallback(),this}slerpQuaternions(t,e,n){return this.copy(t).slerp(e,n)}random(){let t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),s=Math.sqrt(n);return this.set(i*Math.sin(t),i*Math.cos(t),s*Math.sin(e),s*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},R=class r{constructor(t=0,e=0,n=0){r.prototype.isVector3=!0,this.x=t,this.y=e,this.z=n}set(t,e,n){return n===void 0&&(n=this.z),this.x=t,this.y=e,this.z=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(lm.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(lm.setFromAxisAngle(t,e))}applyMatrix3(t){let e=this.x,n=this.y,i=this.z,s=t.elements;return this.x=s[0]*e+s[3]*n+s[6]*i,this.y=s[1]*e+s[4]*n+s[7]*i,this.z=s[2]*e+s[5]*n+s[8]*i,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){let e=this.x,n=this.y,i=this.z,s=t.elements,o=1/(s[3]*e+s[7]*n+s[11]*i+s[15]);return this.x=(s[0]*e+s[4]*n+s[8]*i+s[12])*o,this.y=(s[1]*e+s[5]*n+s[9]*i+s[13])*o,this.z=(s[2]*e+s[6]*n+s[10]*i+s[14])*o,this}applyQuaternion(t){let e=this.x,n=this.y,i=this.z,s=t.x,o=t.y,a=t.z,c=t.w,l=2*(o*i-a*n),f=2*(a*e-s*i),h=2*(s*n-o*e);return this.x=e+c*l+o*h-a*f,this.y=n+c*f+a*l-s*h,this.z=i+c*h+s*f-o*l,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){let e=this.x,n=this.y,i=this.z,s=t.elements;return this.x=s[0]*e+s[4]*n+s[8]*i,this.y=s[1]*e+s[5]*n+s[9]*i,this.z=s[2]*e+s[6]*n+s[10]*i,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Bt(this.x,t.x,e.x),this.y=Bt(this.y,t.y,e.y),this.z=Bt(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=Bt(this.x,t,e),this.y=Bt(this.y,t,e),this.z=Bt(this.z,t,e),this}clampLength(t,e){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Bt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){let n=t.x,i=t.y,s=t.z,o=e.x,a=e.y,c=e.z;return this.x=i*c-s*a,this.y=s*o-n*c,this.z=n*a-i*o,this}projectOnVector(t){let e=t.lengthSq();if(e===0)return this.set(0,0,0);let n=t.dot(this)/e;return this.copy(t).multiplyScalar(n)}projectOnPlane(t){return Uh.copy(this).projectOnVector(t),this.sub(Uh)}reflect(t){return this.sub(Uh.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){let e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;let n=this.dot(t)/e;return Math.acos(Bt(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let e=this.x-t.x,n=this.y-t.y,i=this.z-t.z;return e*e+n*n+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,n){let i=Math.sin(e)*t;return this.x=i*Math.sin(n),this.y=Math.cos(e)*t,this.z=i*Math.cos(n),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,n){return this.x=t*Math.sin(e),this.y=n,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){let e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){let e=this.setFromMatrixColumn(t,0).length(),n=this.setFromMatrixColumn(t,1).length(),i=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=n,this.z=i,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let t=Math.random()*Math.PI*2,e=Math.random()*2-1,n=Math.sqrt(1-e*e);return this.x=n*Math.cos(t),this.y=e,this.z=n*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Uh=new R,lm=new Ze,Xt=class r{constructor(t,e,n,i,s,o,a,c,l){r.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,n,i,s,o,a,c,l)}set(t,e,n,i,s,o,a,c,l){let f=this.elements;return f[0]=t,f[1]=i,f[2]=a,f[3]=e,f[4]=s,f[5]=c,f[6]=n,f[7]=o,f[8]=l,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){let e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],this}extractBasis(t,e,n){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(t){let e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){let n=t.elements,i=e.elements,s=this.elements,o=n[0],a=n[3],c=n[6],l=n[1],f=n[4],h=n[7],u=n[2],d=n[5],g=n[8],x=i[0],p=i[3],m=i[6],v=i[1],_=i[4],y=i[7],b=i[2],T=i[5],w=i[8];return s[0]=o*x+a*v+c*b,s[3]=o*p+a*_+c*T,s[6]=o*m+a*y+c*w,s[1]=l*x+f*v+h*b,s[4]=l*p+f*_+h*T,s[7]=l*m+f*y+h*w,s[2]=u*x+d*v+g*b,s[5]=u*p+d*_+g*T,s[8]=u*m+d*y+g*w,this}multiplyScalar(t){let e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){let t=this.elements,e=t[0],n=t[1],i=t[2],s=t[3],o=t[4],a=t[5],c=t[6],l=t[7],f=t[8];return e*o*f-e*a*l-n*s*f+n*a*c+i*s*l-i*o*c}invert(){let t=this.elements,e=t[0],n=t[1],i=t[2],s=t[3],o=t[4],a=t[5],c=t[6],l=t[7],f=t[8],h=f*o-a*l,u=a*c-f*s,d=l*s-o*c,g=e*h+n*u+i*d;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);let x=1/g;return t[0]=h*x,t[1]=(i*l-f*n)*x,t[2]=(a*n-i*o)*x,t[3]=u*x,t[4]=(f*e-i*c)*x,t[5]=(i*s-a*e)*x,t[6]=d*x,t[7]=(n*c-l*e)*x,t[8]=(o*e-n*s)*x,this}transpose(){let t,e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){let e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,n,i,s,o,a){let c=Math.cos(s),l=Math.sin(s);return this.set(n*c,n*l,-n*(c*o+l*a)+o+t,-i*l,i*c,-i*(-l*o+c*a)+a+e,0,0,1),this}scale(t,e){return this.premultiply(Bh.makeScale(t,e)),this}rotate(t){return this.premultiply(Bh.makeRotation(-t)),this}translate(t,e){return this.premultiply(Bh.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){let e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,n,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){let e=this.elements,n=t.elements;for(let i=0;i<9;i++)if(e[i]!==n[i])return!1;return!0}fromArray(t,e=0){for(let n=0;n<9;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){let n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t}clone(){return new this.constructor().fromArray(this.elements)}},Bh=new Xt;function $d(r){for(let t=r.length-1;t>=0;--t)if(r[t]>=65535)return!0;return!1}var Y_={Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array};function ms(r,t){return new Y_[r](t)}function _s(r){return document.createElementNS("http://www.w3.org/1999/xhtml",r)}function s0(){let r=_s("canvas");return r.style.display="block",r}var um={};function ys(r){r in um||(um[r]=!0,console.warn(r))}function o0(r,t,e){return new Promise(function(n,i){function s(){switch(r.clientWaitSync(t,r.SYNC_FLUSH_COMMANDS_BIT,0)){case r.WAIT_FAILED:i();break;case r.TIMEOUT_EXPIRED:setTimeout(s,e);break;default:n()}}setTimeout(s,e)})}var hm=new Xt().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),fm=new Xt().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function $_(){let r={enabled:!0,workingColorSpace:yr,spaces:{},convert:function(i,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===me&&(i.r=vi(i.r),i.g=vi(i.g),i.b=vi(i.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(i.applyMatrix3(this.spaces[s].toXYZ),i.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===me&&(i.r=gs(i.r),i.g=gs(i.g),i.b=gs(i.b))),i},workingToColorSpace:function(i,s){return this.convert(i,this.workingColorSpace,s)},colorSpaceToWorking:function(i,s){return this.convert(i,s,this.workingColorSpace)},getPrimaries:function(i){return this.spaces[i].primaries},getTransfer:function(i){return i===Ti?Co:this.spaces[i].transfer},getToneMappingMode:function(i){return this.spaces[i].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(i,s=this.workingColorSpace){return i.fromArray(this.spaces[s].luminanceCoefficients)},define:function(i){Object.assign(this.spaces,i)},_getMatrix:function(i,s,o){return i.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(i){return this.spaces[i].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(i=this.workingColorSpace){return this.spaces[i].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(i,s){return ys("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),r.workingToColorSpace(i,s)},toWorkingColorSpace:function(i,s){return ys("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),r.colorSpaceToWorking(i,s)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],n=[.3127,.329];return r.define({[yr]:{primaries:t,whitePoint:n,transfer:Co,toXYZ:hm,fromXYZ:fm,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:vn},outputColorSpaceConfig:{drawingBufferColorSpace:vn}},[vn]:{primaries:t,whitePoint:n,transfer:me,toXYZ:hm,fromXYZ:fm,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:vn}}}),r}var ie=$_();function vi(r){return r<.04045?r*.0773993808:Math.pow(r*.9478672986+.0521327014,2.4)}function gs(r){return r<.0031308?r*12.92:1.055*Math.pow(r,.41666)-.055}var Zr,Pc=class{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let n;if(t instanceof HTMLCanvasElement)n=t;else{Zr===void 0&&(Zr=_s("canvas")),Zr.width=t.width,Zr.height=t.height;let i=Zr.getContext("2d");t instanceof ImageData?i.putImageData(t,0,0):i.drawImage(t,0,0,t.width,t.height),n=Zr}return n.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){let e=_s("canvas");e.width=t.width,e.height=t.height;let n=e.getContext("2d");n.drawImage(t,0,0,t.width,t.height);let i=n.getImageData(0,0,t.width,t.height),s=i.data;for(let o=0;o<s.length;o++)s[o]=vi(s[o]/255)*255;return n.putImageData(i,0,0),e}else if(t.data){let e=t.data.slice(0);for(let n=0;n<e.length;n++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[n]=Math.floor(vi(e[n]/255)*255):e[n]=vi(e[n]);return{data:e,width:t.width,height:t.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}},Z_=0,Bn=class{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Z_++}),this.uuid=Cn(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){let e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):e instanceof VideoFrame?t.set(e.displayHeight,e.displayWidth,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){let e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];let n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let s;if(Array.isArray(i)){s=[];for(let o=0,a=i.length;o<a;o++)i[o].isDataTexture?s.push(Oh(i[o].image)):s.push(Oh(i[o]))}else s=Oh(i);n.url=s}return e||(t.images[this.uuid]=n),n}};function Oh(r){return typeof HTMLImageElement<"u"&&r instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&r instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&r instanceof ImageBitmap?Pc.getDataURL(r):r.data?{data:Array.from(r.data),width:r.width,height:r.height,type:r.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}var J_=0,zh=new R,Oe=class r extends On{constructor(t=r.DEFAULT_IMAGE,e=r.DEFAULT_MAPPING,n=we,i=we,s=re,o=ai,a=Gt,c=on,l=r.DEFAULT_ANISOTROPY,f=Ti){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:J_++}),this.uuid=Cn(),this.name="",this.source=new Bn(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=s,this.minFilter=o,this.anisotropy=l,this.format=a,this.internalFormat=null,this.type=c,this.offset=new q(0,0),this.repeat=new q(1,1),this.center=new q(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Xt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=f,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(zh).x}get height(){return this.source.getSize(zh).y}get depth(){return this.source.getSize(zh).z}get image(){return this.source.data}set image(t=null){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(let e in t){let n=t[e];if(n===void 0){console.warn(`THREE.Texture.setValues(): parameter '${e}' has value of undefined.`);continue}let i=this[e];if(i===void 0){console.warn(`THREE.Texture.setValues(): property '${e}' does not exist.`);continue}i&&n&&i.isVector2&&n.isVector2||i&&n&&i.isVector3&&n.isVector3||i&&n&&i.isMatrix3&&n.isMatrix3?i.copy(n):this[e]=n}}toJSON(t){let e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),e||(t.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==ql)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Ke:t.x=t.x-Math.floor(t.x);break;case we:t.x=t.x<0?0:1;break;case Ao:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Ke:t.y=t.y-Math.floor(t.y);break;case we:t.y=t.y<0?0:1;break;case Ao:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}};Oe.DEFAULT_IMAGE=null;Oe.DEFAULT_MAPPING=ql;Oe.DEFAULT_ANISOTROPY=1;var Kt=class r{constructor(t=0,e=0,n=0,i=1){r.prototype.isVector4=!0,this.x=t,this.y=e,this.z=n,this.w=i}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,n,i){return this.x=t,this.y=e,this.z=n,this.w=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){let e=this.x,n=this.y,i=this.z,s=this.w,o=t.elements;return this.x=o[0]*e+o[4]*n+o[8]*i+o[12]*s,this.y=o[1]*e+o[5]*n+o[9]*i+o[13]*s,this.z=o[2]*e+o[6]*n+o[10]*i+o[14]*s,this.w=o[3]*e+o[7]*n+o[11]*i+o[15]*s,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);let e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,n,i,s,c=t.elements,l=c[0],f=c[4],h=c[8],u=c[1],d=c[5],g=c[9],x=c[2],p=c[6],m=c[10];if(Math.abs(f-u)<.01&&Math.abs(h-x)<.01&&Math.abs(g-p)<.01){if(Math.abs(f+u)<.1&&Math.abs(h+x)<.1&&Math.abs(g+p)<.1&&Math.abs(l+d+m-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;let _=(l+1)/2,y=(d+1)/2,b=(m+1)/2,T=(f+u)/4,w=(h+x)/4,E=(g+p)/4;return _>y&&_>b?_<.01?(n=0,i=.707106781,s=.707106781):(n=Math.sqrt(_),i=T/n,s=w/n):y>b?y<.01?(n=.707106781,i=0,s=.707106781):(i=Math.sqrt(y),n=T/i,s=E/i):b<.01?(n=.707106781,i=.707106781,s=0):(s=Math.sqrt(b),n=w/s,i=E/s),this.set(n,i,s,e),this}let v=Math.sqrt((p-g)*(p-g)+(h-x)*(h-x)+(u-f)*(u-f));return Math.abs(v)<.001&&(v=1),this.x=(p-g)/v,this.y=(h-x)/v,this.z=(u-f)/v,this.w=Math.acos((l+d+m-1)/2),this}setFromMatrixPosition(t){let e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Bt(this.x,t.x,e.x),this.y=Bt(this.y,t.y,e.y),this.z=Bt(this.z,t.z,e.z),this.w=Bt(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=Bt(this.x,t,e),this.y=Bt(this.y,t,e),this.z=Bt(this.z,t,e),this.w=Bt(this.w,t,e),this}clampLength(t,e){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Bt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this.w=t.w+(e.w-t.w)*n,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Po=class extends On{constructor(t=1,e=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:re,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},n),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=n.depth,this.scissor=new Kt(0,0,t,e),this.scissorTest=!1,this.viewport=new Kt(0,0,t,e);let i={width:t,height:e,depth:n.depth},s=new Oe(i);this.textures=[];let o=n.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview}_setTextureOptions(t={}){let e={minFilter:re,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),t!==null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,n=1){if(this.width!==t||this.height!==e||this.depth!==n){this.width=t,this.height=e,this.depth=n;for(let i=0,s=this.textures.length;i<s;i++)this.textures[i].image.width=t,this.textures[i].image.height=e,this.textures[i].image.depth=n,this.textures[i].isArrayTexture=this.textures[i].image.depth>1;this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,n=t.textures.length;e<n;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;let i=Object.assign({},t.textures[e].image);this.textures[e].source=new Bn(i)}return this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}},ze=class extends Po{constructor(t=1,e=1,n={}){super(t,e,n),this.isWebGLRenderTarget=!0}},Ui=class extends Oe{constructor(t=null,e=1,n=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:n,depth:i},this.magFilter=Vt,this.minFilter=Vt,this.wrapR=we,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}},Do=class extends ze{constructor(t=1,e=1,n=1,i={}){super(t,e,i),this.isWebGLArrayRenderTarget=!0,this.depth=n,this.texture=new Ui(null,t,e,n),this._setTextureOptions(i),this.texture.isRenderTargetTexture=!0}},bs=class extends Oe{constructor(t=null,e=1,n=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:n,depth:i},this.magFilter=Vt,this.minFilter=Vt,this.wrapR=we,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Mf=class extends ze{constructor(t=1,e=1,n=1,i={}){super(t,e,i),this.isWebGL3DRenderTarget=!0,this.depth=n,this.texture=new bs(null,t,e,n),this._setTextureOptions(i),this.texture.isRenderTargetTexture=!0}},se=class{constructor(t=new R(1/0,1/0,1/0),e=new R(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e+=3)this.expandByPoint(Gn.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,n=t.count;e<n;e++)this.expandByPoint(Gn.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){let n=Gn.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);let n=t.geometry;if(n!==void 0){let s=n.getAttribute("position");if(e===!0&&s!==void 0&&t.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)t.isMesh===!0?t.getVertexPosition(o,Gn):Gn.fromBufferAttribute(s,o),Gn.applyMatrix4(t.matrixWorld),this.expandByPoint(Gn);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),za.copy(t.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),za.copy(n.boundingBox)),za.applyMatrix4(t.matrixWorld),this.union(za)}let i=t.children;for(let s=0,o=i.length;s<o;s++)this.expandByObject(i[s],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Gn),Gn.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,n;return t.normal.x>0?(e=t.normal.x*this.min.x,n=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,n=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,n+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,n+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,n+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,n+=t.normal.z*this.min.z),e<=-t.constant&&n>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(co),ka.subVectors(this.max,co),Jr.subVectors(t.a,co),Kr.subVectors(t.b,co),Qr.subVectors(t.c,co),Ei.subVectors(Kr,Jr),Ri.subVectors(Qr,Kr),nr.subVectors(Jr,Qr);let e=[0,-Ei.z,Ei.y,0,-Ri.z,Ri.y,0,-nr.z,nr.y,Ei.z,0,-Ei.x,Ri.z,0,-Ri.x,nr.z,0,-nr.x,-Ei.y,Ei.x,0,-Ri.y,Ri.x,0,-nr.y,nr.x,0];return!kh(e,Jr,Kr,Qr,ka)||(e=[1,0,0,0,1,0,0,0,1],!kh(e,Jr,Kr,Qr,ka))?!1:(Va.crossVectors(Ei,Ri),e=[Va.x,Va.y,Va.z],kh(e,Jr,Kr,Qr,ka))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Gn).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Gn).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(hi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),hi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),hi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),hi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),hi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),hi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),hi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),hi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(hi),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}},hi=[new R,new R,new R,new R,new R,new R,new R,new R],Gn=new R,za=new se,Jr=new R,Kr=new R,Qr=new R,Ei=new R,Ri=new R,nr=new R,co=new R,ka=new R,Va=new R,ir=new R;function kh(r,t,e,n,i){for(let s=0,o=r.length-3;s<=o;s+=3){ir.fromArray(r,s);let a=i.x*Math.abs(ir.x)+i.y*Math.abs(ir.y)+i.z*Math.abs(ir.z),c=t.dot(ir),l=e.dot(ir),f=n.dot(ir);if(Math.max(-Math.max(c,l,f),Math.min(c,l,f))>a)return!1}return!0}var K_=new se,lo=new R,Vh=new R,Ve=class{constructor(t=new R,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){let n=this.center;e!==void 0?n.copy(e):K_.setFromPoints(t).getCenter(n);let i=0;for(let s=0,o=t.length;s<o;s++)i=Math.max(i,n.distanceToSquared(t[s]));return this.radius=Math.sqrt(i),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){let e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){let n=this.center.distanceToSquared(t);return e.copy(t),n>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;lo.subVectors(t,this.center);let e=lo.lengthSq();if(e>this.radius*this.radius){let n=Math.sqrt(e),i=(n-this.radius)*.5;this.center.addScaledVector(lo,i/n),this.radius+=i}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(Vh.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(lo.copy(t.center).add(Vh)),this.expandByPoint(lo.copy(t.center).sub(Vh))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}},fi=new R,Hh=new R,Ha=new R,Ci=new R,Gh=new R,Ga=new R,Wh=new R,ii=class{constructor(t=new R,e=new R(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,fi)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);let n=e.dot(this.direction);return n<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){let e=fi.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(fi.copy(this.origin).addScaledVector(this.direction,e),fi.distanceToSquared(t))}distanceSqToSegment(t,e,n,i){Hh.copy(t).add(e).multiplyScalar(.5),Ha.copy(e).sub(t).normalize(),Ci.copy(this.origin).sub(Hh);let s=t.distanceTo(e)*.5,o=-this.direction.dot(Ha),a=Ci.dot(this.direction),c=-Ci.dot(Ha),l=Ci.lengthSq(),f=Math.abs(1-o*o),h,u,d,g;if(f>0)if(h=o*c-a,u=o*a-c,g=s*f,h>=0)if(u>=-g)if(u<=g){let x=1/f;h*=x,u*=x,d=h*(h+o*u+2*a)+u*(o*h+u+2*c)+l}else u=s,h=Math.max(0,-(o*u+a)),d=-h*h+u*(u+2*c)+l;else u=-s,h=Math.max(0,-(o*u+a)),d=-h*h+u*(u+2*c)+l;else u<=-g?(h=Math.max(0,-(-o*s+a)),u=h>0?-s:Math.min(Math.max(-s,-c),s),d=-h*h+u*(u+2*c)+l):u<=g?(h=0,u=Math.min(Math.max(-s,-c),s),d=u*(u+2*c)+l):(h=Math.max(0,-(o*s+a)),u=h>0?s:Math.min(Math.max(-s,-c),s),d=-h*h+u*(u+2*c)+l);else u=o>0?-s:s,h=Math.max(0,-(o*u+a)),d=-h*h+u*(u+2*c)+l;return n&&n.copy(this.origin).addScaledVector(this.direction,h),i&&i.copy(Hh).addScaledVector(Ha,u),d}intersectSphere(t,e){fi.subVectors(t.center,this.origin);let n=fi.dot(this.direction),i=fi.dot(fi)-n*n,s=t.radius*t.radius;if(i>s)return null;let o=Math.sqrt(s-i),a=n-o,c=n+o;return c<0?null:a<0?this.at(c,e):this.at(a,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){let e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(t.normal)+t.constant)/e;return n>=0?n:null}intersectPlane(t,e){let n=this.distanceToPlane(t);return n===null?null:this.at(n,e)}intersectsPlane(t){let e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let n,i,s,o,a,c,l=1/this.direction.x,f=1/this.direction.y,h=1/this.direction.z,u=this.origin;return l>=0?(n=(t.min.x-u.x)*l,i=(t.max.x-u.x)*l):(n=(t.max.x-u.x)*l,i=(t.min.x-u.x)*l),f>=0?(s=(t.min.y-u.y)*f,o=(t.max.y-u.y)*f):(s=(t.max.y-u.y)*f,o=(t.min.y-u.y)*f),n>o||s>i||((s>n||isNaN(n))&&(n=s),(o<i||isNaN(i))&&(i=o),h>=0?(a=(t.min.z-u.z)*h,c=(t.max.z-u.z)*h):(a=(t.max.z-u.z)*h,c=(t.min.z-u.z)*h),n>c||a>i)||((a>n||n!==n)&&(n=a),(c<i||i!==i)&&(i=c),i<0)?null:this.at(n>=0?n:i,e)}intersectsBox(t){return this.intersectBox(t,fi)!==null}intersectTriangle(t,e,n,i,s){Gh.subVectors(e,t),Ga.subVectors(n,t),Wh.crossVectors(Gh,Ga);let o=this.direction.dot(Wh),a;if(o>0){if(i)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Ci.subVectors(this.origin,t);let c=a*this.direction.dot(Ga.crossVectors(Ci,Ga));if(c<0)return null;let l=a*this.direction.dot(Gh.cross(Ci));if(l<0||c+l>o)return null;let f=-a*Ci.dot(Wh);return f<0?null:this.at(f/o,s)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},gt=class r{constructor(t,e,n,i,s,o,a,c,l,f,h,u,d,g,x,p){r.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,n,i,s,o,a,c,l,f,h,u,d,g,x,p)}set(t,e,n,i,s,o,a,c,l,f,h,u,d,g,x,p){let m=this.elements;return m[0]=t,m[4]=e,m[8]=n,m[12]=i,m[1]=s,m[5]=o,m[9]=a,m[13]=c,m[2]=l,m[6]=f,m[10]=h,m[14]=u,m[3]=d,m[7]=g,m[11]=x,m[15]=p,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new r().fromArray(this.elements)}copy(t){let e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],e[9]=n[9],e[10]=n[10],e[11]=n[11],e[12]=n[12],e[13]=n[13],e[14]=n[14],e[15]=n[15],this}copyPosition(t){let e=this.elements,n=t.elements;return e[12]=n[12],e[13]=n[13],e[14]=n[14],this}setFromMatrix3(t){let e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,n){return t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(t,e,n){return this.set(t.x,e.x,n.x,0,t.y,e.y,n.y,0,t.z,e.z,n.z,0,0,0,0,1),this}extractRotation(t){let e=this.elements,n=t.elements,i=1/jr.setFromMatrixColumn(t,0).length(),s=1/jr.setFromMatrixColumn(t,1).length(),o=1/jr.setFromMatrixColumn(t,2).length();return e[0]=n[0]*i,e[1]=n[1]*i,e[2]=n[2]*i,e[3]=0,e[4]=n[4]*s,e[5]=n[5]*s,e[6]=n[6]*s,e[7]=0,e[8]=n[8]*o,e[9]=n[9]*o,e[10]=n[10]*o,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){let e=this.elements,n=t.x,i=t.y,s=t.z,o=Math.cos(n),a=Math.sin(n),c=Math.cos(i),l=Math.sin(i),f=Math.cos(s),h=Math.sin(s);if(t.order==="XYZ"){let u=o*f,d=o*h,g=a*f,x=a*h;e[0]=c*f,e[4]=-c*h,e[8]=l,e[1]=d+g*l,e[5]=u-x*l,e[9]=-a*c,e[2]=x-u*l,e[6]=g+d*l,e[10]=o*c}else if(t.order==="YXZ"){let u=c*f,d=c*h,g=l*f,x=l*h;e[0]=u+x*a,e[4]=g*a-d,e[8]=o*l,e[1]=o*h,e[5]=o*f,e[9]=-a,e[2]=d*a-g,e[6]=x+u*a,e[10]=o*c}else if(t.order==="ZXY"){let u=c*f,d=c*h,g=l*f,x=l*h;e[0]=u-x*a,e[4]=-o*h,e[8]=g+d*a,e[1]=d+g*a,e[5]=o*f,e[9]=x-u*a,e[2]=-o*l,e[6]=a,e[10]=o*c}else if(t.order==="ZYX"){let u=o*f,d=o*h,g=a*f,x=a*h;e[0]=c*f,e[4]=g*l-d,e[8]=u*l+x,e[1]=c*h,e[5]=x*l+u,e[9]=d*l-g,e[2]=-l,e[6]=a*c,e[10]=o*c}else if(t.order==="YZX"){let u=o*c,d=o*l,g=a*c,x=a*l;e[0]=c*f,e[4]=x-u*h,e[8]=g*h+d,e[1]=h,e[5]=o*f,e[9]=-a*f,e[2]=-l*f,e[6]=d*h+g,e[10]=u-x*h}else if(t.order==="XZY"){let u=o*c,d=o*l,g=a*c,x=a*l;e[0]=c*f,e[4]=-h,e[8]=l*f,e[1]=u*h+x,e[5]=o*f,e[9]=d*h-g,e[2]=g*h-d,e[6]=a*f,e[10]=x*h+u}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(Q_,t,j_)}lookAt(t,e,n){let i=this.elements;return An.subVectors(t,e),An.lengthSq()===0&&(An.z=1),An.normalize(),Ii.crossVectors(n,An),Ii.lengthSq()===0&&(Math.abs(n.z)===1?An.x+=1e-4:An.z+=1e-4,An.normalize(),Ii.crossVectors(n,An)),Ii.normalize(),Wa.crossVectors(An,Ii),i[0]=Ii.x,i[4]=Wa.x,i[8]=An.x,i[1]=Ii.y,i[5]=Wa.y,i[9]=An.y,i[2]=Ii.z,i[6]=Wa.z,i[10]=An.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){let n=t.elements,i=e.elements,s=this.elements,o=n[0],a=n[4],c=n[8],l=n[12],f=n[1],h=n[5],u=n[9],d=n[13],g=n[2],x=n[6],p=n[10],m=n[14],v=n[3],_=n[7],y=n[11],b=n[15],T=i[0],w=i[4],E=i[8],M=i[12],S=i[1],I=i[5],P=i[9],L=i[13],N=i[2],z=i[6],V=i[10],j=i[14],W=i[3],ct=i[7],pt=i[11],_t=i[15];return s[0]=o*T+a*S+c*N+l*W,s[4]=o*w+a*I+c*z+l*ct,s[8]=o*E+a*P+c*V+l*pt,s[12]=o*M+a*L+c*j+l*_t,s[1]=f*T+h*S+u*N+d*W,s[5]=f*w+h*I+u*z+d*ct,s[9]=f*E+h*P+u*V+d*pt,s[13]=f*M+h*L+u*j+d*_t,s[2]=g*T+x*S+p*N+m*W,s[6]=g*w+x*I+p*z+m*ct,s[10]=g*E+x*P+p*V+m*pt,s[14]=g*M+x*L+p*j+m*_t,s[3]=v*T+_*S+y*N+b*W,s[7]=v*w+_*I+y*z+b*ct,s[11]=v*E+_*P+y*V+b*pt,s[15]=v*M+_*L+y*j+b*_t,this}multiplyScalar(t){let e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){let t=this.elements,e=t[0],n=t[4],i=t[8],s=t[12],o=t[1],a=t[5],c=t[9],l=t[13],f=t[2],h=t[6],u=t[10],d=t[14],g=t[3],x=t[7],p=t[11],m=t[15];return g*(+s*c*h-i*l*h-s*a*u+n*l*u+i*a*d-n*c*d)+x*(+e*c*d-e*l*u+s*o*u-i*o*d+i*l*f-s*c*f)+p*(+e*l*h-e*a*d-s*o*h+n*o*d+s*a*f-n*l*f)+m*(-i*a*f-e*c*h+e*a*u+i*o*h-n*o*u+n*c*f)}transpose(){let t=this.elements,e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,n){let i=this.elements;return t.isVector3?(i[12]=t.x,i[13]=t.y,i[14]=t.z):(i[12]=t,i[13]=e,i[14]=n),this}invert(){let t=this.elements,e=t[0],n=t[1],i=t[2],s=t[3],o=t[4],a=t[5],c=t[6],l=t[7],f=t[8],h=t[9],u=t[10],d=t[11],g=t[12],x=t[13],p=t[14],m=t[15],v=h*p*l-x*u*l+x*c*d-a*p*d-h*c*m+a*u*m,_=g*u*l-f*p*l-g*c*d+o*p*d+f*c*m-o*u*m,y=f*x*l-g*h*l+g*a*d-o*x*d-f*a*m+o*h*m,b=g*h*c-f*x*c-g*a*u+o*x*u+f*a*p-o*h*p,T=e*v+n*_+i*y+s*b;if(T===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let w=1/T;return t[0]=v*w,t[1]=(x*u*s-h*p*s-x*i*d+n*p*d+h*i*m-n*u*m)*w,t[2]=(a*p*s-x*c*s+x*i*l-n*p*l-a*i*m+n*c*m)*w,t[3]=(h*c*s-a*u*s-h*i*l+n*u*l+a*i*d-n*c*d)*w,t[4]=_*w,t[5]=(f*p*s-g*u*s+g*i*d-e*p*d-f*i*m+e*u*m)*w,t[6]=(g*c*s-o*p*s-g*i*l+e*p*l+o*i*m-e*c*m)*w,t[7]=(o*u*s-f*c*s+f*i*l-e*u*l-o*i*d+e*c*d)*w,t[8]=y*w,t[9]=(g*h*s-f*x*s-g*n*d+e*x*d+f*n*m-e*h*m)*w,t[10]=(o*x*s-g*a*s+g*n*l-e*x*l-o*n*m+e*a*m)*w,t[11]=(f*a*s-o*h*s-f*n*l+e*h*l+o*n*d-e*a*d)*w,t[12]=b*w,t[13]=(f*x*i-g*h*i+g*n*u-e*x*u-f*n*p+e*h*p)*w,t[14]=(g*a*i-o*x*i-g*n*c+e*x*c+o*n*p-e*a*p)*w,t[15]=(o*h*i-f*a*i+f*n*c-e*h*c-o*n*u+e*a*u)*w,this}scale(t){let e=this.elements,n=t.x,i=t.y,s=t.z;return e[0]*=n,e[4]*=i,e[8]*=s,e[1]*=n,e[5]*=i,e[9]*=s,e[2]*=n,e[6]*=i,e[10]*=s,e[3]*=n,e[7]*=i,e[11]*=s,this}getMaxScaleOnAxis(){let t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],n=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],i=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,n,i))}makeTranslation(t,e,n){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,n,0,0,0,1),this}makeRotationX(t){let e=Math.cos(t),n=Math.sin(t);return this.set(1,0,0,0,0,e,-n,0,0,n,e,0,0,0,0,1),this}makeRotationY(t){let e=Math.cos(t),n=Math.sin(t);return this.set(e,0,n,0,0,1,0,0,-n,0,e,0,0,0,0,1),this}makeRotationZ(t){let e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,0,n,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){let n=Math.cos(e),i=Math.sin(e),s=1-n,o=t.x,a=t.y,c=t.z,l=s*o,f=s*a;return this.set(l*o+n,l*a-i*c,l*c+i*a,0,l*a+i*c,f*a+n,f*c-i*o,0,l*c-i*a,f*c+i*o,s*c*c+n,0,0,0,0,1),this}makeScale(t,e,n){return this.set(t,0,0,0,0,e,0,0,0,0,n,0,0,0,0,1),this}makeShear(t,e,n,i,s,o){return this.set(1,n,s,0,t,1,o,0,e,i,1,0,0,0,0,1),this}compose(t,e,n){let i=this.elements,s=e._x,o=e._y,a=e._z,c=e._w,l=s+s,f=o+o,h=a+a,u=s*l,d=s*f,g=s*h,x=o*f,p=o*h,m=a*h,v=c*l,_=c*f,y=c*h,b=n.x,T=n.y,w=n.z;return i[0]=(1-(x+m))*b,i[1]=(d+y)*b,i[2]=(g-_)*b,i[3]=0,i[4]=(d-y)*T,i[5]=(1-(u+m))*T,i[6]=(p+v)*T,i[7]=0,i[8]=(g+_)*w,i[9]=(p-v)*w,i[10]=(1-(u+x))*w,i[11]=0,i[12]=t.x,i[13]=t.y,i[14]=t.z,i[15]=1,this}decompose(t,e,n){let i=this.elements,s=jr.set(i[0],i[1],i[2]).length(),o=jr.set(i[4],i[5],i[6]).length(),a=jr.set(i[8],i[9],i[10]).length();this.determinant()<0&&(s=-s),t.x=i[12],t.y=i[13],t.z=i[14],Wn.copy(this);let l=1/s,f=1/o,h=1/a;return Wn.elements[0]*=l,Wn.elements[1]*=l,Wn.elements[2]*=l,Wn.elements[4]*=f,Wn.elements[5]*=f,Wn.elements[6]*=f,Wn.elements[8]*=h,Wn.elements[9]*=h,Wn.elements[10]*=h,e.setFromRotationMatrix(Wn),n.x=s,n.y=o,n.z=a,this}makePerspective(t,e,n,i,s,o,a=Rn,c=!1){let l=this.elements,f=2*s/(e-t),h=2*s/(n-i),u=(e+t)/(e-t),d=(n+i)/(n-i),g,x;if(c)g=s/(o-s),x=o*s/(o-s);else if(a===Rn)g=-(o+s)/(o-s),x=-2*o*s/(o-s);else if(a===vs)g=-o/(o-s),x=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=f,l[4]=0,l[8]=u,l[12]=0,l[1]=0,l[5]=h,l[9]=d,l[13]=0,l[2]=0,l[6]=0,l[10]=g,l[14]=x,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(t,e,n,i,s,o,a=Rn,c=!1){let l=this.elements,f=2/(e-t),h=2/(n-i),u=-(e+t)/(e-t),d=-(n+i)/(n-i),g,x;if(c)g=1/(o-s),x=o/(o-s);else if(a===Rn)g=-2/(o-s),x=-(o+s)/(o-s);else if(a===vs)g=-1/(o-s),x=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=f,l[4]=0,l[8]=0,l[12]=u,l[1]=0,l[5]=h,l[9]=0,l[13]=d,l[2]=0,l[6]=0,l[10]=g,l[14]=x,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(t){let e=this.elements,n=t.elements;for(let i=0;i<16;i++)if(e[i]!==n[i])return!1;return!0}fromArray(t,e=0){for(let n=0;n<16;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){let n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t[e+9]=n[9],t[e+10]=n[10],t[e+11]=n[11],t[e+12]=n[12],t[e+13]=n[13],t[e+14]=n[14],t[e+15]=n[15],t}},jr=new R,Wn=new gt,Q_=new R(0,0,0),j_=new R(1,1,1),Ii=new R,Wa=new R,An=new R,dm=new gt,pm=new Ze,In=class r{constructor(t=0,e=0,n=0,i=r.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=n,this._order=i}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,n,i=this._order){return this._x=t,this._y=e,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,n=!0){let i=t.elements,s=i[0],o=i[4],a=i[8],c=i[1],l=i[5],f=i[9],h=i[2],u=i[6],d=i[10];switch(e){case"XYZ":this._y=Math.asin(Bt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-f,d),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(u,l),this._z=0);break;case"YXZ":this._x=Math.asin(-Bt(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(a,d),this._z=Math.atan2(c,l)):(this._y=Math.atan2(-h,s),this._z=0);break;case"ZXY":this._x=Math.asin(Bt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-h,d),this._z=Math.atan2(-o,l)):(this._y=0,this._z=Math.atan2(c,s));break;case"ZYX":this._y=Math.asin(-Bt(h,-1,1)),Math.abs(h)<.9999999?(this._x=Math.atan2(u,d),this._z=Math.atan2(c,s)):(this._x=0,this._z=Math.atan2(-o,l));break;case"YZX":this._z=Math.asin(Bt(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(-f,l),this._y=Math.atan2(-h,s)):(this._x=0,this._y=Math.atan2(a,d));break;case"XZY":this._z=Math.asin(-Bt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(u,l),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-f,d),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,n===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,n){return dm.makeRotationFromQuaternion(t),this.setFromRotationMatrix(dm,e,n)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return pm.setFromEuler(this),this.setFromQuaternion(pm,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};In.DEFAULT_ORDER="XYZ";var Ss=class{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}},ty=0,mm=new R,ts=new Ze,di=new gt,Xa=new R,uo=new R,ey=new R,ny=new Ze,gm=new R(1,0,0),xm=new R(0,1,0),vm=new R(0,0,1),_m={type:"added"},iy={type:"removed"},es={type:"childadded",child:null},Xh={type:"childremoved",child:null},ue=class r extends On{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:ty++}),this.uuid=Cn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=r.DEFAULT_UP.clone();let t=new R,e=new In,n=new Ze,i=new R(1,1,1);function s(){n.setFromEuler(e,!1)}function o(){e.setFromQuaternion(n,void 0,!1)}e._onChange(s),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new gt},normalMatrix:{value:new Xt}}),this.matrix=new gt,this.matrixWorld=new gt,this.matrixAutoUpdate=r.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=r.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Ss,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return ts.setFromAxisAngle(t,e),this.quaternion.multiply(ts),this}rotateOnWorldAxis(t,e){return ts.setFromAxisAngle(t,e),this.quaternion.premultiply(ts),this}rotateX(t){return this.rotateOnAxis(gm,t)}rotateY(t){return this.rotateOnAxis(xm,t)}rotateZ(t){return this.rotateOnAxis(vm,t)}translateOnAxis(t,e){return mm.copy(t).applyQuaternion(this.quaternion),this.position.add(mm.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(gm,t)}translateY(t){return this.translateOnAxis(xm,t)}translateZ(t){return this.translateOnAxis(vm,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(di.copy(this.matrixWorld).invert())}lookAt(t,e,n){t.isVector3?Xa.copy(t):Xa.set(t,e,n);let i=this.parent;this.updateWorldMatrix(!0,!1),uo.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?di.lookAt(uo,Xa,this.up):di.lookAt(Xa,uo,this.up),this.quaternion.setFromRotationMatrix(di),i&&(di.extractRotation(i.matrixWorld),ts.setFromRotationMatrix(di),this.quaternion.premultiply(ts.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(_m),es.child=t,this.dispatchEvent(es),es.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(iy),Xh.child=t,this.dispatchEvent(Xh),Xh.child=null),this}removeFromParent(){let t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),di.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),di.multiply(t.parent.matrixWorld)),t.applyMatrix4(di),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(_m),es.child=t,this.dispatchEvent(es),es.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let n=0,i=this.children.length;n<i;n++){let o=this.children[n].getObjectByProperty(t,e);if(o!==void 0)return o}}getObjectsByProperty(t,e,n=[]){this[t]===e&&n.push(this);let i=this.children;for(let s=0,o=i.length;s<o;s++)i[s].getObjectsByProperty(t,e,n);return n}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(uo,t,ey),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(uo,ny,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);let e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);let e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);let e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].traverseVisible(t)}traverseAncestors(t){let e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);let e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].updateMatrixWorld(t)}updateWorldMatrix(t,e){let n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),e===!0){let i=this.children;for(let s=0,o=i.length;s<o;s++)i[s].updateWorldMatrix(!1,!0)}}toJSON(t){let e=t===void 0||typeof t=="string",n={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let i={};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.castShadow===!0&&(i.castShadow=!0),this.receiveShadow===!0&&(i.receiveShadow=!0),this.visible===!1&&(i.visible=!1),this.frustumCulled===!1&&(i.frustumCulled=!1),this.renderOrder!==0&&(i.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(i.matrixAutoUpdate=!1),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),i.instanceInfo=this._instanceInfo.map(a=>({...a})),i.availableInstanceIds=this._availableInstanceIds.slice(),i.availableGeometryIds=this._availableGeometryIds.slice(),i.nextIndexStart=this._nextIndexStart,i.nextVertexStart=this._nextVertexStart,i.geometryCount=this._geometryCount,i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.matricesTexture=this._matricesTexture.toJSON(t),i.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(i.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(i.boundingBox=this.boundingBox.toJSON()));function s(a,c){return a[c.uuid]===void 0&&(a[c.uuid]=c.toJSON(t)),c.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=s(t.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let c=a.shapes;if(Array.isArray(c))for(let l=0,f=c.length;l<f;l++){let h=c[l];s(t.shapes,h)}else s(t.shapes,c)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(t.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let c=0,l=this.material.length;c<l;c++)a.push(s(t.materials,this.material[c]));i.material=a}else i.material=s(t.materials,this.material);if(this.children.length>0){i.children=[];for(let a=0;a<this.children.length;a++)i.children.push(this.children[a].toJSON(t).object)}if(this.animations.length>0){i.animations=[];for(let a=0;a<this.animations.length;a++){let c=this.animations[a];i.animations.push(s(t.animations,c))}}if(e){let a=o(t.geometries),c=o(t.materials),l=o(t.textures),f=o(t.images),h=o(t.shapes),u=o(t.skeletons),d=o(t.animations),g=o(t.nodes);a.length>0&&(n.geometries=a),c.length>0&&(n.materials=c),l.length>0&&(n.textures=l),f.length>0&&(n.images=f),h.length>0&&(n.shapes=h),u.length>0&&(n.skeletons=u),d.length>0&&(n.animations=d),g.length>0&&(n.nodes=g)}return n.object=i,n;function o(a){let c=[];for(let l in a){let f=a[l];delete f.metadata,c.push(f)}return c}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let n=0;n<t.children.length;n++){let i=t.children[n];this.add(i.clone())}return this}};ue.DEFAULT_UP=new R(0,1,0);ue.DEFAULT_MATRIX_AUTO_UPDATE=!0;ue.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Xn=new R,pi=new R,qh=new R,mi=new R,ns=new R,is=new R,ym=new R,Yh=new R,$h=new R,Zh=new R,Jh=new Kt,Kh=new Kt,Qh=new Kt,$e=class r{constructor(t=new R,e=new R,n=new R){this.a=t,this.b=e,this.c=n}static getNormal(t,e,n,i){i.subVectors(n,e),Xn.subVectors(t,e),i.cross(Xn);let s=i.lengthSq();return s>0?i.multiplyScalar(1/Math.sqrt(s)):i.set(0,0,0)}static getBarycoord(t,e,n,i,s){Xn.subVectors(i,e),pi.subVectors(n,e),qh.subVectors(t,e);let o=Xn.dot(Xn),a=Xn.dot(pi),c=Xn.dot(qh),l=pi.dot(pi),f=pi.dot(qh),h=o*l-a*a;if(h===0)return s.set(0,0,0),null;let u=1/h,d=(l*c-a*f)*u,g=(o*f-a*c)*u;return s.set(1-d-g,g,d)}static containsPoint(t,e,n,i){return this.getBarycoord(t,e,n,i,mi)===null?!1:mi.x>=0&&mi.y>=0&&mi.x+mi.y<=1}static getInterpolation(t,e,n,i,s,o,a,c){return this.getBarycoord(t,e,n,i,mi)===null?(c.x=0,c.y=0,"z"in c&&(c.z=0),"w"in c&&(c.w=0),null):(c.setScalar(0),c.addScaledVector(s,mi.x),c.addScaledVector(o,mi.y),c.addScaledVector(a,mi.z),c)}static getInterpolatedAttribute(t,e,n,i,s,o){return Jh.setScalar(0),Kh.setScalar(0),Qh.setScalar(0),Jh.fromBufferAttribute(t,e),Kh.fromBufferAttribute(t,n),Qh.fromBufferAttribute(t,i),o.setScalar(0),o.addScaledVector(Jh,s.x),o.addScaledVector(Kh,s.y),o.addScaledVector(Qh,s.z),o}static isFrontFacing(t,e,n,i){return Xn.subVectors(n,e),pi.subVectors(t,e),Xn.cross(pi).dot(i)<0}set(t,e,n){return this.a.copy(t),this.b.copy(e),this.c.copy(n),this}setFromPointsAndIndices(t,e,n,i){return this.a.copy(t[e]),this.b.copy(t[n]),this.c.copy(t[i]),this}setFromAttributeAndIndices(t,e,n,i){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,n),this.c.fromBufferAttribute(t,i),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Xn.subVectors(this.c,this.b),pi.subVectors(this.a,this.b),Xn.cross(pi).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return r.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return r.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,n,i,s){return r.getInterpolation(t,this.a,this.b,this.c,e,n,i,s)}containsPoint(t){return r.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return r.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){let n=this.a,i=this.b,s=this.c,o,a;ns.subVectors(i,n),is.subVectors(s,n),Yh.subVectors(t,n);let c=ns.dot(Yh),l=is.dot(Yh);if(c<=0&&l<=0)return e.copy(n);$h.subVectors(t,i);let f=ns.dot($h),h=is.dot($h);if(f>=0&&h<=f)return e.copy(i);let u=c*h-f*l;if(u<=0&&c>=0&&f<=0)return o=c/(c-f),e.copy(n).addScaledVector(ns,o);Zh.subVectors(t,s);let d=ns.dot(Zh),g=is.dot(Zh);if(g>=0&&d<=g)return e.copy(s);let x=d*l-c*g;if(x<=0&&l>=0&&g<=0)return a=l/(l-g),e.copy(n).addScaledVector(is,a);let p=f*g-d*h;if(p<=0&&h-f>=0&&d-g>=0)return ym.subVectors(s,i),a=(h-f)/(h-f+(d-g)),e.copy(i).addScaledVector(ym,a);let m=1/(p+x+u);return o=x*m,a=u*m,e.copy(n).addScaledVector(ns,o).addScaledVector(is,a)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}},a0={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Pi={h:0,s:0,l:0},qa={h:0,s:0,l:0};function jh(r,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?r+(t-r)*6*e:e<1/2?t:e<2/3?r+(t-r)*6*(2/3-e):r}var ft=class{constructor(t,e,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,n)}set(t,e,n){if(e===void 0&&n===void 0){let i=t;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(t,e,n);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=vn){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,ie.colorSpaceToWorking(this,e),this}setRGB(t,e,n,i=ie.workingColorSpace){return this.r=t,this.g=e,this.b=n,ie.colorSpaceToWorking(this,i),this}setHSL(t,e,n,i=ie.workingColorSpace){if(t=Yd(t,1),e=Bt(e,0,1),n=Bt(n,0,1),e===0)this.r=this.g=this.b=n;else{let s=n<=.5?n*(1+e):n+e-n*e,o=2*n-s;this.r=jh(o,s,t+1/3),this.g=jh(o,s,t),this.b=jh(o,s,t-1/3)}return ie.colorSpaceToWorking(this,i),this}setStyle(t,e=vn){function n(s){s!==void 0&&parseFloat(s)<1&&console.warn("THREE.Color: Alpha component of "+t+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(t)){let s,o=i[1],a=i[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,e);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,e);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,e);break;default:console.warn("THREE.Color: Unknown color model "+t)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(t)){let s=i[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,e);if(o===6)return this.setHex(parseInt(s,16),e);console.warn("THREE.Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=vn){let n=a0[t.toLowerCase()];return n!==void 0?this.setHex(n,e):console.warn("THREE.Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=vi(t.r),this.g=vi(t.g),this.b=vi(t.b),this}copyLinearToSRGB(t){return this.r=gs(t.r),this.g=gs(t.g),this.b=gs(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=vn){return ie.workingToColorSpace(nn.copy(this),t),Math.round(Bt(nn.r*255,0,255))*65536+Math.round(Bt(nn.g*255,0,255))*256+Math.round(Bt(nn.b*255,0,255))}getHexString(t=vn){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=ie.workingColorSpace){ie.workingToColorSpace(nn.copy(this),e);let n=nn.r,i=nn.g,s=nn.b,o=Math.max(n,i,s),a=Math.min(n,i,s),c,l,f=(a+o)/2;if(a===o)c=0,l=0;else{let h=o-a;switch(l=f<=.5?h/(o+a):h/(2-o-a),o){case n:c=(i-s)/h+(i<s?6:0);break;case i:c=(s-n)/h+2;break;case s:c=(n-i)/h+4;break}c/=6}return t.h=c,t.s=l,t.l=f,t}getRGB(t,e=ie.workingColorSpace){return ie.workingToColorSpace(nn.copy(this),e),t.r=nn.r,t.g=nn.g,t.b=nn.b,t}getStyle(t=vn){ie.workingToColorSpace(nn.copy(this),t);let e=nn.r,n=nn.g,i=nn.b;return t!==vn?`color(${t} ${e.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(t,e,n){return this.getHSL(Pi),this.setHSL(Pi.h+t,Pi.s+e,Pi.l+n)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,n){return this.r=t.r+(e.r-t.r)*n,this.g=t.g+(e.g-t.g)*n,this.b=t.b+(e.b-t.b)*n,this}lerpHSL(t,e){this.getHSL(Pi),t.getHSL(qa);let n=Mo(Pi.h,qa.h,e),i=Mo(Pi.s,qa.s,e),s=Mo(Pi.l,qa.l,e);return this.setHSL(n,i,s),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){let e=this.r,n=this.g,i=this.b,s=t.elements;return this.r=s[0]*e+s[3]*n+s[6]*i,this.g=s[1]*e+s[4]*n+s[7]*i,this.b=s[2]*e+s[5]*n+s[8]*i,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},nn=new ft;ft.NAMES=a0;var ry=0,Je=class extends On{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:ry++}),this.uuid=Cn(),this.name="",this.type="Material",this.blending=Yn,this.side=yn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Rc,this.blendDst=Cc,this.blendEquation=Ni,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new ft(0,0,0),this.blendAlpha=0,this.depthFunc=_r,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Sf,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=pr,this.stencilZFail=pr,this.stencilZPass=pr,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(let e in t){let n=t[e];if(n===void 0){console.warn(`THREE.Material: parameter '${e}' has value of undefined.`);continue}let i=this[e];if(i===void 0){console.warn(`THREE.Material: '${e}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[e]=n}}toJSON(t){let e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(t).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(t).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(t).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(t).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(t).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Yn&&(n.blending=this.blending),this.side!==yn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Rc&&(n.blendSrc=this.blendSrc),this.blendDst!==Cc&&(n.blendDst=this.blendDst),this.blendEquation!==Ni&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==_r&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Sf&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==pr&&(n.stencilFail=this.stencilFail),this.stencilZFail!==pr&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==pr&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(s){let o=[];for(let a in s){let c=s[a];delete c.metadata,o.push(c)}return o}if(e){let s=i(t.textures),o=i(t.images);s.length>0&&(n.textures=s),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;let e=t.clippingPlanes,n=null;if(e!==null){let i=e.length;n=new Array(i);for(let s=0;s!==i;++s)n[s]=e[s].clone()}return this.clippingPlanes=n,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}},zn=class extends Je{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new ft(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new In,this.combine=ua,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}},xi=sy();function sy(){let r=new ArrayBuffer(4),t=new Float32Array(r),e=new Uint32Array(r),n=new Uint32Array(512),i=new Uint32Array(512);for(let c=0;c<256;++c){let l=c-127;l<-27?(n[c]=0,n[c|256]=32768,i[c]=24,i[c|256]=24):l<-14?(n[c]=1024>>-l-14,n[c|256]=1024>>-l-14|32768,i[c]=-l-1,i[c|256]=-l-1):l<=15?(n[c]=l+15<<10,n[c|256]=l+15<<10|32768,i[c]=13,i[c|256]=13):l<128?(n[c]=31744,n[c|256]=64512,i[c]=24,i[c|256]=24):(n[c]=31744,n[c|256]=64512,i[c]=13,i[c|256]=13)}let s=new Uint32Array(2048),o=new Uint32Array(64),a=new Uint32Array(64);for(let c=1;c<1024;++c){let l=c<<13,f=0;for(;(l&8388608)===0;)l<<=1,f-=8388608;l&=-8388609,f+=947912704,s[c]=l|f}for(let c=1024;c<2048;++c)s[c]=939524096+(c-1024<<13);for(let c=1;c<31;++c)o[c]=c<<23;o[31]=1199570944,o[32]=2147483648;for(let c=33;c<63;++c)o[c]=2147483648+(c-32<<23);o[63]=3347054592;for(let c=1;c<64;++c)c!==32&&(a[c]=1024);return{floatView:t,uint32View:e,baseTable:n,shiftTable:i,mantissaTable:s,exponentTable:o,offsetTable:a}}function xn(r){Math.abs(r)>65504&&console.warn("THREE.DataUtils.toHalfFloat(): Value out of range."),r=Bt(r,-65504,65504),xi.floatView[0]=r;let t=xi.uint32View[0],e=t>>23&511;return xi.baseTable[e]+((t&8388607)>>xi.shiftTable[e])}function bo(r){let t=r>>10;return xi.uint32View[0]=xi.mantissaTable[xi.offsetTable[t]+(r&1023)]+xi.exponentTable[t],xi.floatView[0]}var fn=class{static toHalfFloat(t){return xn(t)}static fromHalfFloat(t){return bo(t)}},Be=new R,Ya=new q,oy=0,Ot=class{constructor(t,e,n=!1){if(Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:oy++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=n,this.usage=Io,this.updateRanges=[],this.gpuType=$t,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,n){t*=this.itemSize,n*=e.itemSize;for(let i=0,s=this.itemSize;i<s;i++)this.array[t+i]=e.array[n+i];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,n=this.count;e<n;e++)Ya.fromBufferAttribute(this,e),Ya.applyMatrix3(t),this.setXY(e,Ya.x,Ya.y);else if(this.itemSize===3)for(let e=0,n=this.count;e<n;e++)Be.fromBufferAttribute(this,e),Be.applyMatrix3(t),this.setXYZ(e,Be.x,Be.y,Be.z);return this}applyMatrix4(t){for(let e=0,n=this.count;e<n;e++)Be.fromBufferAttribute(this,e),Be.applyMatrix4(t),this.setXYZ(e,Be.x,Be.y,Be.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)Be.fromBufferAttribute(this,e),Be.applyNormalMatrix(t),this.setXYZ(e,Be.x,Be.y,Be.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)Be.fromBufferAttribute(this,e),Be.transformDirection(t),this.setXYZ(e,Be.x,Be.y,Be.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let n=this.array[t*this.itemSize+e];return this.normalized&&(n=hn(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=Zt(n,this.array)),this.array[t*this.itemSize+e]=n,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=hn(e,this.array)),e}setX(t,e){return this.normalized&&(e=Zt(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=hn(e,this.array)),e}setY(t,e){return this.normalized&&(e=Zt(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=hn(e,this.array)),e}setZ(t,e){return this.normalized&&(e=Zt(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=hn(e,this.array)),e}setW(t,e){return this.normalized&&(e=Zt(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=Zt(e,this.array),n=Zt(n,this.array)),this.array[t+0]=e,this.array[t+1]=n,this}setXYZ(t,e,n,i){return t*=this.itemSize,this.normalized&&(e=Zt(e,this.array),n=Zt(n,this.array),i=Zt(i,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=i,this}setXYZW(t,e,n,i,s){return t*=this.itemSize,this.normalized&&(e=Zt(e,this.array),n=Zt(n,this.array),i=Zt(i,this.array),s=Zt(s,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=i,this.array[t+3]=s,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==Io&&(t.usage=this.usage),t}},Tf=class extends Ot{constructor(t,e,n){super(new Int8Array(t),e,n)}},wf=class extends Ot{constructor(t,e,n){super(new Uint8Array(t),e,n)}},Af=class extends Ot{constructor(t,e,n){super(new Uint8ClampedArray(t),e,n)}},Ef=class extends Ot{constructor(t,e,n){super(new Int16Array(t),e,n)}},Fo=class extends Ot{constructor(t,e,n){super(new Uint16Array(t),e,n)}},Rf=class extends Ot{constructor(t,e,n){super(new Int32Array(t),e,n)}},Lo=class extends Ot{constructor(t,e,n){super(new Uint32Array(t),e,n)}},Cf=class extends Ot{constructor(t,e,n){super(new Uint16Array(t),e,n),this.isFloat16BufferAttribute=!0}getX(t){let e=bo(this.array[t*this.itemSize]);return this.normalized&&(e=hn(e,this.array)),e}setX(t,e){return this.normalized&&(e=Zt(e,this.array)),this.array[t*this.itemSize]=xn(e),this}getY(t){let e=bo(this.array[t*this.itemSize+1]);return this.normalized&&(e=hn(e,this.array)),e}setY(t,e){return this.normalized&&(e=Zt(e,this.array)),this.array[t*this.itemSize+1]=xn(e),this}getZ(t){let e=bo(this.array[t*this.itemSize+2]);return this.normalized&&(e=hn(e,this.array)),e}setZ(t,e){return this.normalized&&(e=Zt(e,this.array)),this.array[t*this.itemSize+2]=xn(e),this}getW(t){let e=bo(this.array[t*this.itemSize+3]);return this.normalized&&(e=hn(e,this.array)),e}setW(t,e){return this.normalized&&(e=Zt(e,this.array)),this.array[t*this.itemSize+3]=xn(e),this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=Zt(e,this.array),n=Zt(n,this.array)),this.array[t+0]=xn(e),this.array[t+1]=xn(n),this}setXYZ(t,e,n,i){return t*=this.itemSize,this.normalized&&(e=Zt(e,this.array),n=Zt(n,this.array),i=Zt(i,this.array)),this.array[t+0]=xn(e),this.array[t+1]=xn(n),this.array[t+2]=xn(i),this}setXYZW(t,e,n,i,s){return t*=this.itemSize,this.normalized&&(e=Zt(e,this.array),n=Zt(n,this.array),i=Zt(i,this.array),s=Zt(s,this.array)),this.array[t+0]=xn(e),this.array[t+1]=xn(n),this.array[t+2]=xn(i),this.array[t+3]=xn(s),this}},bt=class extends Ot{constructor(t,e,n){super(new Float32Array(t),e,n)}},ay=0,Un=new gt,tf=new ue,rs=new R,En=new se,ho=new se,Ye=new R,Ft=class r extends On{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:ay++}),this.uuid=Cn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new($d(t)?Lo:Fo)(t,1):this.index=t,this}setIndirect(t){return this.indirect=t,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,n=0){this.groups.push({start:t,count:e,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){let e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let s=new Xt().getNormalMatrix(t);n.applyNormalMatrix(s),n.needsUpdate=!0}let i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(t),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(t){return Un.makeRotationFromQuaternion(t),this.applyMatrix4(Un),this}rotateX(t){return Un.makeRotationX(t),this.applyMatrix4(Un),this}rotateY(t){return Un.makeRotationY(t),this.applyMatrix4(Un),this}rotateZ(t){return Un.makeRotationZ(t),this.applyMatrix4(Un),this}translate(t,e,n){return Un.makeTranslation(t,e,n),this.applyMatrix4(Un),this}scale(t,e,n){return Un.makeScale(t,e,n),this.applyMatrix4(Un),this}lookAt(t){return tf.lookAt(t),tf.updateMatrix(),this.applyMatrix4(tf.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(rs).negate(),this.translate(rs.x,rs.y,rs.z),this}setFromPoints(t){let e=this.getAttribute("position");if(e===void 0){let n=[];for(let i=0,s=t.length;i<s;i++){let o=t[i];n.push(o.x,o.y,o.z||0)}this.setAttribute("position",new bt(n,3))}else{let n=Math.min(t.length,e.count);for(let i=0;i<n;i++){let s=t[i];e.setXYZ(i,s.x,s.y,s.z||0)}t.length>e.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new se);let t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new R(-1/0,-1/0,-1/0),new R(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let n=0,i=e.length;n<i;n++){let s=e[n];En.setFromBufferAttribute(s),this.morphTargetsRelative?(Ye.addVectors(this.boundingBox.min,En.min),this.boundingBox.expandByPoint(Ye),Ye.addVectors(this.boundingBox.max,En.max),this.boundingBox.expandByPoint(Ye)):(this.boundingBox.expandByPoint(En.min),this.boundingBox.expandByPoint(En.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Ve);let t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new R,1/0);return}if(t){let n=this.boundingSphere.center;if(En.setFromBufferAttribute(t),e)for(let s=0,o=e.length;s<o;s++){let a=e[s];ho.setFromBufferAttribute(a),this.morphTargetsRelative?(Ye.addVectors(En.min,ho.min),En.expandByPoint(Ye),Ye.addVectors(En.max,ho.max),En.expandByPoint(Ye)):(En.expandByPoint(ho.min),En.expandByPoint(ho.max))}En.getCenter(n);let i=0;for(let s=0,o=t.count;s<o;s++)Ye.fromBufferAttribute(t,s),i=Math.max(i,n.distanceToSquared(Ye));if(e)for(let s=0,o=e.length;s<o;s++){let a=e[s],c=this.morphTargetsRelative;for(let l=0,f=a.count;l<f;l++)Ye.fromBufferAttribute(a,l),c&&(rs.fromBufferAttribute(t,l),Ye.add(rs)),i=Math.max(i,n.distanceToSquared(Ye))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=e.position,i=e.normal,s=e.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Ot(new Float32Array(4*n.count),4));let o=this.getAttribute("tangent"),a=[],c=[];for(let E=0;E<n.count;E++)a[E]=new R,c[E]=new R;let l=new R,f=new R,h=new R,u=new q,d=new q,g=new q,x=new R,p=new R;function m(E,M,S){l.fromBufferAttribute(n,E),f.fromBufferAttribute(n,M),h.fromBufferAttribute(n,S),u.fromBufferAttribute(s,E),d.fromBufferAttribute(s,M),g.fromBufferAttribute(s,S),f.sub(l),h.sub(l),d.sub(u),g.sub(u);let I=1/(d.x*g.y-g.x*d.y);isFinite(I)&&(x.copy(f).multiplyScalar(g.y).addScaledVector(h,-d.y).multiplyScalar(I),p.copy(h).multiplyScalar(d.x).addScaledVector(f,-g.x).multiplyScalar(I),a[E].add(x),a[M].add(x),a[S].add(x),c[E].add(p),c[M].add(p),c[S].add(p))}let v=this.groups;v.length===0&&(v=[{start:0,count:t.count}]);for(let E=0,M=v.length;E<M;++E){let S=v[E],I=S.start,P=S.count;for(let L=I,N=I+P;L<N;L+=3)m(t.getX(L+0),t.getX(L+1),t.getX(L+2))}let _=new R,y=new R,b=new R,T=new R;function w(E){b.fromBufferAttribute(i,E),T.copy(b);let M=a[E];_.copy(M),_.sub(b.multiplyScalar(b.dot(M))).normalize(),y.crossVectors(T,M);let I=y.dot(c[E])<0?-1:1;o.setXYZW(E,_.x,_.y,_.z,I)}for(let E=0,M=v.length;E<M;++E){let S=v[E],I=S.start,P=S.count;for(let L=I,N=I+P;L<N;L+=3)w(t.getX(L+0)),w(t.getX(L+1)),w(t.getX(L+2))}}computeVertexNormals(){let t=this.index,e=this.getAttribute("position");if(e!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new Ot(new Float32Array(e.count*3),3),this.setAttribute("normal",n);else for(let u=0,d=n.count;u<d;u++)n.setXYZ(u,0,0,0);let i=new R,s=new R,o=new R,a=new R,c=new R,l=new R,f=new R,h=new R;if(t)for(let u=0,d=t.count;u<d;u+=3){let g=t.getX(u+0),x=t.getX(u+1),p=t.getX(u+2);i.fromBufferAttribute(e,g),s.fromBufferAttribute(e,x),o.fromBufferAttribute(e,p),f.subVectors(o,s),h.subVectors(i,s),f.cross(h),a.fromBufferAttribute(n,g),c.fromBufferAttribute(n,x),l.fromBufferAttribute(n,p),a.add(f),c.add(f),l.add(f),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(x,c.x,c.y,c.z),n.setXYZ(p,l.x,l.y,l.z)}else for(let u=0,d=e.count;u<d;u+=3)i.fromBufferAttribute(e,u+0),s.fromBufferAttribute(e,u+1),o.fromBufferAttribute(e,u+2),f.subVectors(o,s),h.subVectors(i,s),f.cross(h),n.setXYZ(u+0,f.x,f.y,f.z),n.setXYZ(u+1,f.x,f.y,f.z),n.setXYZ(u+2,f.x,f.y,f.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let t=this.attributes.normal;for(let e=0,n=t.count;e<n;e++)Ye.fromBufferAttribute(t,e),Ye.normalize(),t.setXYZ(e,Ye.x,Ye.y,Ye.z)}toNonIndexed(){function t(a,c){let l=a.array,f=a.itemSize,h=a.normalized,u=new l.constructor(c.length*f),d=0,g=0;for(let x=0,p=c.length;x<p;x++){a.isInterleavedBufferAttribute?d=c[x]*a.data.stride+a.offset:d=c[x]*f;for(let m=0;m<f;m++)u[g++]=l[d++]}return new Ot(u,f,h)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let e=new r,n=this.index.array,i=this.attributes;for(let a in i){let c=i[a],l=t(c,n);e.setAttribute(a,l)}let s=this.morphAttributes;for(let a in s){let c=[],l=s[a];for(let f=0,h=l.length;f<h;f++){let u=l[f],d=t(u,n);c.push(d)}e.morphAttributes[a]=c}e.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,c=o.length;a<c;a++){let l=o[a];e.addGroup(l.start,l.count,l.materialIndex)}return e}toJSON(){let t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0){let c=this.parameters;for(let l in c)c[l]!==void 0&&(t[l]=c[l]);return t}t.data={attributes:{}};let e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});let n=this.attributes;for(let c in n){let l=n[c];t.data.attributes[c]=l.toJSON(t.data)}let i={},s=!1;for(let c in this.morphAttributes){let l=this.morphAttributes[c],f=[];for(let h=0,u=l.length;h<u;h++){let d=l[h];f.push(d.toJSON(t.data))}f.length>0&&(i[c]=f,s=!0)}s&&(t.data.morphAttributes=i,t.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(t.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(t.data.boundingSphere=a.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let e={};this.name=t.name;let n=t.index;n!==null&&this.setIndex(n.clone());let i=t.attributes;for(let l in i){let f=i[l];this.setAttribute(l,f.clone(e))}let s=t.morphAttributes;for(let l in s){let f=[],h=s[l];for(let u=0,d=h.length;u<d;u++)f.push(h[u].clone(e));this.morphAttributes[l]=f}this.morphTargetsRelative=t.morphTargetsRelative;let o=t.groups;for(let l=0,f=o.length;l<f;l++){let h=o[l];this.addGroup(h.start,h.count,h.materialIndex)}let a=t.boundingBox;a!==null&&(this.boundingBox=a.clone());let c=t.boundingSphere;return c!==null&&(this.boundingSphere=c.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},bm=new gt,rr=new ii,$a=new Ve,Sm=new R,Za=new R,Ja=new R,Ka=new R,ef=new R,Qa=new R,Mm=new R,ja=new R,Me=class extends ue{constructor(t=new Ft,e=new zn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){let e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){let i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=i.length;s<o;s++){let a=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(t,e){let n=this.geometry,i=n.attributes.position,s=n.morphAttributes.position,o=n.morphTargetsRelative;e.fromBufferAttribute(i,t);let a=this.morphTargetInfluences;if(s&&a){Qa.set(0,0,0);for(let c=0,l=s.length;c<l;c++){let f=a[c],h=s[c];f!==0&&(ef.fromBufferAttribute(h,t),o?Qa.addScaledVector(ef,f):Qa.addScaledVector(ef.sub(e),f))}e.add(Qa)}return e}raycast(t,e){let n=this.geometry,i=this.material,s=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),$a.copy(n.boundingSphere),$a.applyMatrix4(s),rr.copy(t.ray).recast(t.near),!($a.containsPoint(rr.origin)===!1&&(rr.intersectSphere($a,Sm)===null||rr.origin.distanceToSquared(Sm)>(t.far-t.near)**2))&&(bm.copy(s).invert(),rr.copy(t.ray).applyMatrix4(bm),!(n.boundingBox!==null&&rr.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(t,e,rr)))}_computeIntersections(t,e,n){let i,s=this.geometry,o=this.material,a=s.index,c=s.attributes.position,l=s.attributes.uv,f=s.attributes.uv1,h=s.attributes.normal,u=s.groups,d=s.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,x=u.length;g<x;g++){let p=u[g],m=o[p.materialIndex],v=Math.max(p.start,d.start),_=Math.min(a.count,Math.min(p.start+p.count,d.start+d.count));for(let y=v,b=_;y<b;y+=3){let T=a.getX(y),w=a.getX(y+1),E=a.getX(y+2);i=tc(this,m,t,n,l,f,h,T,w,E),i&&(i.faceIndex=Math.floor(y/3),i.face.materialIndex=p.materialIndex,e.push(i))}}else{let g=Math.max(0,d.start),x=Math.min(a.count,d.start+d.count);for(let p=g,m=x;p<m;p+=3){let v=a.getX(p),_=a.getX(p+1),y=a.getX(p+2);i=tc(this,o,t,n,l,f,h,v,_,y),i&&(i.faceIndex=Math.floor(p/3),e.push(i))}}else if(c!==void 0)if(Array.isArray(o))for(let g=0,x=u.length;g<x;g++){let p=u[g],m=o[p.materialIndex],v=Math.max(p.start,d.start),_=Math.min(c.count,Math.min(p.start+p.count,d.start+d.count));for(let y=v,b=_;y<b;y+=3){let T=y,w=y+1,E=y+2;i=tc(this,m,t,n,l,f,h,T,w,E),i&&(i.faceIndex=Math.floor(y/3),i.face.materialIndex=p.materialIndex,e.push(i))}}else{let g=Math.max(0,d.start),x=Math.min(c.count,d.start+d.count);for(let p=g,m=x;p<m;p+=3){let v=p,_=p+1,y=p+2;i=tc(this,o,t,n,l,f,h,v,_,y),i&&(i.faceIndex=Math.floor(p/3),e.push(i))}}}};function cy(r,t,e,n,i,s,o,a){let c;if(t.side===He?c=n.intersectTriangle(o,s,i,!0,a):c=n.intersectTriangle(i,s,o,t.side===yn,a),c===null)return null;ja.copy(a),ja.applyMatrix4(r.matrixWorld);let l=e.ray.origin.distanceTo(ja);return l<e.near||l>e.far?null:{distance:l,point:ja.clone(),object:r}}function tc(r,t,e,n,i,s,o,a,c,l){r.getVertexPosition(a,Za),r.getVertexPosition(c,Ja),r.getVertexPosition(l,Ka);let f=cy(r,t,e,n,Za,Ja,Ka,Mm);if(f){let h=new R;$e.getBarycoord(Mm,Za,Ja,Ka,h),i&&(f.uv=$e.getInterpolatedAttribute(i,a,c,l,h,new q)),s&&(f.uv1=$e.getInterpolatedAttribute(s,a,c,l,h,new q)),o&&(f.normal=$e.getInterpolatedAttribute(o,a,c,l,h,new R),f.normal.dot(n.direction)>0&&f.normal.multiplyScalar(-1));let u={a,b:c,c:l,normal:new R,materialIndex:0};$e.getNormal(Za,Ja,Ka,u.normal),f.face=u,f.barycoord=h}return f}var Sr=class r extends Ft{constructor(t=1,e=1,n=1,i=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:n,widthSegments:i,heightSegments:s,depthSegments:o};let a=this;i=Math.floor(i),s=Math.floor(s),o=Math.floor(o);let c=[],l=[],f=[],h=[],u=0,d=0;g("z","y","x",-1,-1,n,e,t,o,s,0),g("z","y","x",1,-1,n,e,-t,o,s,1),g("x","z","y",1,1,t,n,e,i,o,2),g("x","z","y",1,-1,t,n,-e,i,o,3),g("x","y","z",1,-1,t,e,n,i,s,4),g("x","y","z",-1,-1,t,e,-n,i,s,5),this.setIndex(c),this.setAttribute("position",new bt(l,3)),this.setAttribute("normal",new bt(f,3)),this.setAttribute("uv",new bt(h,2));function g(x,p,m,v,_,y,b,T,w,E,M){let S=y/w,I=b/E,P=y/2,L=b/2,N=T/2,z=w+1,V=E+1,j=0,W=0,ct=new R;for(let pt=0;pt<V;pt++){let _t=pt*I-L;for(let Ht=0;Ht<z;Ht++){let ee=Ht*S-P;ct[x]=ee*v,ct[p]=_t*_,ct[m]=N,l.push(ct.x,ct.y,ct.z),ct[x]=0,ct[p]=0,ct[m]=T>0?1:-1,f.push(ct.x,ct.y,ct.z),h.push(Ht/w),h.push(1-pt/E),j+=1}}for(let pt=0;pt<E;pt++)for(let _t=0;_t<w;_t++){let Ht=u+_t+z*pt,ee=u+_t+z*(pt+1),he=u+(_t+1)+z*(pt+1),Qt=u+(_t+1)+z*pt;c.push(Ht,ee,Qt),c.push(ee,he,Qt),W+=6}a.addGroup(d,W,M),d+=W,u+=j}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}};function Lr(r){let t={};for(let e in r){t[e]={};for(let n in r[e]){let i=r[e][n];i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)?i.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][n]=null):t[e][n]=i.clone():Array.isArray(i)?t[e][n]=i.slice():t[e][n]=i}}return t}function cn(r){let t={};for(let e=0;e<r.length;e++){let n=Lr(r[e]);for(let i in n)t[i]=n[i]}return t}function ly(r){let t=[];for(let e=0;e<r.length;e++)t.push(r[e].clone());return t}function Zd(r){let t=r.getRenderTarget();return t===null?r.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:ie.workingColorSpace}var c0={clone:Lr,merge:cn},uy=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,hy=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Ue=class extends Je{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=uy,this.fragmentShader=hy,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Lr(t.uniforms),this.uniformsGroups=ly(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this}toJSON(t){let e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(let i in this.uniforms){let o=this.uniforms[i].value;o&&o.isTexture?e.uniforms[i]={type:"t",value:o.toJSON(t).uuid}:o&&o.isColor?e.uniforms[i]={type:"c",value:o.getHex()}:o&&o.isVector2?e.uniforms[i]={type:"v2",value:o.toArray()}:o&&o.isVector3?e.uniforms[i]={type:"v3",value:o.toArray()}:o&&o.isVector4?e.uniforms[i]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?e.uniforms[i]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?e.uniforms[i]={type:"m4",value:o.toArray()}:e.uniforms[i]={value:o}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;let n={};for(let i in this.extensions)this.extensions[i]===!0&&(n[i]=!0);return Object.keys(n).length>0&&(e.extensions=n),e}},Ms=class extends ue{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new gt,this.projectionMatrix=new gt,this.projectionMatrixInverse=new gt,this.coordinateSystem=Rn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(t,e){super.updateWorldMatrix(t,e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},Di=new R,Tm=new q,wm=new q,Re=class extends Ms{constructor(t=50,e=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){let e=.5*this.getFilmHeight()/t;this.fov=br*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){let t=Math.tan(vr*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return br*2*Math.atan(Math.tan(vr*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,n){Di.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(Di.x,Di.y).multiplyScalar(-t/Di.z),Di.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Di.x,Di.y).multiplyScalar(-t/Di.z)}getViewSize(t,e){return this.getViewBounds(t,Tm,wm),e.subVectors(wm,Tm)}setViewOffset(t,e,n,i,s,o){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let t=this.near,e=t*Math.tan(vr*.5*this.fov)/this.zoom,n=2*e,i=this.aspect*n,s=-.5*i,o=this.view;if(this.view!==null&&this.view.enabled){let c=o.fullWidth,l=o.fullHeight;s+=o.offsetX*i/c,e-=o.offsetY*n/l,i*=o.width/c,n*=o.height/l}let a=this.filmOffset;a!==0&&(s+=t*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+i,e,e-n,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){let e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}},ss=-90,os=1,Dc=class extends ue{constructor(t,e,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let i=new Re(ss,os,t,e);i.layers=this.layers,this.add(i);let s=new Re(ss,os,t,e);s.layers=this.layers,this.add(s);let o=new Re(ss,os,t,e);o.layers=this.layers,this.add(o);let a=new Re(ss,os,t,e);a.layers=this.layers,this.add(a);let c=new Re(ss,os,t,e);c.layers=this.layers,this.add(c);let l=new Re(ss,os,t,e);l.layers=this.layers,this.add(l)}updateCoordinateSystem(){let t=this.coordinateSystem,e=this.children.concat(),[n,i,s,o,a,c]=e;for(let l of e)this.remove(l);if(t===Rn)n.up.set(0,1,0),n.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),c.up.set(0,1,0),c.lookAt(0,0,-1);else if(t===vs)n.up.set(0,-1,0),n.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),c.up.set(0,-1,0),c.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(let l of e)this.add(l),l.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:i}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,c,l,f]=this.children,h=t.getRenderTarget(),u=t.getActiveCubeFace(),d=t.getActiveMipmapLevel(),g=t.xr.enabled;t.xr.enabled=!1;let x=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,t.setRenderTarget(n,0,i),t.render(e,s),t.setRenderTarget(n,1,i),t.render(e,o),t.setRenderTarget(n,2,i),t.render(e,a),t.setRenderTarget(n,3,i),t.render(e,c),t.setRenderTarget(n,4,i),t.render(e,l),n.texture.generateMipmaps=x,t.setRenderTarget(n,5,i),t.render(e,f),t.setRenderTarget(h,u,d),t.xr.enabled=g,n.texture.needsPMREMUpdate=!0}},Mr=class extends Oe{constructor(t=[],e=Si,n,i,s,o,a,c,l,f){super(t,e,n,i,s,o,a,c,l,f),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}},Fc=class extends ze{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;let n={width:t,height:t,depth:1},i=[n,n,n,n,n,n];this.texture=new Mr(i),this._setTextureOptions(e),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},i=new Sr(5,5,5),s=new Ue({name:"CubemapFromEquirect",uniforms:Lr(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:He,blending:ke});s.uniforms.tEquirect.value=e;let o=new Me(i,s),a=e.minFilter;return e.minFilter===ai&&(e.minFilter=re),new Dc(1,10,this).update(t,o),e.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(t,e=!0,n=!0,i=!0){let s=t.getRenderTarget();for(let o=0;o<6;o++)t.setRenderTarget(this,o),t.clear(e,n,i);t.setRenderTarget(s)}},Li=class extends ue{constructor(){super(),this.isGroup=!0,this.type="Group"}},fy={type:"move"},Ts=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Li,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Li,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new R,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new R),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Li,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new R,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new R),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){let e=this._hand;if(e)for(let n of t.hand.values())this._getHandJoint(e,n)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,n){let i=null,s=null,o=null,a=this._targetRay,c=this._grip,l=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(l&&t.hand){o=!0;for(let x of t.hand.values()){let p=e.getJointPose(x,n),m=this._getHandJoint(l,x);p!==null&&(m.matrix.fromArray(p.transform.matrix),m.matrix.decompose(m.position,m.rotation,m.scale),m.matrixWorldNeedsUpdate=!0,m.jointRadius=p.radius),m.visible=p!==null}let f=l.joints["index-finger-tip"],h=l.joints["thumb-tip"],u=f.position.distanceTo(h.position),d=.02,g=.005;l.inputState.pinching&&u>d+g?(l.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!l.inputState.pinching&&u<=d-g&&(l.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else c!==null&&t.gripSpace&&(s=e.getPose(t.gripSpace,n),s!==null&&(c.matrix.fromArray(s.transform.matrix),c.matrix.decompose(c.position,c.rotation,c.scale),c.matrixWorldNeedsUpdate=!0,s.linearVelocity?(c.hasLinearVelocity=!0,c.linearVelocity.copy(s.linearVelocity)):c.hasLinearVelocity=!1,s.angularVelocity?(c.hasAngularVelocity=!0,c.angularVelocity.copy(s.angularVelocity)):c.hasAngularVelocity=!1));a!==null&&(i=e.getPose(t.targetRaySpace,n),i===null&&s!==null&&(i=s),i!==null&&(a.matrix.fromArray(i.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,i.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(i.linearVelocity)):a.hasLinearVelocity=!1,i.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(i.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(fy)))}return a!==null&&(a.visible=i!==null),c!==null&&(c.visible=s!==null),l!==null&&(l.visible=o!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){let n=new Li;n.matrixAutoUpdate=!1,n.visible=!1,t.joints[e.jointName]=n,t.add(n)}return t.joints[e.jointName]}},Lc=class r{constructor(t,e=25e-5){this.isFogExp2=!0,this.name="",this.color=new ft(t),this.density=e}clone(){return new r(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}},Nc=class r{constructor(t,e=1,n=1e3){this.isFog=!0,this.name="",this.color=new ft(t),this.near=e,this.far=n}clone(){return new r(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}},ws=class extends ue{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new In,this.environmentIntensity=1,this.environmentRotation=new In,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){let e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}},As=class{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=Io,this.updateRanges=[],this.version=0,this.uuid=Cn()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,n){t*=this.stride,n*=e.stride;for(let i=0,s=this.stride;i<s;i++)this.array[t+i]=e.array[n+i];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Cn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);let e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(e,this.stride);return n.setUsage(this.usage),n}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){return t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Cn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}},un=new R,Tr=class r{constructor(t,e,n,i=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=n,this.normalized=i}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,n=this.data.count;e<n;e++)un.fromBufferAttribute(this,e),un.applyMatrix4(t),this.setXYZ(e,un.x,un.y,un.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)un.fromBufferAttribute(this,e),un.applyNormalMatrix(t),this.setXYZ(e,un.x,un.y,un.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)un.fromBufferAttribute(this,e),un.transformDirection(t),this.setXYZ(e,un.x,un.y,un.z);return this}getComponent(t,e){let n=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(n=hn(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=Zt(n,this.array)),this.data.array[t*this.data.stride+this.offset+e]=n,this}setX(t,e){return this.normalized&&(e=Zt(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=Zt(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=Zt(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=Zt(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=hn(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=hn(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=hn(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=hn(e,this.array)),e}setXY(t,e,n){return t=t*this.data.stride+this.offset,this.normalized&&(e=Zt(e,this.array),n=Zt(n,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this}setXYZ(t,e,n,i){return t=t*this.data.stride+this.offset,this.normalized&&(e=Zt(e,this.array),n=Zt(n,this.array),i=Zt(i,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=i,this}setXYZW(t,e,n,i,s){return t=t*this.data.stride+this.offset,this.normalized&&(e=Zt(e,this.array),n=Zt(n,this.array),i=Zt(i,this.array),s=Zt(s,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=i,this.data.array[t+3]=s,this}clone(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");let e=[];for(let n=0;n<this.count;n++){let i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)e.push(this.data.array[i+s])}return new Ot(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new r(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");let e=[];for(let n=0;n<this.count;n++){let i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)e.push(this.data.array[i+s])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}},No=class extends Je{constructor(t){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new ft(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}},as,fo=new R,cs=new R,ls=new R,us=new q,po=new q,l0=new gt,ec=new R,mo=new R,nc=new R,Am=new q,nf=new q,Em=new q,Uc=class extends ue{constructor(t=new No){if(super(),this.isSprite=!0,this.type="Sprite",as===void 0){as=new Ft;let e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new As(e,5);as.setIndex([0,1,2,0,2,3]),as.setAttribute("position",new Tr(n,3,0,!1)),as.setAttribute("uv",new Tr(n,2,3,!1))}this.geometry=as,this.material=t,this.center=new q(.5,.5),this.count=1}raycast(t,e){t.camera===null&&console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),cs.setFromMatrixScale(this.matrixWorld),l0.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),ls.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&cs.multiplyScalar(-ls.z);let n=this.material.rotation,i,s;n!==0&&(s=Math.cos(n),i=Math.sin(n));let o=this.center;ic(ec.set(-.5,-.5,0),ls,o,cs,i,s),ic(mo.set(.5,-.5,0),ls,o,cs,i,s),ic(nc.set(.5,.5,0),ls,o,cs,i,s),Am.set(0,0),nf.set(1,0),Em.set(1,1);let a=t.ray.intersectTriangle(ec,mo,nc,!1,fo);if(a===null&&(ic(mo.set(-.5,.5,0),ls,o,cs,i,s),nf.set(0,1),a=t.ray.intersectTriangle(ec,nc,mo,!1,fo),a===null))return;let c=t.ray.origin.distanceTo(fo);c<t.near||c>t.far||e.push({distance:c,point:fo.clone(),uv:$e.getInterpolation(fo,ec,mo,nc,Am,nf,Em,new q),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}};function ic(r,t,e,n,i,s){us.subVectors(r,e).addScalar(.5).multiply(n),i!==void 0?(po.x=s*us.x-i*us.y,po.y=i*us.x+s*us.y):po.copy(us),r.copy(t),r.x+=po.x,r.y+=po.y,r.applyMatrix4(l0)}var rc=new R,Rm=new R,Bc=class extends ue{constructor(){super(),this.isLOD=!0,this._currentLevel=0,this.type="LOD",Object.defineProperties(this,{levels:{enumerable:!0,value:[]}}),this.autoUpdate=!0}copy(t){super.copy(t,!1);let e=t.levels;for(let n=0,i=e.length;n<i;n++){let s=e[n];this.addLevel(s.object.clone(),s.distance,s.hysteresis)}return this.autoUpdate=t.autoUpdate,this}addLevel(t,e=0,n=0){e=Math.abs(e);let i=this.levels,s;for(s=0;s<i.length&&!(e<i[s].distance);s++);return i.splice(s,0,{distance:e,hysteresis:n,object:t}),this.add(t),this}removeLevel(t){let e=this.levels;for(let n=0;n<e.length;n++)if(e[n].distance===t){let i=e.splice(n,1);return this.remove(i[0].object),!0}return!1}getCurrentLevel(){return this._currentLevel}getObjectForDistance(t){let e=this.levels;if(e.length>0){let n,i;for(n=1,i=e.length;n<i;n++){let s=e[n].distance;if(e[n].object.visible&&(s-=s*e[n].hysteresis),t<s)break}return e[n-1].object}return null}raycast(t,e){if(this.levels.length>0){rc.setFromMatrixPosition(this.matrixWorld);let i=t.ray.origin.distanceTo(rc);this.getObjectForDistance(i).raycast(t,e)}}update(t){let e=this.levels;if(e.length>1){rc.setFromMatrixPosition(t.matrixWorld),Rm.setFromMatrixPosition(this.matrixWorld);let n=rc.distanceTo(Rm)/t.zoom;e[0].object.visible=!0;let i,s;for(i=1,s=e.length;i<s;i++){let o=e[i].distance;if(e[i].object.visible&&(o-=o*e[i].hysteresis),n>=o)e[i-1].object.visible=!1,e[i].object.visible=!0;else break}for(this._currentLevel=i-1;i<s;i++)e[i].object.visible=!1}}toJSON(t){let e=super.toJSON(t);this.autoUpdate===!1&&(e.object.autoUpdate=!1),e.object.levels=[];let n=this.levels;for(let i=0,s=n.length;i<s;i++){let o=n[i];e.object.levels.push({object:o.object.uuid,distance:o.distance,hysteresis:o.hysteresis})}return e}},Cm=new R,Im=new Kt,Pm=new Kt,dy=new R,Dm=new gt,sc=new R,rf=new Ve,Fm=new gt,sf=new ii,Oc=class extends Me{constructor(t,e){super(t,e),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=bf,this.bindMatrix=new gt,this.bindMatrixInverse=new gt,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){let t=this.geometry;this.boundingBox===null&&(this.boundingBox=new se),this.boundingBox.makeEmpty();let e=t.getAttribute("position");for(let n=0;n<e.count;n++)this.getVertexPosition(n,sc),this.boundingBox.expandByPoint(sc)}computeBoundingSphere(){let t=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new Ve),this.boundingSphere.makeEmpty();let e=t.getAttribute("position");for(let n=0;n<e.count;n++)this.getVertexPosition(n,sc),this.boundingSphere.expandByPoint(sc)}copy(t,e){return super.copy(t,e),this.bindMode=t.bindMode,this.bindMatrix.copy(t.bindMatrix),this.bindMatrixInverse.copy(t.bindMatrixInverse),this.skeleton=t.skeleton,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}raycast(t,e){let n=this.material,i=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),rf.copy(this.boundingSphere),rf.applyMatrix4(i),t.ray.intersectsSphere(rf)!==!1&&(Fm.copy(i).invert(),sf.copy(t.ray).applyMatrix4(Fm),!(this.boundingBox!==null&&sf.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(t,e,sf)))}getVertexPosition(t,e){return super.getVertexPosition(t,e),this.applyBoneTransform(t,e),e}bind(t,e){this.skeleton=t,e===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),e=this.matrixWorld),this.bindMatrix.copy(e),this.bindMatrixInverse.copy(e).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){let t=new Kt,e=this.geometry.attributes.skinWeight;for(let n=0,i=e.count;n<i;n++){t.fromBufferAttribute(e,n);let s=1/t.manhattanLength();s!==1/0?t.multiplyScalar(s):t.set(1,0,0,0),e.setXYZW(n,t.x,t.y,t.z,t.w)}}updateMatrixWorld(t){super.updateMatrixWorld(t),this.bindMode===bf?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===Xg?this.bindMatrixInverse.copy(this.bindMatrix).invert():console.warn("THREE.SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(t,e){let n=this.skeleton,i=this.geometry;Im.fromBufferAttribute(i.attributes.skinIndex,t),Pm.fromBufferAttribute(i.attributes.skinWeight,t),Cm.copy(e).applyMatrix4(this.bindMatrix),e.set(0,0,0);for(let s=0;s<4;s++){let o=Pm.getComponent(s);if(o!==0){let a=Im.getComponent(s);Dm.multiplyMatrices(n.bones[a].matrixWorld,n.boneInverses[a]),e.addScaledVector(dy.copy(Cm).applyMatrix4(Dm),o)}}return e.applyMatrix4(this.bindMatrixInverse)}},Uo=class extends ue{constructor(){super(),this.isBone=!0,this.type="Bone"}},oe=class extends Oe{constructor(t=null,e=1,n=1,i,s,o,a,c,l=Vt,f=Vt,h,u){super(null,o,a,c,l,f,i,s,h,u),this.isDataTexture=!0,this.image={data:t,width:e,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Lm=new gt,py=new gt,zc=class r{constructor(t=[],e=[]){this.uuid=Cn(),this.bones=t.slice(0),this.boneInverses=e,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){let t=this.bones,e=this.boneInverses;if(this.boneMatrices=new Float32Array(t.length*16),e.length===0)this.calculateInverses();else if(t.length!==e.length){console.warn("THREE.Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,i=this.bones.length;n<i;n++)this.boneInverses.push(new gt)}}calculateInverses(){this.boneInverses.length=0;for(let t=0,e=this.bones.length;t<e;t++){let n=new gt;this.bones[t]&&n.copy(this.bones[t].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let t=0,e=this.bones.length;t<e;t++){let n=this.bones[t];n&&n.matrixWorld.copy(this.boneInverses[t]).invert()}for(let t=0,e=this.bones.length;t<e;t++){let n=this.bones[t];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){let t=this.bones,e=this.boneInverses,n=this.boneMatrices,i=this.boneTexture;for(let s=0,o=t.length;s<o;s++){let a=t[s]?t[s].matrixWorld:py;Lm.multiplyMatrices(a,e[s]),Lm.toArray(n,s*16)}i!==null&&(i.needsUpdate=!0)}clone(){return new r(this.bones,this.boneInverses)}computeBoneTexture(){let t=Math.sqrt(this.bones.length*4);t=Math.ceil(t/4)*4,t=Math.max(t,4);let e=new Float32Array(t*t*4);e.set(this.boneMatrices);let n=new oe(e,t,t,Gt,$t);return n.needsUpdate=!0,this.boneMatrices=e,this.boneTexture=n,this}getBoneByName(t){for(let e=0,n=this.bones.length;e<n;e++){let i=this.bones[e];if(i.name===t)return i}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(t,e){this.uuid=t.uuid;for(let n=0,i=t.bones.length;n<i;n++){let s=t.bones[n],o=e[s];o===void 0&&(console.warn("THREE.Skeleton: No bone found with UUID:",s),o=new Uo),this.bones.push(o),this.boneInverses.push(new gt().fromArray(t.boneInverses[n]))}return this.init(),this}toJSON(){let t={metadata:{version:4.7,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};t.uuid=this.uuid;let e=this.bones,n=this.boneInverses;for(let i=0,s=e.length;i<s;i++){let o=e[i];t.bones.push(o.uuid);let a=n[i];t.boneInverses.push(a.toArray())}return t}},Bi=class extends Ot{constructor(t,e,n,i=1){super(t,e,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=i}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){let t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}},hs=new gt,Nm=new gt,oc=[],Um=new se,my=new gt,go=new Me,xo=new Ve,kc=class extends Me{constructor(t,e,n){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new Bi(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let i=0;i<n;i++)this.setMatrixAt(i,my)}computeBoundingBox(){let t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new se),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,hs),Um.copy(t.boundingBox).applyMatrix4(hs),this.boundingBox.union(Um)}computeBoundingSphere(){let t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new Ve),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,hs),xo.copy(t.boundingSphere).applyMatrix4(hs),this.boundingSphere.union(xo)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){let n=e.morphTargetInfluences,i=this.morphTexture.source.data.data,s=n.length+1,o=t*s+1;for(let a=0;a<n.length;a++)n[a]=i[o+a]}raycast(t,e){let n=this.matrixWorld,i=this.count;if(go.geometry=this.geometry,go.material=this.material,go.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),xo.copy(this.boundingSphere),xo.applyMatrix4(n),t.ray.intersectsSphere(xo)!==!1))for(let s=0;s<i;s++){this.getMatrixAt(s,hs),Nm.multiplyMatrices(n,hs),go.matrixWorld=Nm,go.raycast(t,oc);for(let o=0,a=oc.length;o<a;o++){let c=oc[o];c.instanceId=s,c.object=this,e.push(c)}oc.length=0}}setColorAt(t,e){this.instanceColor===null&&(this.instanceColor=new Bi(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3)}setMatrixAt(t,e){e.toArray(this.instanceMatrix.array,t*16)}setMorphAt(t,e){let n=e.morphTargetInfluences,i=n.length+1;this.morphTexture===null&&(this.morphTexture=new oe(new Float32Array(i*this.count),i,this.count,Jn,$t));let s=this.morphTexture.source.data.data,o=0;for(let l=0;l<n.length;l++)o+=n[l];let a=this.geometry.morphTargetsRelative?1:1-o,c=i*t;s[c]=a,s.set(n,c+1)}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},of=new R,gy=new R,xy=new Xt,_n=class{constructor(t=new R(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,n,i){return this.normal.set(t,e,n),this.constant=i,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,n){let i=of.subVectors(n,e).cross(gy.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(i,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){let t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e){let n=t.delta(of),i=this.normal.dot(n);if(i===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;let s=-(t.start.dot(this.normal)+this.constant)/i;return s<0||s>1?null:e.copy(t.start).addScaledVector(n,s)}intersectsLine(t){let e=this.distanceToPoint(t.start),n=this.distanceToPoint(t.end);return e<0&&n>0||n<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){let n=e||xy.getNormalMatrix(t),i=this.coplanarPoint(of).applyMatrix4(t),s=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(s),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}},sr=new Ve,vy=new q(.5,.5),ac=new R,Oi=class{constructor(t=new _n,e=new _n,n=new _n,i=new _n,s=new _n,o=new _n){this.planes=[t,e,n,i,s,o]}set(t,e,n,i,s,o){let a=this.planes;return a[0].copy(t),a[1].copy(e),a[2].copy(n),a[3].copy(i),a[4].copy(s),a[5].copy(o),this}copy(t){let e=this.planes;for(let n=0;n<6;n++)e[n].copy(t.planes[n]);return this}setFromProjectionMatrix(t,e=Rn,n=!1){let i=this.planes,s=t.elements,o=s[0],a=s[1],c=s[2],l=s[3],f=s[4],h=s[5],u=s[6],d=s[7],g=s[8],x=s[9],p=s[10],m=s[11],v=s[12],_=s[13],y=s[14],b=s[15];if(i[0].setComponents(l-o,d-f,m-g,b-v).normalize(),i[1].setComponents(l+o,d+f,m+g,b+v).normalize(),i[2].setComponents(l+a,d+h,m+x,b+_).normalize(),i[3].setComponents(l-a,d-h,m-x,b-_).normalize(),n)i[4].setComponents(c,u,p,y).normalize(),i[5].setComponents(l-c,d-u,m-p,b-y).normalize();else if(i[4].setComponents(l-c,d-u,m-p,b-y).normalize(),e===Rn)i[5].setComponents(l+c,d+u,m+p,b+y).normalize();else if(e===vs)i[5].setComponents(c,u,p,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),sr.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{let e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),sr.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(sr)}intersectsSprite(t){sr.center.set(0,0,0);let e=vy.distanceTo(t.center);return sr.radius=.7071067811865476+e,sr.applyMatrix4(t.matrixWorld),this.intersectsSphere(sr)}intersectsSphere(t){let e=this.planes,n=t.center,i=-t.radius;for(let s=0;s<6;s++)if(e[s].distanceToPoint(n)<i)return!1;return!0}intersectsBox(t){let e=this.planes;for(let n=0;n<6;n++){let i=e[n];if(ac.x=i.normal.x>0?t.max.x:t.min.x,ac.y=i.normal.y>0?t.max.y:t.min.y,ac.z=i.normal.z>0?t.max.z:t.min.z,i.distanceToPoint(ac)<0)return!1}return!0}containsPoint(t){let e=this.planes;for(let n=0;n<6;n++)if(e[n].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},ti=new gt,ei=new Oi,Vc=class r{constructor(){this.coordinateSystem=Rn}intersectsObject(t,e){if(!e.isArrayCamera||e.cameras.length===0)return!1;for(let n=0;n<e.cameras.length;n++){let i=e.cameras[n];if(ti.multiplyMatrices(i.projectionMatrix,i.matrixWorldInverse),ei.setFromProjectionMatrix(ti,i.coordinateSystem,i.reversedDepth),ei.intersectsObject(t))return!0}return!1}intersectsSprite(t,e){if(!e||!e.cameras||e.cameras.length===0)return!1;for(let n=0;n<e.cameras.length;n++){let i=e.cameras[n];if(ti.multiplyMatrices(i.projectionMatrix,i.matrixWorldInverse),ei.setFromProjectionMatrix(ti,i.coordinateSystem,i.reversedDepth),ei.intersectsSprite(t))return!0}return!1}intersectsSphere(t,e){if(!e||!e.cameras||e.cameras.length===0)return!1;for(let n=0;n<e.cameras.length;n++){let i=e.cameras[n];if(ti.multiplyMatrices(i.projectionMatrix,i.matrixWorldInverse),ei.setFromProjectionMatrix(ti,i.coordinateSystem,i.reversedDepth),ei.intersectsSphere(t))return!0}return!1}intersectsBox(t,e){if(!e||!e.cameras||e.cameras.length===0)return!1;for(let n=0;n<e.cameras.length;n++){let i=e.cameras[n];if(ti.multiplyMatrices(i.projectionMatrix,i.matrixWorldInverse),ei.setFromProjectionMatrix(ti,i.coordinateSystem,i.reversedDepth),ei.intersectsBox(t))return!0}return!1}containsPoint(t,e){if(!e||!e.cameras||e.cameras.length===0)return!1;for(let n=0;n<e.cameras.length;n++){let i=e.cameras[n];if(ti.multiplyMatrices(i.projectionMatrix,i.matrixWorldInverse),ei.setFromProjectionMatrix(ti,i.coordinateSystem,i.reversedDepth),ei.containsPoint(t))return!0}return!1}clone(){return new r}};function af(r,t){return r-t}function _y(r,t){return r.z-t.z}function yy(r,t){return t.z-r.z}var If=class{constructor(){this.index=0,this.pool=[],this.list=[]}push(t,e,n,i){let s=this.pool,o=this.list;this.index>=s.length&&s.push({start:-1,count:-1,z:-1,index:-1});let a=s[this.index];o.push(a),this.index++,a.start=t,a.count=e,a.z=n,a.index=i}reset(){this.list.length=0,this.index=0}},gn=new gt,by=new ft(1,1,1),Bm=new Oi,Sy=new Vc,cc=new se,or=new Ve,vo=new R,Om=new R,My=new R,cf=new If,rn=new Me,lc=[];function Ty(r,t,e=0){let n=t.itemSize;if(r.isInterleavedBufferAttribute||r.array.constructor!==t.array.constructor){let i=r.count;for(let s=0;s<i;s++)for(let o=0;o<n;o++)t.setComponent(s+e,o,r.getComponent(s,o))}else t.array.set(r.array,e*n);t.needsUpdate=!0}function ar(r,t){if(r.constructor!==t.constructor){let e=Math.min(r.length,t.length);for(let n=0;n<e;n++)t[n]=r[n]}else{let e=Math.min(r.length,t.length);t.set(new r.constructor(r.buffer,0,e))}}var Hc=class extends Me{constructor(t,e,n=e*2,i){super(new Ft,i),this.isBatchedMesh=!0,this.perObjectFrustumCulled=!0,this.sortObjects=!0,this.boundingBox=null,this.boundingSphere=null,this.customSort=null,this._instanceInfo=[],this._geometryInfo=[],this._availableInstanceIds=[],this._availableGeometryIds=[],this._nextIndexStart=0,this._nextVertexStart=0,this._geometryCount=0,this._visibilityChanged=!0,this._geometryInitialized=!1,this._maxInstanceCount=t,this._maxVertexCount=e,this._maxIndexCount=n,this._multiDrawCounts=new Int32Array(t),this._multiDrawStarts=new Int32Array(t),this._multiDrawCount=0,this._multiDrawInstances=null,this._matricesTexture=null,this._indirectTexture=null,this._colorsTexture=null,this._initMatricesTexture(),this._initIndirectTexture()}get maxInstanceCount(){return this._maxInstanceCount}get instanceCount(){return this._instanceInfo.length-this._availableInstanceIds.length}get unusedVertexCount(){return this._maxVertexCount-this._nextVertexStart}get unusedIndexCount(){return this._maxIndexCount-this._nextIndexStart}_initMatricesTexture(){let t=Math.sqrt(this._maxInstanceCount*4);t=Math.ceil(t/4)*4,t=Math.max(t,4);let e=new Float32Array(t*t*4),n=new oe(e,t,t,Gt,$t);this._matricesTexture=n}_initIndirectTexture(){let t=Math.sqrt(this._maxInstanceCount);t=Math.ceil(t);let e=new Uint32Array(t*t),n=new oe(e,t,t,Dr,an);this._indirectTexture=n}_initColorsTexture(){let t=Math.sqrt(this._maxInstanceCount);t=Math.ceil(t);let e=new Float32Array(t*t*4).fill(1),n=new oe(e,t,t,Gt,$t);n.colorSpace=ie.workingColorSpace,this._colorsTexture=n}_initializeGeometry(t){let e=this.geometry,n=this._maxVertexCount,i=this._maxIndexCount;if(this._geometryInitialized===!1){for(let s in t.attributes){let o=t.getAttribute(s),{array:a,itemSize:c,normalized:l}=o,f=new a.constructor(n*c),h=new Ot(f,c,l);e.setAttribute(s,h)}if(t.getIndex()!==null){let s=n>65535?new Uint32Array(i):new Uint16Array(i);e.setIndex(new Ot(s,1))}this._geometryInitialized=!0}}_validateGeometry(t){let e=this.geometry;if(!!t.getIndex()!=!!e.getIndex())throw new Error('THREE.BatchedMesh: All geometries must consistently have "index".');for(let n in e.attributes){if(!t.hasAttribute(n))throw new Error(`THREE.BatchedMesh: Added geometry missing "${n}". All geometries must have consistent attributes.`);let i=t.getAttribute(n),s=e.getAttribute(n);if(i.itemSize!==s.itemSize||i.normalized!==s.normalized)throw new Error("THREE.BatchedMesh: All attributes must have a consistent itemSize and normalized value.")}}validateInstanceId(t){let e=this._instanceInfo;if(t<0||t>=e.length||e[t].active===!1)throw new Error(`THREE.BatchedMesh: Invalid instanceId ${t}. Instance is either out of range or has been deleted.`)}validateGeometryId(t){let e=this._geometryInfo;if(t<0||t>=e.length||e[t].active===!1)throw new Error(`THREE.BatchedMesh: Invalid geometryId ${t}. Geometry is either out of range or has been deleted.`)}setCustomSort(t){return this.customSort=t,this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new se);let t=this.boundingBox,e=this._instanceInfo;t.makeEmpty();for(let n=0,i=e.length;n<i;n++){if(e[n].active===!1)continue;let s=e[n].geometryIndex;this.getMatrixAt(n,gn),this.getBoundingBoxAt(s,cc).applyMatrix4(gn),t.union(cc)}}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Ve);let t=this.boundingSphere,e=this._instanceInfo;t.makeEmpty();for(let n=0,i=e.length;n<i;n++){if(e[n].active===!1)continue;let s=e[n].geometryIndex;this.getMatrixAt(n,gn),this.getBoundingSphereAt(s,or).applyMatrix4(gn),t.union(or)}}addInstance(t){if(this._instanceInfo.length>=this.maxInstanceCount&&this._availableInstanceIds.length===0)throw new Error("THREE.BatchedMesh: Maximum item count reached.");let n={visible:!0,active:!0,geometryIndex:t},i=null;this._availableInstanceIds.length>0?(this._availableInstanceIds.sort(af),i=this._availableInstanceIds.shift(),this._instanceInfo[i]=n):(i=this._instanceInfo.length,this._instanceInfo.push(n));let s=this._matricesTexture;gn.identity().toArray(s.image.data,i*16),s.needsUpdate=!0;let o=this._colorsTexture;return o&&(by.toArray(o.image.data,i*4),o.needsUpdate=!0),this._visibilityChanged=!0,i}addGeometry(t,e=-1,n=-1){this._initializeGeometry(t),this._validateGeometry(t);let i={vertexStart:-1,vertexCount:-1,reservedVertexCount:-1,indexStart:-1,indexCount:-1,reservedIndexCount:-1,start:-1,count:-1,boundingBox:null,boundingSphere:null,active:!0},s=this._geometryInfo;i.vertexStart=this._nextVertexStart,i.reservedVertexCount=e===-1?t.getAttribute("position").count:e;let o=t.getIndex();if(o!==null&&(i.indexStart=this._nextIndexStart,i.reservedIndexCount=n===-1?o.count:n),i.indexStart!==-1&&i.indexStart+i.reservedIndexCount>this._maxIndexCount||i.vertexStart+i.reservedVertexCount>this._maxVertexCount)throw new Error("THREE.BatchedMesh: Reserved space request exceeds the maximum buffer size.");let c;return this._availableGeometryIds.length>0?(this._availableGeometryIds.sort(af),c=this._availableGeometryIds.shift(),s[c]=i):(c=this._geometryCount,this._geometryCount++,s.push(i)),this.setGeometryAt(c,t),this._nextIndexStart=i.indexStart+i.reservedIndexCount,this._nextVertexStart=i.vertexStart+i.reservedVertexCount,c}setGeometryAt(t,e){if(t>=this._geometryCount)throw new Error("THREE.BatchedMesh: Maximum geometry count reached.");this._validateGeometry(e);let n=this.geometry,i=n.getIndex()!==null,s=n.getIndex(),o=e.getIndex(),a=this._geometryInfo[t];if(i&&o.count>a.reservedIndexCount||e.attributes.position.count>a.reservedVertexCount)throw new Error("THREE.BatchedMesh: Reserved space not large enough for provided geometry.");let c=a.vertexStart,l=a.reservedVertexCount;a.vertexCount=e.getAttribute("position").count;for(let f in n.attributes){let h=e.getAttribute(f),u=n.getAttribute(f);Ty(h,u,c);let d=h.itemSize;for(let g=h.count,x=l;g<x;g++){let p=c+g;for(let m=0;m<d;m++)u.setComponent(p,m,0)}u.needsUpdate=!0,u.addUpdateRange(c*d,l*d)}if(i){let f=a.indexStart,h=a.reservedIndexCount;a.indexCount=e.getIndex().count;for(let u=0;u<o.count;u++)s.setX(f+u,c+o.getX(u));for(let u=o.count,d=h;u<d;u++)s.setX(f+u,c);s.needsUpdate=!0,s.addUpdateRange(f,a.reservedIndexCount)}return a.start=i?a.indexStart:a.vertexStart,a.count=i?a.indexCount:a.vertexCount,a.boundingBox=null,e.boundingBox!==null&&(a.boundingBox=e.boundingBox.clone()),a.boundingSphere=null,e.boundingSphere!==null&&(a.boundingSphere=e.boundingSphere.clone()),this._visibilityChanged=!0,t}deleteGeometry(t){let e=this._geometryInfo;if(t>=e.length||e[t].active===!1)return this;let n=this._instanceInfo;for(let i=0,s=n.length;i<s;i++)n[i].active&&n[i].geometryIndex===t&&this.deleteInstance(i);return e[t].active=!1,this._availableGeometryIds.push(t),this._visibilityChanged=!0,this}deleteInstance(t){return this.validateInstanceId(t),this._instanceInfo[t].active=!1,this._availableInstanceIds.push(t),this._visibilityChanged=!0,this}optimize(){let t=0,e=0,n=this._geometryInfo,i=n.map((o,a)=>a).sort((o,a)=>n[o].vertexStart-n[a].vertexStart),s=this.geometry;for(let o=0,a=n.length;o<a;o++){let c=i[o],l=n[c];if(l.active!==!1){if(s.index!==null){if(l.indexStart!==e){let{indexStart:f,vertexStart:h,reservedIndexCount:u}=l,d=s.index,g=d.array,x=t-h;for(let p=f;p<f+u;p++)g[p]=g[p]+x;d.array.copyWithin(e,f,f+u),d.addUpdateRange(e,u),l.indexStart=e}e+=l.reservedIndexCount}if(l.vertexStart!==t){let{vertexStart:f,reservedVertexCount:h}=l,u=s.attributes;for(let d in u){let g=u[d],{array:x,itemSize:p}=g;x.copyWithin(t*p,f*p,(f+h)*p),g.addUpdateRange(t*p,h*p)}l.vertexStart=t}t+=l.reservedVertexCount,l.start=s.index?l.indexStart:l.vertexStart,this._nextIndexStart=s.index?l.indexStart+l.reservedIndexCount:0,this._nextVertexStart=l.vertexStart+l.reservedVertexCount}}return this}getBoundingBoxAt(t,e){if(t>=this._geometryCount)return null;let n=this.geometry,i=this._geometryInfo[t];if(i.boundingBox===null){let s=new se,o=n.index,a=n.attributes.position;for(let c=i.start,l=i.start+i.count;c<l;c++){let f=c;o&&(f=o.getX(f)),s.expandByPoint(vo.fromBufferAttribute(a,f))}i.boundingBox=s}return e.copy(i.boundingBox),e}getBoundingSphereAt(t,e){if(t>=this._geometryCount)return null;let n=this.geometry,i=this._geometryInfo[t];if(i.boundingSphere===null){let s=new Ve;this.getBoundingBoxAt(t,cc),cc.getCenter(s.center);let o=n.index,a=n.attributes.position,c=0;for(let l=i.start,f=i.start+i.count;l<f;l++){let h=l;o&&(h=o.getX(h)),vo.fromBufferAttribute(a,h),c=Math.max(c,s.center.distanceToSquared(vo))}s.radius=Math.sqrt(c),i.boundingSphere=s}return e.copy(i.boundingSphere),e}setMatrixAt(t,e){this.validateInstanceId(t);let n=this._matricesTexture,i=this._matricesTexture.image.data;return e.toArray(i,t*16),n.needsUpdate=!0,this}getMatrixAt(t,e){return this.validateInstanceId(t),e.fromArray(this._matricesTexture.image.data,t*16)}setColorAt(t,e){return this.validateInstanceId(t),this._colorsTexture===null&&this._initColorsTexture(),e.toArray(this._colorsTexture.image.data,t*4),this._colorsTexture.needsUpdate=!0,this}getColorAt(t,e){return this.validateInstanceId(t),e.fromArray(this._colorsTexture.image.data,t*4)}setVisibleAt(t,e){return this.validateInstanceId(t),this._instanceInfo[t].visible===e?this:(this._instanceInfo[t].visible=e,this._visibilityChanged=!0,this)}getVisibleAt(t){return this.validateInstanceId(t),this._instanceInfo[t].visible}setGeometryIdAt(t,e){return this.validateInstanceId(t),this.validateGeometryId(e),this._instanceInfo[t].geometryIndex=e,this}getGeometryIdAt(t){return this.validateInstanceId(t),this._instanceInfo[t].geometryIndex}getGeometryRangeAt(t,e={}){this.validateGeometryId(t);let n=this._geometryInfo[t];return e.vertexStart=n.vertexStart,e.vertexCount=n.vertexCount,e.reservedVertexCount=n.reservedVertexCount,e.indexStart=n.indexStart,e.indexCount=n.indexCount,e.reservedIndexCount=n.reservedIndexCount,e.start=n.start,e.count=n.count,e}setInstanceCount(t){let e=this._availableInstanceIds,n=this._instanceInfo;for(e.sort(af);e[e.length-1]===n.length-1;)n.pop(),e.pop();if(t<n.length)throw new Error(`BatchedMesh: Instance ids outside the range ${t} are being used. Cannot shrink instance count.`);let i=new Int32Array(t),s=new Int32Array(t);ar(this._multiDrawCounts,i),ar(this._multiDrawStarts,s),this._multiDrawCounts=i,this._multiDrawStarts=s,this._maxInstanceCount=t;let o=this._indirectTexture,a=this._matricesTexture,c=this._colorsTexture;o.dispose(),this._initIndirectTexture(),ar(o.image.data,this._indirectTexture.image.data),a.dispose(),this._initMatricesTexture(),ar(a.image.data,this._matricesTexture.image.data),c&&(c.dispose(),this._initColorsTexture(),ar(c.image.data,this._colorsTexture.image.data))}setGeometrySize(t,e){let n=[...this._geometryInfo].filter(a=>a.active);if(Math.max(...n.map(a=>a.vertexStart+a.reservedVertexCount))>t)throw new Error(`BatchedMesh: Geometry vertex values are being used outside the range ${e}. Cannot shrink further.`);if(this.geometry.index&&Math.max(...n.map(c=>c.indexStart+c.reservedIndexCount))>e)throw new Error(`BatchedMesh: Geometry index values are being used outside the range ${e}. Cannot shrink further.`);let s=this.geometry;s.dispose(),this._maxVertexCount=t,this._maxIndexCount=e,this._geometryInitialized&&(this._geometryInitialized=!1,this.geometry=new Ft,this._initializeGeometry(s));let o=this.geometry;s.index&&ar(s.index.array,o.index.array);for(let a in s.attributes)ar(s.attributes[a].array,o.attributes[a].array)}raycast(t,e){let n=this._instanceInfo,i=this._geometryInfo,s=this.matrixWorld,o=this.geometry;rn.material=this.material,rn.geometry.index=o.index,rn.geometry.attributes=o.attributes,rn.geometry.boundingBox===null&&(rn.geometry.boundingBox=new se),rn.geometry.boundingSphere===null&&(rn.geometry.boundingSphere=new Ve);for(let a=0,c=n.length;a<c;a++){if(!n[a].visible||!n[a].active)continue;let l=n[a].geometryIndex,f=i[l];rn.geometry.setDrawRange(f.start,f.count),this.getMatrixAt(a,rn.matrixWorld).premultiply(s),this.getBoundingBoxAt(l,rn.geometry.boundingBox),this.getBoundingSphereAt(l,rn.geometry.boundingSphere),rn.raycast(t,lc);for(let h=0,u=lc.length;h<u;h++){let d=lc[h];d.object=this,d.batchId=a,e.push(d)}lc.length=0}rn.material=null,rn.geometry.index=null,rn.geometry.attributes={},rn.geometry.setDrawRange(0,1/0)}copy(t){return super.copy(t),this.geometry=t.geometry.clone(),this.perObjectFrustumCulled=t.perObjectFrustumCulled,this.sortObjects=t.sortObjects,this.boundingBox=t.boundingBox!==null?t.boundingBox.clone():null,this.boundingSphere=t.boundingSphere!==null?t.boundingSphere.clone():null,this._geometryInfo=t._geometryInfo.map(e=>({...e,boundingBox:e.boundingBox!==null?e.boundingBox.clone():null,boundingSphere:e.boundingSphere!==null?e.boundingSphere.clone():null})),this._instanceInfo=t._instanceInfo.map(e=>({...e})),this._availableInstanceIds=t._availableInstanceIds.slice(),this._availableGeometryIds=t._availableGeometryIds.slice(),this._nextIndexStart=t._nextIndexStart,this._nextVertexStart=t._nextVertexStart,this._geometryCount=t._geometryCount,this._maxInstanceCount=t._maxInstanceCount,this._maxVertexCount=t._maxVertexCount,this._maxIndexCount=t._maxIndexCount,this._geometryInitialized=t._geometryInitialized,this._multiDrawCounts=t._multiDrawCounts.slice(),this._multiDrawStarts=t._multiDrawStarts.slice(),this._indirectTexture=t._indirectTexture.clone(),this._indirectTexture.image.data=this._indirectTexture.image.data.slice(),this._matricesTexture=t._matricesTexture.clone(),this._matricesTexture.image.data=this._matricesTexture.image.data.slice(),this._colorsTexture!==null&&(this._colorsTexture=t._colorsTexture.clone(),this._colorsTexture.image.data=this._colorsTexture.image.data.slice()),this}dispose(){this.geometry.dispose(),this._matricesTexture.dispose(),this._matricesTexture=null,this._indirectTexture.dispose(),this._indirectTexture=null,this._colorsTexture!==null&&(this._colorsTexture.dispose(),this._colorsTexture=null)}onBeforeRender(t,e,n,i,s){if(!this._visibilityChanged&&!this.perObjectFrustumCulled&&!this.sortObjects)return;let o=i.getIndex(),a=o===null?1:o.array.BYTES_PER_ELEMENT,c=this._instanceInfo,l=this._multiDrawStarts,f=this._multiDrawCounts,h=this._geometryInfo,u=this.perObjectFrustumCulled,d=this._indirectTexture,g=d.image.data,x=n.isArrayCamera?Sy:Bm;u&&!n.isArrayCamera&&(gn.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse).multiply(this.matrixWorld),Bm.setFromProjectionMatrix(gn,n.coordinateSystem,n.reversedDepth));let p=0;if(this.sortObjects){gn.copy(this.matrixWorld).invert(),vo.setFromMatrixPosition(n.matrixWorld).applyMatrix4(gn),Om.set(0,0,-1).transformDirection(n.matrixWorld).transformDirection(gn);for(let _=0,y=c.length;_<y;_++)if(c[_].visible&&c[_].active){let b=c[_].geometryIndex;this.getMatrixAt(_,gn),this.getBoundingSphereAt(b,or).applyMatrix4(gn);let T=!1;if(u&&(T=!x.intersectsSphere(or,n)),!T){let w=h[b],E=My.subVectors(or.center,vo).dot(Om);cf.push(w.start,w.count,E,_)}}let m=cf.list,v=this.customSort;v===null?m.sort(s.transparent?yy:_y):v.call(this,m,n);for(let _=0,y=m.length;_<y;_++){let b=m[_];l[p]=b.start*a,f[p]=b.count,g[p]=b.index,p++}cf.reset()}else for(let m=0,v=c.length;m<v;m++)if(c[m].visible&&c[m].active){let _=c[m].geometryIndex,y=!1;if(u&&(this.getMatrixAt(m,gn),this.getBoundingSphereAt(_,or).applyMatrix4(gn),y=!x.intersectsSphere(or,n)),!y){let b=h[_];l[p]=b.start*a,f[p]=b.count,g[p]=m,p++}}d.needsUpdate=!0,this._multiDrawCount=p,this._visibilityChanged=!1}onBeforeShadow(t,e,n,i,s,o){this.onBeforeRender(t,null,i,s,o)}},Qe=class extends Je{constructor(t){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new ft(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.linewidth=t.linewidth,this.linecap=t.linecap,this.linejoin=t.linejoin,this.fog=t.fog,this}},Gc=new R,Wc=new R,zm=new gt,_o=new ii,uc=new Ve,lf=new R,km=new R,ri=class extends ue{constructor(t=new Ft,e=new Qe){super(),this.isLine=!0,this.type="Line",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}computeLineDistances(){let t=this.geometry;if(t.index===null){let e=t.attributes.position,n=[0];for(let i=1,s=e.count;i<s;i++)Gc.fromBufferAttribute(e,i-1),Wc.fromBufferAttribute(e,i),n[i]=n[i-1],n[i]+=Gc.distanceTo(Wc);t.setAttribute("lineDistance",new bt(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(t,e){let n=this.geometry,i=this.matrixWorld,s=t.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),uc.copy(n.boundingSphere),uc.applyMatrix4(i),uc.radius+=s,t.ray.intersectsSphere(uc)===!1)return;zm.copy(i).invert(),_o.copy(t.ray).applyMatrix4(zm);let a=s/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=this.isLineSegments?2:1,f=n.index,u=n.attributes.position;if(f!==null){let d=Math.max(0,o.start),g=Math.min(f.count,o.start+o.count);for(let x=d,p=g-1;x<p;x+=l){let m=f.getX(x),v=f.getX(x+1),_=hc(this,t,_o,c,m,v,x);_&&e.push(_)}if(this.isLineLoop){let x=f.getX(g-1),p=f.getX(d),m=hc(this,t,_o,c,x,p,g-1);m&&e.push(m)}}else{let d=Math.max(0,o.start),g=Math.min(u.count,o.start+o.count);for(let x=d,p=g-1;x<p;x+=l){let m=hc(this,t,_o,c,x,x+1,x);m&&e.push(m)}if(this.isLineLoop){let x=hc(this,t,_o,c,g-1,d,g-1);x&&e.push(x)}}}updateMorphTargets(){let e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){let i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=i.length;s<o;s++){let a=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}};function hc(r,t,e,n,i,s,o){let a=r.geometry.attributes.position;if(Gc.fromBufferAttribute(a,i),Wc.fromBufferAttribute(a,s),e.distanceSqToSegment(Gc,Wc,lf,km)>n)return;lf.applyMatrix4(r.matrixWorld);let l=t.ray.origin.distanceTo(lf);if(!(l<t.near||l>t.far))return{distance:l,point:km.clone().applyMatrix4(r.matrixWorld),index:o,face:null,faceIndex:null,barycoord:null,object:r}}var Vm=new R,Hm=new R,kn=class extends ri{constructor(t,e){super(t,e),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let t=this.geometry;if(t.index===null){let e=t.attributes.position,n=[];for(let i=0,s=e.count;i<s;i+=2)Vm.fromBufferAttribute(e,i),Hm.fromBufferAttribute(e,i+1),n[i]=i===0?0:n[i-1],n[i+1]=n[i]+Vm.distanceTo(Hm);t.setAttribute("lineDistance",new bt(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}},Xc=class extends ri{constructor(t,e){super(t,e),this.isLineLoop=!0,this.type="LineLoop"}},Bo=class extends Je{constructor(t){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new ft(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.size=t.size,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}},Gm=new gt,Pf=new ii,fc=new Ve,dc=new R,qc=class extends ue{constructor(t=new Ft,e=new Bo){super(),this.isPoints=!0,this.type="Points",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}raycast(t,e){let n=this.geometry,i=this.matrixWorld,s=t.params.Points.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),fc.copy(n.boundingSphere),fc.applyMatrix4(i),fc.radius+=s,t.ray.intersectsSphere(fc)===!1)return;Gm.copy(i).invert(),Pf.copy(t.ray).applyMatrix4(Gm);let a=s/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=n.index,h=n.attributes.position;if(l!==null){let u=Math.max(0,o.start),d=Math.min(l.count,o.start+o.count);for(let g=u,x=d;g<x;g++){let p=l.getX(g);dc.fromBufferAttribute(h,p),Wm(dc,p,c,i,t,e,this)}}else{let u=Math.max(0,o.start),d=Math.min(h.count,o.start+o.count);for(let g=u,x=d;g<x;g++)dc.fromBufferAttribute(h,g),Wm(dc,g,c,i,t,e,this)}}updateMorphTargets(){let e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){let i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=i.length;s<o;s++){let a=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}};function Wm(r,t,e,n,i,s,o){let a=Pf.distanceSqToPoint(r);if(a<e){let c=new R;Pf.closestPointToPoint(r,c),c.applyMatrix4(n);let l=i.ray.origin.distanceTo(c);if(l<i.near||l>i.far)return;s.push({distance:l,distanceToRay:Math.sqrt(a),point:c,index:t,face:null,faceIndex:null,barycoord:null,object:o})}}var Yc=class extends Oe{constructor(t,e,n,i,s=re,o=re,a,c,l){super(t,e,n,i,s,o,a,c,l),this.isVideoTexture=!0,this.generateMipmaps=!1,this._requestVideoFrameCallbackId=0;let f=this;function h(){f.needsUpdate=!0,f._requestVideoFrameCallbackId=t.requestVideoFrameCallback(h)}"requestVideoFrameCallback"in t&&(this._requestVideoFrameCallbackId=t.requestVideoFrameCallback(h))}clone(){return new this.constructor(this.image).copy(this)}update(){let t=this.image;"requestVideoFrameCallback"in t===!1&&t.readyState>=t.HAVE_CURRENT_DATA&&(this.needsUpdate=!0)}dispose(){this._requestVideoFrameCallbackId!==0&&this.source.data.cancelVideoFrameCallback(this._requestVideoFrameCallbackId),super.dispose()}},Df=class extends Yc{constructor(t,e,n,i,s,o,a,c){super({},t,e,n,i,s,o,a,c),this.isVideoFrameTexture=!0}update(){}clone(){return new this.constructor().copy(this)}setFrame(t){this.image=t,this.needsUpdate=!0}},Ff=class extends Oe{constructor(t,e){super({width:t,height:e}),this.isFramebufferTexture=!0,this.magFilter=Vt,this.minFilter=Vt,this.generateMipmaps=!1,this.needsUpdate=!0}},Es=class extends Oe{constructor(t,e,n,i,s,o,a,c,l,f,h,u){super(null,o,a,c,l,f,i,s,h,u),this.isCompressedTexture=!0,this.image={width:e,height:n},this.mipmaps=t,this.flipY=!1,this.generateMipmaps=!1}},Lf=class extends Es{constructor(t,e,n,i,s,o){super(t,e,n,s,o),this.isCompressedArrayTexture=!0,this.image.depth=i,this.wrapR=we,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}},Nf=class extends Es{constructor(t,e,n){super(void 0,t[0].width,t[0].height,e,n,Si),this.isCompressedCubeTexture=!0,this.isCubeTexture=!0,this.image=t}},Uf=class extends Oe{constructor(t,e,n,i,s,o,a,c,l){super(t,e,n,i,s,o,a,c,l),this.isCanvasTexture=!0,this.needsUpdate=!0}},Oo=class extends Oe{constructor(t,e,n=an,i,s,o,a=Vt,c=Vt,l,f=xs,h=1){if(f!==xs&&f!==zs)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let u={width:t,height:e,depth:h};super(u,i,s,o,a,c,f,n,l),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new Bn(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){let e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}},zo=class extends Oe{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}},$c=class r extends Ft{constructor(t=1,e=1,n=4,i=8,s=1){super(),this.type="CapsuleGeometry",this.parameters={radius:t,height:e,capSegments:n,radialSegments:i,heightSegments:s},e=Math.max(0,e),n=Math.max(1,Math.floor(n)),i=Math.max(3,Math.floor(i)),s=Math.max(1,Math.floor(s));let o=[],a=[],c=[],l=[],f=e/2,h=Math.PI/2*t,u=e,d=2*h+u,g=n*2+s,x=i+1,p=new R,m=new R;for(let v=0;v<=g;v++){let _=0,y=0,b=0,T=0;if(v<=n){let M=v/n,S=M*Math.PI/2;y=-f-t*Math.cos(S),b=t*Math.sin(S),T=-t*Math.cos(S),_=M*h}else if(v<=n+s){let M=(v-n)/s;y=-f+M*e,b=t,T=0,_=h+M*u}else{let M=(v-n-s)/n,S=M*Math.PI/2;y=f+t*Math.sin(S),b=t*Math.cos(S),T=t*Math.sin(S),_=h+u+M*h}let w=Math.max(0,Math.min(1,_/d)),E=0;v===0?E=.5/i:v===g&&(E=-.5/i);for(let M=0;M<=i;M++){let S=M/i,I=S*Math.PI*2,P=Math.sin(I),L=Math.cos(I);m.x=-b*L,m.y=y,m.z=b*P,a.push(m.x,m.y,m.z),p.set(-b*L,T,b*P),p.normalize(),c.push(p.x,p.y,p.z),l.push(S+E,w)}if(v>0){let M=(v-1)*x;for(let S=0;S<i;S++){let I=M+S,P=M+S+1,L=v*x+S,N=v*x+S+1;o.push(I,P,L),o.push(P,N,L)}}}this.setIndex(o),this.setAttribute("position",new bt(a,3)),this.setAttribute("normal",new bt(c,3)),this.setAttribute("uv",new bt(l,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.radius,t.height,t.capSegments,t.radialSegments,t.heightSegments)}},Zc=class r extends Ft{constructor(t=1,e=32,n=0,i=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:t,segments:e,thetaStart:n,thetaLength:i},e=Math.max(3,e);let s=[],o=[],a=[],c=[],l=new R,f=new q;o.push(0,0,0),a.push(0,0,1),c.push(.5,.5);for(let h=0,u=3;h<=e;h++,u+=3){let d=n+h/e*i;l.x=t*Math.cos(d),l.y=t*Math.sin(d),o.push(l.x,l.y,l.z),a.push(0,0,1),f.x=(o[u]/t+1)/2,f.y=(o[u+1]/t+1)/2,c.push(f.x,f.y)}for(let h=1;h<=e;h++)s.push(h,h+1,0);this.setIndex(s),this.setAttribute("position",new bt(o,3)),this.setAttribute("normal",new bt(a,3)),this.setAttribute("uv",new bt(c,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.radius,t.segments,t.thetaStart,t.thetaLength)}},ko=class r extends Ft{constructor(t=1,e=1,n=1,i=32,s=1,o=!1,a=0,c=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:n,radialSegments:i,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:c};let l=this;i=Math.floor(i),s=Math.floor(s);let f=[],h=[],u=[],d=[],g=0,x=[],p=n/2,m=0;v(),o===!1&&(t>0&&_(!0),e>0&&_(!1)),this.setIndex(f),this.setAttribute("position",new bt(h,3)),this.setAttribute("normal",new bt(u,3)),this.setAttribute("uv",new bt(d,2));function v(){let y=new R,b=new R,T=0,w=(e-t)/n;for(let E=0;E<=s;E++){let M=[],S=E/s,I=S*(e-t)+t;for(let P=0;P<=i;P++){let L=P/i,N=L*c+a,z=Math.sin(N),V=Math.cos(N);b.x=I*z,b.y=-S*n+p,b.z=I*V,h.push(b.x,b.y,b.z),y.set(z,w,V).normalize(),u.push(y.x,y.y,y.z),d.push(L,1-S),M.push(g++)}x.push(M)}for(let E=0;E<i;E++)for(let M=0;M<s;M++){let S=x[M][E],I=x[M+1][E],P=x[M+1][E+1],L=x[M][E+1];(t>0||M!==0)&&(f.push(S,I,L),T+=3),(e>0||M!==s-1)&&(f.push(I,P,L),T+=3)}l.addGroup(m,T,0),m+=T}function _(y){let b=g,T=new q,w=new R,E=0,M=y===!0?t:e,S=y===!0?1:-1;for(let P=1;P<=i;P++)h.push(0,p*S,0),u.push(0,S,0),d.push(.5,.5),g++;let I=g;for(let P=0;P<=i;P++){let N=P/i*c+a,z=Math.cos(N),V=Math.sin(N);w.x=M*V,w.y=p*S,w.z=M*z,h.push(w.x,w.y,w.z),u.push(0,S,0),T.x=z*.5+.5,T.y=V*.5*S+.5,d.push(T.x,T.y),g++}for(let P=0;P<i;P++){let L=b+P,N=I+P;y===!0?f.push(N,N+1,L):f.push(N+1,N,L),E+=3}l.addGroup(m,E,y===!0?1:2),m+=E}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}},Vo=class r extends ko{constructor(t=1,e=1,n=32,i=1,s=!1,o=0,a=Math.PI*2){super(0,t,e,n,i,s,o,a),this.type="ConeGeometry",this.parameters={radius:t,height:e,radialSegments:n,heightSegments:i,openEnded:s,thetaStart:o,thetaLength:a}}static fromJSON(t){return new r(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}},zi=class r extends Ft{constructor(t=[],e=[],n=1,i=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:n,detail:i};let s=[],o=[];a(i),l(n),f(),this.setAttribute("position",new bt(s,3)),this.setAttribute("normal",new bt(s.slice(),3)),this.setAttribute("uv",new bt(o,2)),i===0?this.computeVertexNormals():this.normalizeNormals();function a(v){let _=new R,y=new R,b=new R;for(let T=0;T<e.length;T+=3)d(e[T+0],_),d(e[T+1],y),d(e[T+2],b),c(_,y,b,v)}function c(v,_,y,b){let T=b+1,w=[];for(let E=0;E<=T;E++){w[E]=[];let M=v.clone().lerp(y,E/T),S=_.clone().lerp(y,E/T),I=T-E;for(let P=0;P<=I;P++)P===0&&E===T?w[E][P]=M:w[E][P]=M.clone().lerp(S,P/I)}for(let E=0;E<T;E++)for(let M=0;M<2*(T-E)-1;M++){let S=Math.floor(M/2);M%2===0?(u(w[E][S+1]),u(w[E+1][S]),u(w[E][S])):(u(w[E][S+1]),u(w[E+1][S+1]),u(w[E+1][S]))}}function l(v){let _=new R;for(let y=0;y<s.length;y+=3)_.x=s[y+0],_.y=s[y+1],_.z=s[y+2],_.normalize().multiplyScalar(v),s[y+0]=_.x,s[y+1]=_.y,s[y+2]=_.z}function f(){let v=new R;for(let _=0;_<s.length;_+=3){v.x=s[_+0],v.y=s[_+1],v.z=s[_+2];let y=p(v)/2/Math.PI+.5,b=m(v)/Math.PI+.5;o.push(y,1-b)}g(),h()}function h(){for(let v=0;v<o.length;v+=6){let _=o[v+0],y=o[v+2],b=o[v+4],T=Math.max(_,y,b),w=Math.min(_,y,b);T>.9&&w<.1&&(_<.2&&(o[v+0]+=1),y<.2&&(o[v+2]+=1),b<.2&&(o[v+4]+=1))}}function u(v){s.push(v.x,v.y,v.z)}function d(v,_){let y=v*3;_.x=t[y+0],_.y=t[y+1],_.z=t[y+2]}function g(){let v=new R,_=new R,y=new R,b=new R,T=new q,w=new q,E=new q;for(let M=0,S=0;M<s.length;M+=9,S+=6){v.set(s[M+0],s[M+1],s[M+2]),_.set(s[M+3],s[M+4],s[M+5]),y.set(s[M+6],s[M+7],s[M+8]),T.set(o[S+0],o[S+1]),w.set(o[S+2],o[S+3]),E.set(o[S+4],o[S+5]),b.copy(v).add(_).add(y).divideScalar(3);let I=p(b);x(T,S+0,v,I),x(w,S+2,_,I),x(E,S+4,y,I)}}function x(v,_,y,b){b<0&&v.x===1&&(o[_]=v.x-1),y.x===0&&y.z===0&&(o[_]=b/2/Math.PI+.5)}function p(v){return Math.atan2(v.z,-v.x)}function m(v){return Math.atan2(-v.y,Math.sqrt(v.x*v.x+v.z*v.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.vertices,t.indices,t.radius,t.details)}},Jc=class r extends zi{constructor(t=1,e=0){let n=(1+Math.sqrt(5))/2,i=1/n,s=[-1,-1,-1,-1,-1,1,-1,1,-1,-1,1,1,1,-1,-1,1,-1,1,1,1,-1,1,1,1,0,-i,-n,0,-i,n,0,i,-n,0,i,n,-i,-n,0,-i,n,0,i,-n,0,i,n,0,-n,0,-i,n,0,-i,-n,0,i,n,0,i],o=[3,11,7,3,7,15,3,15,13,7,19,17,7,17,6,7,6,15,17,4,8,17,8,10,17,10,6,8,0,16,8,16,2,8,2,10,0,12,1,0,1,18,0,18,16,6,10,2,6,2,13,6,13,15,2,16,18,2,18,3,2,3,13,18,1,9,18,9,11,18,11,3,4,14,12,4,12,0,4,0,8,11,9,5,11,5,19,11,19,7,19,5,14,19,14,4,19,4,17,1,12,14,1,14,5,1,5,9];super(s,o,t,e),this.type="DodecahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new r(t.radius,t.detail)}},pc=new R,mc=new R,uf=new R,gc=new $e,Kc=class extends Ft{constructor(t=null,e=1){if(super(),this.type="EdgesGeometry",this.parameters={geometry:t,thresholdAngle:e},t!==null){let i=Math.pow(10,4),s=Math.cos(vr*e),o=t.getIndex(),a=t.getAttribute("position"),c=o?o.count:a.count,l=[0,0,0],f=["a","b","c"],h=new Array(3),u={},d=[];for(let g=0;g<c;g+=3){o?(l[0]=o.getX(g),l[1]=o.getX(g+1),l[2]=o.getX(g+2)):(l[0]=g,l[1]=g+1,l[2]=g+2);let{a:x,b:p,c:m}=gc;if(x.fromBufferAttribute(a,l[0]),p.fromBufferAttribute(a,l[1]),m.fromBufferAttribute(a,l[2]),gc.getNormal(uf),h[0]=`${Math.round(x.x*i)},${Math.round(x.y*i)},${Math.round(x.z*i)}`,h[1]=`${Math.round(p.x*i)},${Math.round(p.y*i)},${Math.round(p.z*i)}`,h[2]=`${Math.round(m.x*i)},${Math.round(m.y*i)},${Math.round(m.z*i)}`,!(h[0]===h[1]||h[1]===h[2]||h[2]===h[0]))for(let v=0;v<3;v++){let _=(v+1)%3,y=h[v],b=h[_],T=gc[f[v]],w=gc[f[_]],E=`${y}_${b}`,M=`${b}_${y}`;M in u&&u[M]?(uf.dot(u[M].normal)<=s&&(d.push(T.x,T.y,T.z),d.push(w.x,w.y,w.z)),u[M]=null):E in u||(u[E]={index0:l[v],index1:l[_],normal:uf.clone()})}}for(let g in u)if(u[g]){let{index0:x,index1:p}=u[g];pc.fromBufferAttribute(a,x),mc.fromBufferAttribute(a,p),d.push(pc.x,pc.y,pc.z),d.push(mc.x,mc.y,mc.z)}this.setAttribute("position",new bt(d,3))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}},Pn=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){console.warn("THREE.Curve: .getPoint() not implemented.")}getPointAt(t,e){let n=this.getUtoTmapping(t);return this.getPoint(n,e)}getPoints(t=5){let e=[];for(let n=0;n<=t;n++)e.push(this.getPoint(n/t));return e}getSpacedPoints(t=5){let e=[];for(let n=0;n<=t;n++)e.push(this.getPointAt(n/t));return e}getLength(){let t=this.getLengths();return t[t.length-1]}getLengths(t=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===t+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let e=[],n,i=this.getPoint(0),s=0;e.push(0);for(let o=1;o<=t;o++)n=this.getPoint(o/t),s+=n.distanceTo(i),e.push(s),i=n;return this.cacheArcLengths=e,e}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(t,e=null){let n=this.getLengths(),i=0,s=n.length,o;e?o=e:o=t*n[s-1];let a=0,c=s-1,l;for(;a<=c;)if(i=Math.floor(a+(c-a)/2),l=n[i]-o,l<0)a=i+1;else if(l>0)c=i-1;else{c=i;break}if(i=c,n[i]===o)return i/(s-1);let f=n[i],u=n[i+1]-f,d=(o-f)/u;return(i+d)/(s-1)}getTangent(t,e){let i=t-1e-4,s=t+1e-4;i<0&&(i=0),s>1&&(s=1);let o=this.getPoint(i),a=this.getPoint(s),c=e||(o.isVector2?new q:new R);return c.copy(a).sub(o).normalize(),c}getTangentAt(t,e){let n=this.getUtoTmapping(t);return this.getTangent(n,e)}computeFrenetFrames(t,e=!1){let n=new R,i=[],s=[],o=[],a=new R,c=new gt;for(let d=0;d<=t;d++){let g=d/t;i[d]=this.getTangentAt(g,new R)}s[0]=new R,o[0]=new R;let l=Number.MAX_VALUE,f=Math.abs(i[0].x),h=Math.abs(i[0].y),u=Math.abs(i[0].z);f<=l&&(l=f,n.set(1,0,0)),h<=l&&(l=h,n.set(0,1,0)),u<=l&&n.set(0,0,1),a.crossVectors(i[0],n).normalize(),s[0].crossVectors(i[0],a),o[0].crossVectors(i[0],s[0]);for(let d=1;d<=t;d++){if(s[d]=s[d-1].clone(),o[d]=o[d-1].clone(),a.crossVectors(i[d-1],i[d]),a.length()>Number.EPSILON){a.normalize();let g=Math.acos(Bt(i[d-1].dot(i[d]),-1,1));s[d].applyMatrix4(c.makeRotationAxis(a,g))}o[d].crossVectors(i[d],s[d])}if(e===!0){let d=Math.acos(Bt(s[0].dot(s[t]),-1,1));d/=t,i[0].dot(a.crossVectors(s[0],s[t]))>0&&(d=-d);for(let g=1;g<=t;g++)s[g].applyMatrix4(c.makeRotationAxis(i[g],d*g)),o[g].crossVectors(i[g],s[g])}return{tangents:i,normals:s,binormals:o}}clone(){return new this.constructor().copy(this)}copy(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}toJSON(){let t={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return t.arcLengthDivisions=this.arcLengthDivisions,t.type=this.type,t}fromJSON(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}},Rs=class extends Pn{constructor(t=0,e=0,n=1,i=1,s=0,o=Math.PI*2,a=!1,c=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=t,this.aY=e,this.xRadius=n,this.yRadius=i,this.aStartAngle=s,this.aEndAngle=o,this.aClockwise=a,this.aRotation=c}getPoint(t,e=new q){let n=e,i=Math.PI*2,s=this.aEndAngle-this.aStartAngle,o=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=i;for(;s>i;)s-=i;s<Number.EPSILON&&(o?s=0:s=i),this.aClockwise===!0&&!o&&(s===i?s=-i:s=s-i);let a=this.aStartAngle+t*s,c=this.aX+this.xRadius*Math.cos(a),l=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let f=Math.cos(this.aRotation),h=Math.sin(this.aRotation),u=c-this.aX,d=l-this.aY;c=u*f-d*h+this.aX,l=u*h+d*f+this.aY}return n.set(c,l)}copy(t){return super.copy(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}toJSON(){let t=super.toJSON();return t.aX=this.aX,t.aY=this.aY,t.xRadius=this.xRadius,t.yRadius=this.yRadius,t.aStartAngle=this.aStartAngle,t.aEndAngle=this.aEndAngle,t.aClockwise=this.aClockwise,t.aRotation=this.aRotation,t}fromJSON(t){return super.fromJSON(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}},Qc=class extends Rs{constructor(t,e,n,i,s,o){super(t,e,n,n,i,s,o),this.isArcCurve=!0,this.type="ArcCurve"}};function Jd(){let r=0,t=0,e=0,n=0;function i(s,o,a,c){r=s,t=a,e=-3*s+3*o-2*a-c,n=2*s-2*o+a+c}return{initCatmullRom:function(s,o,a,c,l){i(o,a,l*(a-s),l*(c-o))},initNonuniformCatmullRom:function(s,o,a,c,l,f,h){let u=(o-s)/l-(a-s)/(l+f)+(a-o)/f,d=(a-o)/f-(c-o)/(f+h)+(c-a)/h;u*=f,d*=f,i(o,a,u,d)},calc:function(s){let o=s*s,a=o*s;return r+t*s+e*o+n*a}}}var xc=new R,hf=new Jd,ff=new Jd,df=new Jd,jc=class extends Pn{constructor(t=[],e=!1,n="centripetal",i=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=t,this.closed=e,this.curveType=n,this.tension=i}getPoint(t,e=new R){let n=e,i=this.points,s=i.length,o=(s-(this.closed?0:1))*t,a=Math.floor(o),c=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/s)+1)*s:c===0&&a===s-1&&(a=s-2,c=1);let l,f;this.closed||a>0?l=i[(a-1)%s]:(xc.subVectors(i[0],i[1]).add(i[0]),l=xc);let h=i[a%s],u=i[(a+1)%s];if(this.closed||a+2<s?f=i[(a+2)%s]:(xc.subVectors(i[s-1],i[s-2]).add(i[s-1]),f=xc),this.curveType==="centripetal"||this.curveType==="chordal"){let d=this.curveType==="chordal"?.5:.25,g=Math.pow(l.distanceToSquared(h),d),x=Math.pow(h.distanceToSquared(u),d),p=Math.pow(u.distanceToSquared(f),d);x<1e-4&&(x=1),g<1e-4&&(g=x),p<1e-4&&(p=x),hf.initNonuniformCatmullRom(l.x,h.x,u.x,f.x,g,x,p),ff.initNonuniformCatmullRom(l.y,h.y,u.y,f.y,g,x,p),df.initNonuniformCatmullRom(l.z,h.z,u.z,f.z,g,x,p)}else this.curveType==="catmullrom"&&(hf.initCatmullRom(l.x,h.x,u.x,f.x,this.tension),ff.initCatmullRom(l.y,h.y,u.y,f.y,this.tension),df.initCatmullRom(l.z,h.z,u.z,f.z,this.tension));return n.set(hf.calc(c),ff.calc(c),df.calc(c)),n}copy(t){super.copy(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let i=t.points[e];this.points.push(i.clone())}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}toJSON(){let t=super.toJSON();t.points=[];for(let e=0,n=this.points.length;e<n;e++){let i=this.points[e];t.points.push(i.toArray())}return t.closed=this.closed,t.curveType=this.curveType,t.tension=this.tension,t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let i=t.points[e];this.points.push(new R().fromArray(i))}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}};function Xm(r,t,e,n,i){let s=(n-t)*.5,o=(i-e)*.5,a=r*r,c=r*a;return(2*e-2*n+s+o)*c+(-3*e+3*n-2*s-o)*a+s*r+e}function wy(r,t){let e=1-r;return e*e*t}function Ay(r,t){return 2*(1-r)*r*t}function Ey(r,t){return r*r*t}function To(r,t,e,n){return wy(r,t)+Ay(r,e)+Ey(r,n)}function Ry(r,t){let e=1-r;return e*e*e*t}function Cy(r,t){let e=1-r;return 3*e*e*r*t}function Iy(r,t){return 3*(1-r)*r*r*t}function Py(r,t){return r*r*r*t}function wo(r,t,e,n,i){return Ry(r,t)+Cy(r,e)+Iy(r,n)+Py(r,i)}var Ho=class extends Pn{constructor(t=new q,e=new q,n=new q,i=new q){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=t,this.v1=e,this.v2=n,this.v3=i}getPoint(t,e=new q){let n=e,i=this.v0,s=this.v1,o=this.v2,a=this.v3;return n.set(wo(t,i.x,s.x,o.x,a.x),wo(t,i.y,s.y,o.y,a.y)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}},tl=class extends Pn{constructor(t=new R,e=new R,n=new R,i=new R){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=t,this.v1=e,this.v2=n,this.v3=i}getPoint(t,e=new R){let n=e,i=this.v0,s=this.v1,o=this.v2,a=this.v3;return n.set(wo(t,i.x,s.x,o.x,a.x),wo(t,i.y,s.y,o.y,a.y),wo(t,i.z,s.z,o.z,a.z)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}},Go=class extends Pn{constructor(t=new q,e=new q){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=t,this.v2=e}getPoint(t,e=new q){let n=e;return t===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(t).add(this.v1)),n}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new q){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},el=class extends Pn{constructor(t=new R,e=new R){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=t,this.v2=e}getPoint(t,e=new R){let n=e;return t===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(t).add(this.v1)),n}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new R){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},Wo=class extends Pn{constructor(t=new q,e=new q,n=new q){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=t,this.v1=e,this.v2=n}getPoint(t,e=new q){let n=e,i=this.v0,s=this.v1,o=this.v2;return n.set(To(t,i.x,s.x,o.x),To(t,i.y,s.y,o.y)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},Xo=class extends Pn{constructor(t=new R,e=new R,n=new R){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=t,this.v1=e,this.v2=n}getPoint(t,e=new R){let n=e,i=this.v0,s=this.v1,o=this.v2;return n.set(To(t,i.x,s.x,o.x),To(t,i.y,s.y,o.y),To(t,i.z,s.z,o.z)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},qo=class extends Pn{constructor(t=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=t}getPoint(t,e=new q){let n=e,i=this.points,s=(i.length-1)*t,o=Math.floor(s),a=s-o,c=i[o===0?o:o-1],l=i[o],f=i[o>i.length-2?i.length-1:o+1],h=i[o>i.length-3?i.length-1:o+2];return n.set(Xm(a,c.x,l.x,f.x,h.x),Xm(a,c.y,l.y,f.y,h.y)),n}copy(t){super.copy(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let i=t.points[e];this.points.push(i.clone())}return this}toJSON(){let t=super.toJSON();t.points=[];for(let e=0,n=this.points.length;e<n;e++){let i=this.points[e];t.points.push(i.toArray())}return t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let i=t.points[e];this.points.push(new q().fromArray(i))}return this}},nl=Object.freeze({__proto__:null,ArcCurve:Qc,CatmullRomCurve3:jc,CubicBezierCurve:Ho,CubicBezierCurve3:tl,EllipseCurve:Rs,LineCurve:Go,LineCurve3:el,QuadraticBezierCurve:Wo,QuadraticBezierCurve3:Xo,SplineCurve:qo}),il=class extends Pn{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(t){this.curves.push(t)}closePath(){let t=this.curves[0].getPoint(0),e=this.curves[this.curves.length-1].getPoint(1);if(!t.equals(e)){let n=t.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new nl[n](e,t))}return this}getPoint(t,e){let n=t*this.getLength(),i=this.getCurveLengths(),s=0;for(;s<i.length;){if(i[s]>=n){let o=i[s]-n,a=this.curves[s],c=a.getLength(),l=c===0?0:1-o/c;return a.getPointAt(l,e)}s++}return null}getLength(){let t=this.getCurveLengths();return t[t.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let t=[],e=0;for(let n=0,i=this.curves.length;n<i;n++)e+=this.curves[n].getLength(),t.push(e);return this.cacheLengths=t,t}getSpacedPoints(t=40){let e=[];for(let n=0;n<=t;n++)e.push(this.getPoint(n/t));return this.autoClose&&e.push(e[0]),e}getPoints(t=12){let e=[],n;for(let i=0,s=this.curves;i<s.length;i++){let o=s[i],a=o.isEllipseCurve?t*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?t*o.points.length:t,c=o.getPoints(a);for(let l=0;l<c.length;l++){let f=c[l];n&&n.equals(f)||(e.push(f),n=f)}}return this.autoClose&&e.length>1&&!e[e.length-1].equals(e[0])&&e.push(e[0]),e}copy(t){super.copy(t),this.curves=[];for(let e=0,n=t.curves.length;e<n;e++){let i=t.curves[e];this.curves.push(i.clone())}return this.autoClose=t.autoClose,this}toJSON(){let t=super.toJSON();t.autoClose=this.autoClose,t.curves=[];for(let e=0,n=this.curves.length;e<n;e++){let i=this.curves[e];t.curves.push(i.toJSON())}return t}fromJSON(t){super.fromJSON(t),this.autoClose=t.autoClose,this.curves=[];for(let e=0,n=t.curves.length;e<n;e++){let i=t.curves[e];this.curves.push(new nl[i.type]().fromJSON(i))}return this}},Cs=class extends il{constructor(t){super(),this.type="Path",this.currentPoint=new q,t&&this.setFromPoints(t)}setFromPoints(t){this.moveTo(t[0].x,t[0].y);for(let e=1,n=t.length;e<n;e++)this.lineTo(t[e].x,t[e].y);return this}moveTo(t,e){return this.currentPoint.set(t,e),this}lineTo(t,e){let n=new Go(this.currentPoint.clone(),new q(t,e));return this.curves.push(n),this.currentPoint.set(t,e),this}quadraticCurveTo(t,e,n,i){let s=new Wo(this.currentPoint.clone(),new q(t,e),new q(n,i));return this.curves.push(s),this.currentPoint.set(n,i),this}bezierCurveTo(t,e,n,i,s,o){let a=new Ho(this.currentPoint.clone(),new q(t,e),new q(n,i),new q(s,o));return this.curves.push(a),this.currentPoint.set(s,o),this}splineThru(t){let e=[this.currentPoint.clone()].concat(t),n=new qo(e);return this.curves.push(n),this.currentPoint.copy(t[t.length-1]),this}arc(t,e,n,i,s,o){let a=this.currentPoint.x,c=this.currentPoint.y;return this.absarc(t+a,e+c,n,i,s,o),this}absarc(t,e,n,i,s,o){return this.absellipse(t,e,n,n,i,s,o),this}ellipse(t,e,n,i,s,o,a,c){let l=this.currentPoint.x,f=this.currentPoint.y;return this.absellipse(t+l,e+f,n,i,s,o,a,c),this}absellipse(t,e,n,i,s,o,a,c){let l=new Rs(t,e,n,i,s,o,a,c);if(this.curves.length>0){let h=l.getPoint(0);h.equals(this.currentPoint)||this.lineTo(h.x,h.y)}this.curves.push(l);let f=l.getPoint(1);return this.currentPoint.copy(f),this}copy(t){return super.copy(t),this.currentPoint.copy(t.currentPoint),this}toJSON(){let t=super.toJSON();return t.currentPoint=this.currentPoint.toArray(),t}fromJSON(t){return super.fromJSON(t),this.currentPoint.fromArray(t.currentPoint),this}},_i=class extends Cs{constructor(t){super(t),this.uuid=Cn(),this.type="Shape",this.holes=[]}getPointsHoles(t){let e=[];for(let n=0,i=this.holes.length;n<i;n++)e[n]=this.holes[n].getPoints(t);return e}extractPoints(t){return{shape:this.getPoints(t),holes:this.getPointsHoles(t)}}copy(t){super.copy(t),this.holes=[];for(let e=0,n=t.holes.length;e<n;e++){let i=t.holes[e];this.holes.push(i.clone())}return this}toJSON(){let t=super.toJSON();t.uuid=this.uuid,t.holes=[];for(let e=0,n=this.holes.length;e<n;e++){let i=this.holes[e];t.holes.push(i.toJSON())}return t}fromJSON(t){super.fromJSON(t),this.uuid=t.uuid,this.holes=[];for(let e=0,n=t.holes.length;e<n;e++){let i=t.holes[e];this.holes.push(new Cs().fromJSON(i))}return this}};function Dy(r,t,e=2){let n=t&&t.length,i=n?t[0]*e:r.length,s=u0(r,0,i,e,!0),o=[];if(!s||s.next===s.prev)return o;let a,c,l;if(n&&(s=By(r,t,s,e)),r.length>80*e){a=1/0,c=1/0;let f=-1/0,h=-1/0;for(let u=e;u<i;u+=e){let d=r[u],g=r[u+1];d<a&&(a=d),g<c&&(c=g),d>f&&(f=d),g>h&&(h=g)}l=Math.max(f-a,h-c),l=l!==0?32767/l:0}return Yo(s,o,e,a,c,l,0),o}function u0(r,t,e,n,i){let s;if(i===$y(r,t,e,n)>0)for(let o=t;o<e;o+=n)s=qm(o/n|0,r[o],r[o+1],s);else for(let o=e-n;o>=t;o-=n)s=qm(o/n|0,r[o],r[o+1],s);return s&&Is(s,s.next)&&(Zo(s),s=s.next),s}function wr(r,t){if(!r)return r;t||(t=r);let e=r,n;do if(n=!1,!e.steiner&&(Is(e,e.next)||Ce(e.prev,e,e.next)===0)){if(Zo(e),e=t=e.prev,e===e.next)break;n=!0}else e=e.next;while(n||e!==t);return t}function Yo(r,t,e,n,i,s,o){if(!r)return;!o&&s&&Hy(r,n,i,s);let a=r;for(;r.prev!==r.next;){let c=r.prev,l=r.next;if(s?Ly(r,n,i,s):Fy(r)){t.push(c.i,r.i,l.i),Zo(r),r=l.next,a=l.next;continue}if(r=l,r===a){o?o===1?(r=Ny(wr(r),t),Yo(r,t,e,n,i,s,2)):o===2&&Uy(r,t,e,n,i,s):Yo(wr(r),t,e,n,i,s,1);break}}}function Fy(r){let t=r.prev,e=r,n=r.next;if(Ce(t,e,n)>=0)return!1;let i=t.x,s=e.x,o=n.x,a=t.y,c=e.y,l=n.y,f=Math.min(i,s,o),h=Math.min(a,c,l),u=Math.max(i,s,o),d=Math.max(a,c,l),g=n.next;for(;g!==t;){if(g.x>=f&&g.x<=u&&g.y>=h&&g.y<=d&&So(i,a,s,c,o,l,g.x,g.y)&&Ce(g.prev,g,g.next)>=0)return!1;g=g.next}return!0}function Ly(r,t,e,n){let i=r.prev,s=r,o=r.next;if(Ce(i,s,o)>=0)return!1;let a=i.x,c=s.x,l=o.x,f=i.y,h=s.y,u=o.y,d=Math.min(a,c,l),g=Math.min(f,h,u),x=Math.max(a,c,l),p=Math.max(f,h,u),m=Bf(d,g,t,e,n),v=Bf(x,p,t,e,n),_=r.prevZ,y=r.nextZ;for(;_&&_.z>=m&&y&&y.z<=v;){if(_.x>=d&&_.x<=x&&_.y>=g&&_.y<=p&&_!==i&&_!==o&&So(a,f,c,h,l,u,_.x,_.y)&&Ce(_.prev,_,_.next)>=0||(_=_.prevZ,y.x>=d&&y.x<=x&&y.y>=g&&y.y<=p&&y!==i&&y!==o&&So(a,f,c,h,l,u,y.x,y.y)&&Ce(y.prev,y,y.next)>=0))return!1;y=y.nextZ}for(;_&&_.z>=m;){if(_.x>=d&&_.x<=x&&_.y>=g&&_.y<=p&&_!==i&&_!==o&&So(a,f,c,h,l,u,_.x,_.y)&&Ce(_.prev,_,_.next)>=0)return!1;_=_.prevZ}for(;y&&y.z<=v;){if(y.x>=d&&y.x<=x&&y.y>=g&&y.y<=p&&y!==i&&y!==o&&So(a,f,c,h,l,u,y.x,y.y)&&Ce(y.prev,y,y.next)>=0)return!1;y=y.nextZ}return!0}function Ny(r,t){let e=r;do{let n=e.prev,i=e.next.next;!Is(n,i)&&f0(n,e,e.next,i)&&$o(n,i)&&$o(i,n)&&(t.push(n.i,e.i,i.i),Zo(e),Zo(e.next),e=r=i),e=e.next}while(e!==r);return wr(e)}function Uy(r,t,e,n,i,s){let o=r;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&Xy(o,a)){let c=d0(o,a);o=wr(o,o.next),c=wr(c,c.next),Yo(o,t,e,n,i,s,0),Yo(c,t,e,n,i,s,0);return}a=a.next}o=o.next}while(o!==r)}function By(r,t,e,n){let i=[];for(let s=0,o=t.length;s<o;s++){let a=t[s]*n,c=s<o-1?t[s+1]*n:r.length,l=u0(r,a,c,n,!1);l===l.next&&(l.steiner=!0),i.push(Wy(l))}i.sort(Oy);for(let s=0;s<i.length;s++)e=zy(i[s],e);return e}function Oy(r,t){let e=r.x-t.x;if(e===0&&(e=r.y-t.y,e===0)){let n=(r.next.y-r.y)/(r.next.x-r.x),i=(t.next.y-t.y)/(t.next.x-t.x);e=n-i}return e}function zy(r,t){let e=ky(r,t);if(!e)return t;let n=d0(e,r);return wr(n,n.next),wr(e,e.next)}function ky(r,t){let e=t,n=r.x,i=r.y,s=-1/0,o;if(Is(r,e))return e;do{if(Is(r,e.next))return e.next;if(i<=e.y&&i>=e.next.y&&e.next.y!==e.y){let h=e.x+(i-e.y)*(e.next.x-e.x)/(e.next.y-e.y);if(h<=n&&h>s&&(s=h,o=e.x<e.next.x?e:e.next,h===n))return o}e=e.next}while(e!==t);if(!o)return null;let a=o,c=o.x,l=o.y,f=1/0;e=o;do{if(n>=e.x&&e.x>=c&&n!==e.x&&h0(i<l?n:s,i,c,l,i<l?s:n,i,e.x,e.y)){let h=Math.abs(i-e.y)/(n-e.x);$o(e,r)&&(h<f||h===f&&(e.x>o.x||e.x===o.x&&Vy(o,e)))&&(o=e,f=h)}e=e.next}while(e!==a);return o}function Vy(r,t){return Ce(r.prev,r,t.prev)<0&&Ce(t.next,r,r.next)<0}function Hy(r,t,e,n){let i=r;do i.z===0&&(i.z=Bf(i.x,i.y,t,e,n)),i.prevZ=i.prev,i.nextZ=i.next,i=i.next;while(i!==r);i.prevZ.nextZ=null,i.prevZ=null,Gy(i)}function Gy(r){let t,e=1;do{let n=r,i;r=null;let s=null;for(t=0;n;){t++;let o=n,a=0;for(let l=0;l<e&&(a++,o=o.nextZ,!!o);l++);let c=e;for(;a>0||c>0&&o;)a!==0&&(c===0||!o||n.z<=o.z)?(i=n,n=n.nextZ,a--):(i=o,o=o.nextZ,c--),s?s.nextZ=i:r=i,i.prevZ=s,s=i;n=o}s.nextZ=null,e*=2}while(t>1);return r}function Bf(r,t,e,n,i){return r=(r-e)*i|0,t=(t-n)*i|0,r=(r|r<<8)&16711935,r=(r|r<<4)&252645135,r=(r|r<<2)&858993459,r=(r|r<<1)&1431655765,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,r|t<<1}function Wy(r){let t=r,e=r;do(t.x<e.x||t.x===e.x&&t.y<e.y)&&(e=t),t=t.next;while(t!==r);return e}function h0(r,t,e,n,i,s,o,a){return(i-o)*(t-a)>=(r-o)*(s-a)&&(r-o)*(n-a)>=(e-o)*(t-a)&&(e-o)*(s-a)>=(i-o)*(n-a)}function So(r,t,e,n,i,s,o,a){return!(r===o&&t===a)&&h0(r,t,e,n,i,s,o,a)}function Xy(r,t){return r.next.i!==t.i&&r.prev.i!==t.i&&!qy(r,t)&&($o(r,t)&&$o(t,r)&&Yy(r,t)&&(Ce(r.prev,r,t.prev)||Ce(r,t.prev,t))||Is(r,t)&&Ce(r.prev,r,r.next)>0&&Ce(t.prev,t,t.next)>0)}function Ce(r,t,e){return(t.y-r.y)*(e.x-t.x)-(t.x-r.x)*(e.y-t.y)}function Is(r,t){return r.x===t.x&&r.y===t.y}function f0(r,t,e,n){let i=_c(Ce(r,t,e)),s=_c(Ce(r,t,n)),o=_c(Ce(e,n,r)),a=_c(Ce(e,n,t));return!!(i!==s&&o!==a||i===0&&vc(r,e,t)||s===0&&vc(r,n,t)||o===0&&vc(e,r,n)||a===0&&vc(e,t,n))}function vc(r,t,e){return t.x<=Math.max(r.x,e.x)&&t.x>=Math.min(r.x,e.x)&&t.y<=Math.max(r.y,e.y)&&t.y>=Math.min(r.y,e.y)}function _c(r){return r>0?1:r<0?-1:0}function qy(r,t){let e=r;do{if(e.i!==r.i&&e.next.i!==r.i&&e.i!==t.i&&e.next.i!==t.i&&f0(e,e.next,r,t))return!0;e=e.next}while(e!==r);return!1}function $o(r,t){return Ce(r.prev,r,r.next)<0?Ce(r,t,r.next)>=0&&Ce(r,r.prev,t)>=0:Ce(r,t,r.prev)<0||Ce(r,r.next,t)<0}function Yy(r,t){let e=r,n=!1,i=(r.x+t.x)/2,s=(r.y+t.y)/2;do e.y>s!=e.next.y>s&&e.next.y!==e.y&&i<(e.next.x-e.x)*(s-e.y)/(e.next.y-e.y)+e.x&&(n=!n),e=e.next;while(e!==r);return n}function d0(r,t){let e=Of(r.i,r.x,r.y),n=Of(t.i,t.x,t.y),i=r.next,s=t.prev;return r.next=t,t.prev=r,e.next=i,i.prev=e,n.next=e,e.prev=n,s.next=n,n.prev=s,n}function qm(r,t,e,n){let i=Of(r,t,e);return n?(i.next=n.next,i.prev=n,n.next.prev=i,n.next=i):(i.prev=i,i.next=i),i}function Zo(r){r.next.prev=r.prev,r.prev.next=r.next,r.prevZ&&(r.prevZ.nextZ=r.nextZ),r.nextZ&&(r.nextZ.prevZ=r.prevZ)}function Of(r,t,e){return{i:r,x:t,y:e,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function $y(r,t,e,n){let i=0;for(let s=t,o=e-n;s<e;s+=n)i+=(r[o]-r[s])*(r[s+1]+r[o+1]),o=s;return i}var zf=class{static triangulate(t,e,n=2){return Dy(t,e,n)}},qn=class r{static area(t){let e=t.length,n=0;for(let i=e-1,s=0;s<e;i=s++)n+=t[i].x*t[s].y-t[s].x*t[i].y;return n*.5}static isClockWise(t){return r.area(t)<0}static triangulateShape(t,e){let n=[],i=[],s=[];Ym(t),$m(n,t);let o=t.length;e.forEach(Ym);for(let c=0;c<e.length;c++)i.push(o),o+=e[c].length,$m(n,e[c]);let a=zf.triangulate(n,i);for(let c=0;c<a.length;c+=3)s.push(a.slice(c,c+3));return s}};function Ym(r){let t=r.length;t>2&&r[t-1].equals(r[0])&&r.pop()}function $m(r,t){for(let e=0;e<t.length;e++)r.push(t[e].x),r.push(t[e].y)}var rl=class r extends Ft{constructor(t=new _i([new q(.5,.5),new q(-.5,.5),new q(-.5,-.5),new q(.5,-.5)]),e={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:t,options:e},t=Array.isArray(t)?t:[t];let n=this,i=[],s=[];for(let a=0,c=t.length;a<c;a++){let l=t[a];o(l)}this.setAttribute("position",new bt(i,3)),this.setAttribute("uv",new bt(s,2)),this.computeVertexNormals();function o(a){let c=[],l=e.curveSegments!==void 0?e.curveSegments:12,f=e.steps!==void 0?e.steps:1,h=e.depth!==void 0?e.depth:1,u=e.bevelEnabled!==void 0?e.bevelEnabled:!0,d=e.bevelThickness!==void 0?e.bevelThickness:.2,g=e.bevelSize!==void 0?e.bevelSize:d-.1,x=e.bevelOffset!==void 0?e.bevelOffset:0,p=e.bevelSegments!==void 0?e.bevelSegments:3,m=e.extrudePath,v=e.UVGenerator!==void 0?e.UVGenerator:Zy,_,y=!1,b,T,w,E;m&&(_=m.getSpacedPoints(f),y=!0,u=!1,b=m.computeFrenetFrames(f,!1),T=new R,w=new R,E=new R),u||(p=0,d=0,g=0,x=0);let M=a.extractPoints(l),S=M.shape,I=M.holes;if(!qn.isClockWise(S)){S=S.reverse();for(let nt=0,K=I.length;nt<K;nt++){let J=I[nt];qn.isClockWise(J)&&(I[nt]=J.reverse())}}function L(nt){let J=10000000000000001e-36,Z=nt[0];for(let ut=1;ut<=nt.length;ut++){let it=ut%nt.length,ht=nt[it],qt=ht.x-Z.x,Wt=ht.y-Z.y,D=qt*qt+Wt*Wt,A=Math.max(Math.abs(ht.x),Math.abs(ht.y),Math.abs(Z.x),Math.abs(Z.y)),k=J*A*A;if(D<=k){nt.splice(it,1),ut--;continue}Z=ht}}L(S),I.forEach(L);let N=I.length,z=S;for(let nt=0;nt<N;nt++){let K=I[nt];S=S.concat(K)}function V(nt,K,J){return K||console.error("THREE.ExtrudeGeometry: vec does not exist"),nt.clone().addScaledVector(K,J)}let j=S.length;function W(nt,K,J){let Z,ut,it,ht=nt.x-K.x,qt=nt.y-K.y,Wt=J.x-nt.x,D=J.y-nt.y,A=ht*ht+qt*qt,k=ht*D-qt*Wt;if(Math.abs(k)>Number.EPSILON){let X=Math.sqrt(A),et=Math.sqrt(Wt*Wt+D*D),Y=K.x-qt/X,It=K.y+ht/X,lt=J.x-D/et,Et=J.y+Wt/et,Rt=((lt-Y)*D-(Et-It)*Wt)/(ht*D-qt*Wt);Z=Y+ht*Rt-nt.x,ut=It+qt*Rt-nt.y;let rt=Z*Z+ut*ut;if(rt<=2)return new q(Z,ut);it=Math.sqrt(rt/2)}else{let X=!1;ht>Number.EPSILON?Wt>Number.EPSILON&&(X=!0):ht<-Number.EPSILON?Wt<-Number.EPSILON&&(X=!0):Math.sign(qt)===Math.sign(D)&&(X=!0),X?(Z=-qt,ut=ht,it=Math.sqrt(A)):(Z=ht,ut=qt,it=Math.sqrt(A/2))}return new q(Z/it,ut/it)}let ct=[];for(let nt=0,K=z.length,J=K-1,Z=nt+1;nt<K;nt++,J++,Z++)J===K&&(J=0),Z===K&&(Z=0),ct[nt]=W(z[nt],z[J],z[Z]);let pt=[],_t,Ht=ct.concat();for(let nt=0,K=N;nt<K;nt++){let J=I[nt];_t=[];for(let Z=0,ut=J.length,it=ut-1,ht=Z+1;Z<ut;Z++,it++,ht++)it===ut&&(it=0),ht===ut&&(ht=0),_t[Z]=W(J[Z],J[it],J[ht]);pt.push(_t),Ht=Ht.concat(_t)}let ee;if(p===0)ee=qn.triangulateShape(z,I);else{let nt=[],K=[];for(let J=0;J<p;J++){let Z=J/p,ut=d*Math.cos(Z*Math.PI/2),it=g*Math.sin(Z*Math.PI/2)+x;for(let ht=0,qt=z.length;ht<qt;ht++){let Wt=V(z[ht],ct[ht],it);Pt(Wt.x,Wt.y,-ut),Z===0&&nt.push(Wt)}for(let ht=0,qt=N;ht<qt;ht++){let Wt=I[ht];_t=pt[ht];let D=[];for(let A=0,k=Wt.length;A<k;A++){let X=V(Wt[A],_t[A],it);Pt(X.x,X.y,-ut),Z===0&&D.push(X)}Z===0&&K.push(D)}}ee=qn.triangulateShape(nt,K)}let he=ee.length,Qt=g+x;for(let nt=0;nt<j;nt++){let K=u?V(S[nt],Ht[nt],Qt):S[nt];y?(w.copy(b.normals[0]).multiplyScalar(K.x),T.copy(b.binormals[0]).multiplyScalar(K.y),E.copy(_[0]).add(w).add(T),Pt(E.x,E.y,E.z)):Pt(K.x,K.y,0)}for(let nt=1;nt<=f;nt++)for(let K=0;K<j;K++){let J=u?V(S[K],Ht[K],Qt):S[K];y?(w.copy(b.normals[nt]).multiplyScalar(J.x),T.copy(b.binormals[nt]).multiplyScalar(J.y),E.copy(_[nt]).add(w).add(T),Pt(E.x,E.y,E.z)):Pt(J.x,J.y,h/f*nt)}for(let nt=p-1;nt>=0;nt--){let K=nt/p,J=d*Math.cos(K*Math.PI/2),Z=g*Math.sin(K*Math.PI/2)+x;for(let ut=0,it=z.length;ut<it;ut++){let ht=V(z[ut],ct[ut],Z);Pt(ht.x,ht.y,h+J)}for(let ut=0,it=I.length;ut<it;ut++){let ht=I[ut];_t=pt[ut];for(let qt=0,Wt=ht.length;qt<Wt;qt++){let D=V(ht[qt],_t[qt],Z);y?Pt(D.x,D.y+_[f-1].y,_[f-1].x+J):Pt(D.x,D.y,h+J)}}}$(),tt();function $(){let nt=i.length/3;if(u){let K=0,J=j*K;for(let Z=0;Z<he;Z++){let ut=ee[Z];wt(ut[2]+J,ut[1]+J,ut[0]+J)}K=f+p*2,J=j*K;for(let Z=0;Z<he;Z++){let ut=ee[Z];wt(ut[0]+J,ut[1]+J,ut[2]+J)}}else{for(let K=0;K<he;K++){let J=ee[K];wt(J[2],J[1],J[0])}for(let K=0;K<he;K++){let J=ee[K];wt(J[0]+j*f,J[1]+j*f,J[2]+j*f)}}n.addGroup(nt,i.length/3-nt,0)}function tt(){let nt=i.length/3,K=0;St(z,K),K+=z.length;for(let J=0,Z=I.length;J<Z;J++){let ut=I[J];St(ut,K),K+=ut.length}n.addGroup(nt,i.length/3-nt,1)}function St(nt,K){let J=nt.length;for(;--J>=0;){let Z=J,ut=J-1;ut<0&&(ut=nt.length-1);for(let it=0,ht=f+p*2;it<ht;it++){let qt=j*it,Wt=j*(it+1),D=K+Z+qt,A=K+ut+qt,k=K+ut+Wt,X=K+Z+Wt;te(D,A,k,X)}}}function Pt(nt,K,J){c.push(nt),c.push(K),c.push(J)}function wt(nt,K,J){fe(nt),fe(K),fe(J);let Z=i.length/3,ut=v.generateTopUV(n,i,Z-3,Z-2,Z-1);F(ut[0]),F(ut[1]),F(ut[2])}function te(nt,K,J,Z){fe(nt),fe(K),fe(Z),fe(K),fe(J),fe(Z);let ut=i.length/3,it=v.generateSideWallUV(n,i,ut-6,ut-3,ut-2,ut-1);F(it[0]),F(it[1]),F(it[3]),F(it[1]),F(it[2]),F(it[3])}function fe(nt){i.push(c[nt*3+0]),i.push(c[nt*3+1]),i.push(c[nt*3+2])}function F(nt){s.push(nt.x),s.push(nt.y)}}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){let t=super.toJSON(),e=this.parameters.shapes,n=this.parameters.options;return Jy(e,n,t)}static fromJSON(t,e){let n=[];for(let s=0,o=t.shapes.length;s<o;s++){let a=e[t.shapes[s]];n.push(a)}let i=t.options.extrudePath;return i!==void 0&&(t.options.extrudePath=new nl[i.type]().fromJSON(i)),new r(n,t.options)}},Zy={generateTopUV:function(r,t,e,n,i){let s=t[e*3],o=t[e*3+1],a=t[n*3],c=t[n*3+1],l=t[i*3],f=t[i*3+1];return[new q(s,o),new q(a,c),new q(l,f)]},generateSideWallUV:function(r,t,e,n,i,s){let o=t[e*3],a=t[e*3+1],c=t[e*3+2],l=t[n*3],f=t[n*3+1],h=t[n*3+2],u=t[i*3],d=t[i*3+1],g=t[i*3+2],x=t[s*3],p=t[s*3+1],m=t[s*3+2];return Math.abs(a-f)<Math.abs(o-l)?[new q(o,1-c),new q(l,1-h),new q(u,1-g),new q(x,1-m)]:[new q(a,1-c),new q(f,1-h),new q(d,1-g),new q(p,1-m)]}};function Jy(r,t,e){if(e.shapes=[],Array.isArray(r))for(let n=0,i=r.length;n<i;n++){let s=r[n];e.shapes.push(s.uuid)}else e.shapes.push(r.uuid);return e.options=Object.assign({},t),t.extrudePath!==void 0&&(e.options.extrudePath=t.extrudePath.toJSON()),e}var sl=class r extends zi{constructor(t=1,e=0){let n=(1+Math.sqrt(5))/2,i=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],s=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(i,s,t,e),this.type="IcosahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new r(t.radius,t.detail)}},ol=class r extends Ft{constructor(t=[new q(0,-.5),new q(.5,0),new q(0,.5)],e=12,n=0,i=Math.PI*2){super(),this.type="LatheGeometry",this.parameters={points:t,segments:e,phiStart:n,phiLength:i},e=Math.floor(e),i=Bt(i,0,Math.PI*2);let s=[],o=[],a=[],c=[],l=[],f=1/e,h=new R,u=new q,d=new R,g=new R,x=new R,p=0,m=0;for(let v=0;v<=t.length-1;v++)switch(v){case 0:p=t[v+1].x-t[v].x,m=t[v+1].y-t[v].y,d.x=m*1,d.y=-p,d.z=m*0,x.copy(d),d.normalize(),c.push(d.x,d.y,d.z);break;case t.length-1:c.push(x.x,x.y,x.z);break;default:p=t[v+1].x-t[v].x,m=t[v+1].y-t[v].y,d.x=m*1,d.y=-p,d.z=m*0,g.copy(d),d.x+=x.x,d.y+=x.y,d.z+=x.z,d.normalize(),c.push(d.x,d.y,d.z),x.copy(g)}for(let v=0;v<=e;v++){let _=n+v*f*i,y=Math.sin(_),b=Math.cos(_);for(let T=0;T<=t.length-1;T++){h.x=t[T].x*y,h.y=t[T].y,h.z=t[T].x*b,o.push(h.x,h.y,h.z),u.x=v/e,u.y=T/(t.length-1),a.push(u.x,u.y);let w=c[3*T+0]*y,E=c[3*T+1],M=c[3*T+0]*b;l.push(w,E,M)}}for(let v=0;v<e;v++)for(let _=0;_<t.length-1;_++){let y=_+v*t.length,b=y,T=y+t.length,w=y+t.length+1,E=y+1;s.push(b,T,E),s.push(w,E,T)}this.setIndex(s),this.setAttribute("position",new bt(o,3)),this.setAttribute("uv",new bt(a,2)),this.setAttribute("normal",new bt(l,3))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.points,t.segments,t.phiStart,t.phiLength)}},Jo=class r extends zi{constructor(t=1,e=0){let n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],i=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,i,t,e),this.type="OctahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new r(t.radius,t.detail)}},Ps=class r extends Ft{constructor(t=1,e=1,n=1,i=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:n,heightSegments:i};let s=t/2,o=e/2,a=Math.floor(n),c=Math.floor(i),l=a+1,f=c+1,h=t/a,u=e/c,d=[],g=[],x=[],p=[];for(let m=0;m<f;m++){let v=m*u-o;for(let _=0;_<l;_++){let y=_*h-s;g.push(y,-v,0),x.push(0,0,1),p.push(_/a),p.push(1-m/c)}}for(let m=0;m<c;m++)for(let v=0;v<a;v++){let _=v+l*m,y=v+l*(m+1),b=v+1+l*(m+1),T=v+1+l*m;d.push(_,y,T),d.push(y,b,T)}this.setIndex(d),this.setAttribute("position",new bt(g,3)),this.setAttribute("normal",new bt(x,3)),this.setAttribute("uv",new bt(p,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.width,t.height,t.widthSegments,t.heightSegments)}},al=class r extends Ft{constructor(t=.5,e=1,n=32,i=1,s=0,o=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:t,outerRadius:e,thetaSegments:n,phiSegments:i,thetaStart:s,thetaLength:o},n=Math.max(3,n),i=Math.max(1,i);let a=[],c=[],l=[],f=[],h=t,u=(e-t)/i,d=new R,g=new q;for(let x=0;x<=i;x++){for(let p=0;p<=n;p++){let m=s+p/n*o;d.x=h*Math.cos(m),d.y=h*Math.sin(m),c.push(d.x,d.y,d.z),l.push(0,0,1),g.x=(d.x/e+1)/2,g.y=(d.y/e+1)/2,f.push(g.x,g.y)}h+=u}for(let x=0;x<i;x++){let p=x*(n+1);for(let m=0;m<n;m++){let v=m+p,_=v,y=v+n+1,b=v+n+2,T=v+1;a.push(_,y,T),a.push(y,b,T)}}this.setIndex(a),this.setAttribute("position",new bt(c,3)),this.setAttribute("normal",new bt(l,3)),this.setAttribute("uv",new bt(f,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.innerRadius,t.outerRadius,t.thetaSegments,t.phiSegments,t.thetaStart,t.thetaLength)}},cl=class r extends Ft{constructor(t=new _i([new q(0,.5),new q(-.5,-.5),new q(.5,-.5)]),e=12){super(),this.type="ShapeGeometry",this.parameters={shapes:t,curveSegments:e};let n=[],i=[],s=[],o=[],a=0,c=0;if(Array.isArray(t)===!1)l(t);else for(let f=0;f<t.length;f++)l(t[f]),this.addGroup(a,c,f),a+=c,c=0;this.setIndex(n),this.setAttribute("position",new bt(i,3)),this.setAttribute("normal",new bt(s,3)),this.setAttribute("uv",new bt(o,2));function l(f){let h=i.length/3,u=f.extractPoints(e),d=u.shape,g=u.holes;qn.isClockWise(d)===!1&&(d=d.reverse());for(let p=0,m=g.length;p<m;p++){let v=g[p];qn.isClockWise(v)===!0&&(g[p]=v.reverse())}let x=qn.triangulateShape(d,g);for(let p=0,m=g.length;p<m;p++){let v=g[p];d=d.concat(v)}for(let p=0,m=d.length;p<m;p++){let v=d[p];i.push(v.x,v.y,0),s.push(0,0,1),o.push(v.x,v.y)}for(let p=0,m=x.length;p<m;p++){let v=x[p],_=v[0]+h,y=v[1]+h,b=v[2]+h;n.push(_,y,b),c+=3}}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){let t=super.toJSON(),e=this.parameters.shapes;return Ky(e,t)}static fromJSON(t,e){let n=[];for(let i=0,s=t.shapes.length;i<s;i++){let o=e[t.shapes[i]];n.push(o)}return new r(n,t.curveSegments)}};function Ky(r,t){if(t.shapes=[],Array.isArray(r))for(let e=0,n=r.length;e<n;e++){let i=r[e];t.shapes.push(i.uuid)}else t.shapes.push(r.uuid);return t}var Ko=class r extends Ft{constructor(t=1,e=32,n=16,i=0,s=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:n,phiStart:i,phiLength:s,thetaStart:o,thetaLength:a},e=Math.max(3,Math.floor(e)),n=Math.max(2,Math.floor(n));let c=Math.min(o+a,Math.PI),l=0,f=[],h=new R,u=new R,d=[],g=[],x=[],p=[];for(let m=0;m<=n;m++){let v=[],_=m/n,y=0;m===0&&o===0?y=.5/e:m===n&&c===Math.PI&&(y=-.5/e);for(let b=0;b<=e;b++){let T=b/e;h.x=-t*Math.cos(i+T*s)*Math.sin(o+_*a),h.y=t*Math.cos(o+_*a),h.z=t*Math.sin(i+T*s)*Math.sin(o+_*a),g.push(h.x,h.y,h.z),u.copy(h).normalize(),x.push(u.x,u.y,u.z),p.push(T+y,1-_),v.push(l++)}f.push(v)}for(let m=0;m<n;m++)for(let v=0;v<e;v++){let _=f[m][v+1],y=f[m][v],b=f[m+1][v],T=f[m+1][v+1];(m!==0||o>0)&&d.push(_,y,T),(m!==n-1||c<Math.PI)&&d.push(y,b,T)}this.setIndex(d),this.setAttribute("position",new bt(g,3)),this.setAttribute("normal",new bt(x,3)),this.setAttribute("uv",new bt(p,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}},ll=class r extends zi{constructor(t=1,e=0){let n=[1,1,1,-1,-1,1,-1,1,-1,1,-1,-1],i=[2,1,0,0,3,2,1,3,0,2,3,1];super(n,i,t,e),this.type="TetrahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new r(t.radius,t.detail)}},ul=class r extends Ft{constructor(t=1,e=.4,n=12,i=48,s=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:t,tube:e,radialSegments:n,tubularSegments:i,arc:s},n=Math.floor(n),i=Math.floor(i);let o=[],a=[],c=[],l=[],f=new R,h=new R,u=new R;for(let d=0;d<=n;d++)for(let g=0;g<=i;g++){let x=g/i*s,p=d/n*Math.PI*2;h.x=(t+e*Math.cos(p))*Math.cos(x),h.y=(t+e*Math.cos(p))*Math.sin(x),h.z=e*Math.sin(p),a.push(h.x,h.y,h.z),f.x=t*Math.cos(x),f.y=t*Math.sin(x),u.subVectors(h,f).normalize(),c.push(u.x,u.y,u.z),l.push(g/i),l.push(d/n)}for(let d=1;d<=n;d++)for(let g=1;g<=i;g++){let x=(i+1)*d+g-1,p=(i+1)*(d-1)+g-1,m=(i+1)*(d-1)+g,v=(i+1)*d+g;o.push(x,p,v),o.push(p,m,v)}this.setIndex(o),this.setAttribute("position",new bt(a,3)),this.setAttribute("normal",new bt(c,3)),this.setAttribute("uv",new bt(l,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc)}},hl=class r extends Ft{constructor(t=1,e=.4,n=64,i=8,s=2,o=3){super(),this.type="TorusKnotGeometry",this.parameters={radius:t,tube:e,tubularSegments:n,radialSegments:i,p:s,q:o},n=Math.floor(n),i=Math.floor(i);let a=[],c=[],l=[],f=[],h=new R,u=new R,d=new R,g=new R,x=new R,p=new R,m=new R;for(let _=0;_<=n;++_){let y=_/n*s*Math.PI*2;v(y,s,o,t,d),v(y+.01,s,o,t,g),p.subVectors(g,d),m.addVectors(g,d),x.crossVectors(p,m),m.crossVectors(x,p),x.normalize(),m.normalize();for(let b=0;b<=i;++b){let T=b/i*Math.PI*2,w=-e*Math.cos(T),E=e*Math.sin(T);h.x=d.x+(w*m.x+E*x.x),h.y=d.y+(w*m.y+E*x.y),h.z=d.z+(w*m.z+E*x.z),c.push(h.x,h.y,h.z),u.subVectors(h,d).normalize(),l.push(u.x,u.y,u.z),f.push(_/n),f.push(b/i)}}for(let _=1;_<=n;_++)for(let y=1;y<=i;y++){let b=(i+1)*(_-1)+(y-1),T=(i+1)*_+(y-1),w=(i+1)*_+y,E=(i+1)*(_-1)+y;a.push(b,T,E),a.push(T,w,E)}this.setIndex(a),this.setAttribute("position",new bt(c,3)),this.setAttribute("normal",new bt(l,3)),this.setAttribute("uv",new bt(f,2));function v(_,y,b,T,w){let E=Math.cos(_),M=Math.sin(_),S=b/y*_,I=Math.cos(S);w.x=T*(2+I)*.5*E,w.y=T*(2+I)*M*.5,w.z=T*Math.sin(S)*.5}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new r(t.radius,t.tube,t.tubularSegments,t.radialSegments,t.p,t.q)}},fl=class r extends Ft{constructor(t=new Xo(new R(-1,-1,0),new R(-1,1,0),new R(1,1,0)),e=64,n=1,i=8,s=!1){super(),this.type="TubeGeometry",this.parameters={path:t,tubularSegments:e,radius:n,radialSegments:i,closed:s};let o=t.computeFrenetFrames(e,s);this.tangents=o.tangents,this.normals=o.normals,this.binormals=o.binormals;let a=new R,c=new R,l=new q,f=new R,h=[],u=[],d=[],g=[];x(),this.setIndex(g),this.setAttribute("position",new bt(h,3)),this.setAttribute("normal",new bt(u,3)),this.setAttribute("uv",new bt(d,2));function x(){for(let _=0;_<e;_++)p(_);p(s===!1?e:0),v(),m()}function p(_){f=t.getPointAt(_/e,f);let y=o.normals[_],b=o.binormals[_];for(let T=0;T<=i;T++){let w=T/i*Math.PI*2,E=Math.sin(w),M=-Math.cos(w);c.x=M*y.x+E*b.x,c.y=M*y.y+E*b.y,c.z=M*y.z+E*b.z,c.normalize(),u.push(c.x,c.y,c.z),a.x=f.x+n*c.x,a.y=f.y+n*c.y,a.z=f.z+n*c.z,h.push(a.x,a.y,a.z)}}function m(){for(let _=1;_<=e;_++)for(let y=1;y<=i;y++){let b=(i+1)*(_-1)+(y-1),T=(i+1)*_+(y-1),w=(i+1)*_+y,E=(i+1)*(_-1)+y;g.push(b,T,E),g.push(T,w,E)}}function v(){for(let _=0;_<=e;_++)for(let y=0;y<=i;y++)l.x=_/e,l.y=y/i,d.push(l.x,l.y)}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){let t=super.toJSON();return t.path=this.parameters.path.toJSON(),t}static fromJSON(t){return new r(new nl[t.path.type]().fromJSON(t.path),t.tubularSegments,t.radius,t.radialSegments,t.closed)}},dl=class extends Ft{constructor(t=null){if(super(),this.type="WireframeGeometry",this.parameters={geometry:t},t!==null){let e=[],n=new Set,i=new R,s=new R;if(t.index!==null){let o=t.attributes.position,a=t.index,c=t.groups;c.length===0&&(c=[{start:0,count:a.count,materialIndex:0}]);for(let l=0,f=c.length;l<f;++l){let h=c[l],u=h.start,d=h.count;for(let g=u,x=u+d;g<x;g+=3)for(let p=0;p<3;p++){let m=a.getX(g+p),v=a.getX(g+(p+1)%3);i.fromBufferAttribute(o,m),s.fromBufferAttribute(o,v),Zm(i,s,n)===!0&&(e.push(i.x,i.y,i.z),e.push(s.x,s.y,s.z))}}}else{let o=t.attributes.position;for(let a=0,c=o.count/3;a<c;a++)for(let l=0;l<3;l++){let f=3*a+l,h=3*a+(l+1)%3;i.fromBufferAttribute(o,f),s.fromBufferAttribute(o,h),Zm(i,s,n)===!0&&(e.push(i.x,i.y,i.z),e.push(s.x,s.y,s.z))}}this.setAttribute("position",new bt(e,3))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}};function Zm(r,t,e){let n=`${r.x},${r.y},${r.z}-${t.x},${t.y},${t.z}`,i=`${t.x},${t.y},${t.z}-${r.x},${r.y},${r.z}`;return e.has(n)===!0||e.has(i)===!0?!1:(e.add(n),e.add(i),!0)}var Jm=Object.freeze({__proto__:null,BoxGeometry:Sr,CapsuleGeometry:$c,CircleGeometry:Zc,ConeGeometry:Vo,CylinderGeometry:ko,DodecahedronGeometry:Jc,EdgesGeometry:Kc,ExtrudeGeometry:rl,IcosahedronGeometry:sl,LatheGeometry:ol,OctahedronGeometry:Jo,PlaneGeometry:Ps,PolyhedronGeometry:zi,RingGeometry:al,ShapeGeometry:cl,SphereGeometry:Ko,TetrahedronGeometry:ll,TorusGeometry:ul,TorusKnotGeometry:hl,TubeGeometry:fl,WireframeGeometry:dl}),pl=class extends Je{constructor(t){super(),this.isShadowMaterial=!0,this.type="ShadowMaterial",this.color=new ft(0),this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.fog=t.fog,this}},ml=class extends Ue{constructor(t){super(t),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},Qo=class extends Je{constructor(t){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new ft(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new ft(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=qi,this.normalScale=new q(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new In,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}},gl=class extends Qo{constructor(t){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new q(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Bt(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(e){this.ior=(1+.4*e)/(1-.4*e)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new ft(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new ft(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new ft(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(t)}get anisotropy(){return this._anisotropy}set anisotropy(t){this._anisotropy>0!=t>0&&this.version++,this._anisotropy=t}get clearcoat(){return this._clearcoat}set clearcoat(t){this._clearcoat>0!=t>0&&this.version++,this._clearcoat=t}get iridescence(){return this._iridescence}set iridescence(t){this._iridescence>0!=t>0&&this.version++,this._iridescence=t}get dispersion(){return this._dispersion}set dispersion(t){this._dispersion>0!=t>0&&this.version++,this._dispersion=t}get sheen(){return this._sheen}set sheen(t){this._sheen>0!=t>0&&this.version++,this._sheen=t}get transmission(){return this._transmission}set transmission(t){this._transmission>0!=t>0&&this.version++,this._transmission=t}copy(t){return super.copy(t),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=t.anisotropy,this.anisotropyRotation=t.anisotropyRotation,this.anisotropyMap=t.anisotropyMap,this.clearcoat=t.clearcoat,this.clearcoatMap=t.clearcoatMap,this.clearcoatRoughness=t.clearcoatRoughness,this.clearcoatRoughnessMap=t.clearcoatRoughnessMap,this.clearcoatNormalMap=t.clearcoatNormalMap,this.clearcoatNormalScale.copy(t.clearcoatNormalScale),this.dispersion=t.dispersion,this.ior=t.ior,this.iridescence=t.iridescence,this.iridescenceMap=t.iridescenceMap,this.iridescenceIOR=t.iridescenceIOR,this.iridescenceThicknessRange=[...t.iridescenceThicknessRange],this.iridescenceThicknessMap=t.iridescenceThicknessMap,this.sheen=t.sheen,this.sheenColor.copy(t.sheenColor),this.sheenColorMap=t.sheenColorMap,this.sheenRoughness=t.sheenRoughness,this.sheenRoughnessMap=t.sheenRoughnessMap,this.transmission=t.transmission,this.transmissionMap=t.transmissionMap,this.thickness=t.thickness,this.thicknessMap=t.thicknessMap,this.attenuationDistance=t.attenuationDistance,this.attenuationColor.copy(t.attenuationColor),this.specularIntensity=t.specularIntensity,this.specularIntensityMap=t.specularIntensityMap,this.specularColor.copy(t.specularColor),this.specularColorMap=t.specularColorMap,this}},xl=class extends Je{constructor(t){super(),this.isMeshPhongMaterial=!0,this.type="MeshPhongMaterial",this.color=new ft(16777215),this.specular=new ft(1118481),this.shininess=30,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new ft(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=qi,this.normalScale=new q(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new In,this.combine=ua,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.specular.copy(t.specular),this.shininess=t.shininess,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}},vl=class extends Je{constructor(t){super(),this.isMeshToonMaterial=!0,this.defines={TOON:""},this.type="MeshToonMaterial",this.color=new ft(16777215),this.map=null,this.gradientMap=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new ft(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=qi,this.normalScale=new q(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.alphaMap=null,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.gradientMap=t.gradientMap,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.alphaMap=t.alphaMap,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}},_l=class extends Je{constructor(t){super(),this.isMeshNormalMaterial=!0,this.type="MeshNormalMaterial",this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=qi,this.normalScale=new q(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.flatShading=!1,this.setValues(t)}copy(t){return super.copy(t),this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.flatShading=t.flatShading,this}},yl=class extends Je{constructor(t){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new ft(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new ft(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=qi,this.normalScale=new q(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new In,this.combine=ua,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}},jo=class extends Je{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Zg,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}},ta=class extends Je{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}},bl=class extends Je{constructor(t){super(),this.isMeshMatcapMaterial=!0,this.defines={MATCAP:""},this.type="MeshMatcapMaterial",this.color=new ft(16777215),this.matcap=null,this.map=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=qi,this.normalScale=new q(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.alphaMap=null,this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={MATCAP:""},this.color.copy(t.color),this.matcap=t.matcap,this.map=t.map,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.alphaMap=t.alphaMap,this.flatShading=t.flatShading,this.fog=t.fog,this}},Sl=class extends Qe{constructor(t){super(),this.isLineDashedMaterial=!0,this.type="LineDashedMaterial",this.scale=1,this.dashSize=3,this.gapSize=1,this.setValues(t)}copy(t){return super.copy(t),this.scale=t.scale,this.dashSize=t.dashSize,this.gapSize=t.gapSize,this}};function xr(r,t){return!r||r.constructor===t?r:typeof t.BYTES_PER_ELEMENT=="number"?new t(r):Array.prototype.slice.call(r)}function p0(r){return ArrayBuffer.isView(r)&&!(r instanceof DataView)}function m0(r){function t(i,s){return r[i]-r[s]}let e=r.length,n=new Array(e);for(let i=0;i!==e;++i)n[i]=i;return n.sort(t),n}function kf(r,t,e){let n=r.length,i=new r.constructor(n);for(let s=0,o=0;o!==n;++s){let a=e[s]*t;for(let c=0;c!==t;++c)i[o++]=r[a+c]}return i}function Kd(r,t,e,n){let i=1,s=r[0];for(;s!==void 0&&s[n]===void 0;)s=r[i++];if(s===void 0)return;let o=s[n];if(o!==void 0)if(Array.isArray(o))do o=s[n],o!==void 0&&(t.push(s.time),e.push(...o)),s=r[i++];while(s!==void 0);else if(o.toArray!==void 0)do o=s[n],o!==void 0&&(t.push(s.time),o.toArray(e,e.length)),s=r[i++];while(s!==void 0);else do o=s[n],o!==void 0&&(t.push(s.time),e.push(o)),s=r[i++];while(s!==void 0)}function Qy(r,t,e,n,i=30){let s=r.clone();s.name=t;let o=[];for(let c=0;c<s.tracks.length;++c){let l=s.tracks[c],f=l.getValueSize(),h=[],u=[];for(let d=0;d<l.times.length;++d){let g=l.times[d]*i;if(!(g<e||g>=n)){h.push(l.times[d]);for(let x=0;x<f;++x)u.push(l.values[d*f+x])}}h.length!==0&&(l.times=xr(h,l.times.constructor),l.values=xr(u,l.values.constructor),o.push(l))}s.tracks=o;let a=1/0;for(let c=0;c<s.tracks.length;++c)a>s.tracks[c].times[0]&&(a=s.tracks[c].times[0]);for(let c=0;c<s.tracks.length;++c)s.tracks[c].shift(-1*a);return s.resetDuration(),s}function jy(r,t=0,e=r,n=30){n<=0&&(n=30);let i=e.tracks.length,s=t/n;for(let o=0;o<i;++o){let a=e.tracks[o],c=a.ValueTypeName;if(c==="bool"||c==="string")continue;let l=r.tracks.find(function(m){return m.name===a.name&&m.ValueTypeName===c});if(l===void 0)continue;let f=0,h=a.getValueSize();a.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline&&(f=h/3);let u=0,d=l.getValueSize();l.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline&&(u=d/3);let g=a.times.length-1,x;if(s<=a.times[0]){let m=f,v=h-f;x=a.values.slice(m,v)}else if(s>=a.times[g]){let m=g*h+f,v=m+h-f;x=a.values.slice(m,v)}else{let m=a.createInterpolant(),v=f,_=h-f;m.evaluate(s),x=m.resultBuffer.slice(v,_)}c==="quaternion"&&new Ze().fromArray(x).normalize().conjugate().toArray(x);let p=l.times.length;for(let m=0;m<p;++m){let v=m*d+u;if(c==="quaternion")Ze.multiplyQuaternionsFlat(l.values,v,x,0,l.values,v);else{let _=d-u*2;for(let y=0;y<_;++y)l.values[v+y]-=x[y]}}}return r.blendMode=Wd,r}var Vf=class{static convertArray(t,e){return xr(t,e)}static isTypedArray(t){return p0(t)}static getKeyframeOrder(t){return m0(t)}static sortedArray(t,e,n){return kf(t,e,n)}static flattenJSON(t,e,n,i){Kd(t,e,n,i)}static subclip(t,e,n,i,s=30){return Qy(t,e,n,i,s)}static makeClipAdditive(t,e=0,n=t,i=30){return jy(t,e,n,i)}},Ar=class{constructor(t,e,n,i){this.parameterPositions=t,this._cachedIndex=0,this.resultBuffer=i!==void 0?i:new e.constructor(n),this.sampleValues=e,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(t){let e=this.parameterPositions,n=this._cachedIndex,i=e[n],s=e[n-1];t:{e:{let o;n:{i:if(!(t<i)){for(let a=n+2;;){if(i===void 0){if(t<s)break i;return n=e.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(s=i,i=e[++n],t<i)break e}o=e.length;break n}if(!(t>=s)){let a=e[1];t<a&&(n=2,s=a);for(let c=n-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===c)break;if(i=s,s=e[--n-1],t>=s)break e}o=n,n=0;break n}break t}for(;n<o;){let a=n+o>>>1;t<e[a]?o=a:n=a+1}if(i=e[n],s=e[n-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===void 0)return n=e.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,s,i)}return this.interpolate_(n,s,t,i)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(t){let e=this.resultBuffer,n=this.sampleValues,i=this.valueSize,s=t*i;for(let o=0;o!==i;++o)e[o]=n[s+o];return e}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Ml=class extends Ar{constructor(t,e,n,i){super(t,e,n,i),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:mr,endingEnd:mr}}intervalChanged_(t,e,n){let i=this.parameterPositions,s=t-2,o=t+1,a=i[s],c=i[o];if(a===void 0)switch(this.getSettings_().endingStart){case gr:s=t,a=2*e-n;break;case Ro:s=i.length-2,a=e+i[s]-i[s+1];break;default:s=t,a=n}if(c===void 0)switch(this.getSettings_().endingEnd){case gr:o=t,c=2*n-e;break;case Ro:o=1,c=n+i[1]-i[0];break;default:o=t-1,c=e}let l=(n-e)*.5,f=this.valueSize;this._weightPrev=l/(e-a),this._weightNext=l/(c-n),this._offsetPrev=s*f,this._offsetNext=o*f}interpolate_(t,e,n,i){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=t*a,l=c-a,f=this._offsetPrev,h=this._offsetNext,u=this._weightPrev,d=this._weightNext,g=(n-e)/(i-e),x=g*g,p=x*g,m=-u*p+2*u*x-u*g,v=(1+u)*p+(-1.5-2*u)*x+(-.5+u)*g+1,_=(-1-d)*p+(1.5+d)*x+.5*g,y=d*p-d*x;for(let b=0;b!==a;++b)s[b]=m*o[f+b]+v*o[l+b]+_*o[c+b]+y*o[h+b];return s}},ea=class extends Ar{constructor(t,e,n,i){super(t,e,n,i)}interpolate_(t,e,n,i){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=t*a,l=c-a,f=(n-e)/(i-e),h=1-f;for(let u=0;u!==a;++u)s[u]=o[l+u]*h+o[c+u]*f;return s}},Tl=class extends Ar{constructor(t,e,n,i){super(t,e,n,i)}interpolate_(t){return this.copySampleValue_(t-1)}},bn=class{constructor(t,e,n,i){if(t===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(e===void 0||e.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+t);this.name=t,this.times=xr(e,this.TimeBufferType),this.values=xr(n,this.ValueBufferType),this.setInterpolation(i||this.DefaultInterpolation)}static toJSON(t){let e=t.constructor,n;if(e.toJSON!==this.toJSON)n=e.toJSON(t);else{n={name:t.name,times:xr(t.times,Array),values:xr(t.values,Array)};let i=t.getInterpolation();i!==t.DefaultInterpolation&&(n.interpolation=i)}return n.type=t.ValueTypeName,n}InterpolantFactoryMethodDiscrete(t){return new Tl(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodLinear(t){return new ea(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodSmooth(t){return new Ml(this.times,this.values,this.getValueSize(),t)}setInterpolation(t){let e;switch(t){case Eo:e=this.InterpolantFactoryMethodDiscrete;break;case Ic:e=this.InterpolantFactoryMethodLinear;break;case Ec:e=this.InterpolantFactoryMethodSmooth;break}if(e===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(t!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=e,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Eo;case this.InterpolantFactoryMethodLinear:return Ic;case this.InterpolantFactoryMethodSmooth:return Ec}}getValueSize(){return this.values.length/this.times.length}shift(t){if(t!==0){let e=this.times;for(let n=0,i=e.length;n!==i;++n)e[n]+=t}return this}scale(t){if(t!==1){let e=this.times;for(let n=0,i=e.length;n!==i;++n)e[n]*=t}return this}trim(t,e){let n=this.times,i=n.length,s=0,o=i-1;for(;s!==i&&n[s]<t;)++s;for(;o!==-1&&n[o]>e;)--o;if(++o,s!==0||o!==i){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=n.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let t=!0,e=this.getValueSize();e-Math.floor(e)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),t=!1);let n=this.times,i=this.values,s=n.length;s===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),t=!1);let o=null;for(let a=0;a!==s;a++){let c=n[a];if(typeof c=="number"&&isNaN(c)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,a,c),t=!1;break}if(o!==null&&o>c){console.error("THREE.KeyframeTrack: Out of order keys.",this,a,c,o),t=!1;break}o=c}if(i!==void 0&&p0(i))for(let a=0,c=i.length;a!==c;++a){let l=i[a];if(isNaN(l)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,a,l),t=!1;break}}return t}optimize(){let t=this.times.slice(),e=this.values.slice(),n=this.getValueSize(),i=this.getInterpolation()===Ec,s=t.length-1,o=1;for(let a=1;a<s;++a){let c=!1,l=t[a],f=t[a+1];if(l!==f&&(a!==1||l!==t[0]))if(i)c=!0;else{let h=a*n,u=h-n,d=h+n;for(let g=0;g!==n;++g){let x=e[h+g];if(x!==e[u+g]||x!==e[d+g]){c=!0;break}}}if(c){if(a!==o){t[o]=t[a];let h=a*n,u=o*n;for(let d=0;d!==n;++d)e[u+d]=e[h+d]}++o}}if(s>0){t[o]=t[s];for(let a=s*n,c=o*n,l=0;l!==n;++l)e[c+l]=e[a+l];++o}return o!==t.length?(this.times=t.slice(0,o),this.values=e.slice(0,o*n)):(this.times=t,this.values=e),this}clone(){let t=this.times.slice(),e=this.values.slice(),n=this.constructor,i=new n(this.name,t,e);return i.createInterpolant=this.createInterpolant,i}};bn.prototype.ValueTypeName="";bn.prototype.TimeBufferType=Float32Array;bn.prototype.ValueBufferType=Float32Array;bn.prototype.DefaultInterpolation=Ic;var yi=class extends bn{constructor(t,e,n){super(t,e,n)}};yi.prototype.ValueTypeName="bool";yi.prototype.ValueBufferType=Array;yi.prototype.DefaultInterpolation=Eo;yi.prototype.InterpolantFactoryMethodLinear=void 0;yi.prototype.InterpolantFactoryMethodSmooth=void 0;var na=class extends bn{constructor(t,e,n,i){super(t,e,n,i)}};na.prototype.ValueTypeName="color";var Er=class extends bn{constructor(t,e,n,i){super(t,e,n,i)}};Er.prototype.ValueTypeName="number";var wl=class extends Ar{constructor(t,e,n,i){super(t,e,n,i)}interpolate_(t,e,n,i){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=(n-e)/(i-e),l=t*a;for(let f=l+a;l!==f;l+=4)Ze.slerpFlat(s,0,o,l-a,o,l,c);return s}},Rr=class extends bn{constructor(t,e,n,i){super(t,e,n,i)}InterpolantFactoryMethodLinear(t){return new wl(this.times,this.values,this.getValueSize(),t)}};Rr.prototype.ValueTypeName="quaternion";Rr.prototype.InterpolantFactoryMethodSmooth=void 0;var bi=class extends bn{constructor(t,e,n){super(t,e,n)}};bi.prototype.ValueTypeName="string";bi.prototype.ValueBufferType=Array;bi.prototype.DefaultInterpolation=Eo;bi.prototype.InterpolantFactoryMethodLinear=void 0;bi.prototype.InterpolantFactoryMethodSmooth=void 0;var Cr=class extends bn{constructor(t,e,n,i){super(t,e,n,i)}};Cr.prototype.ValueTypeName="vector";var Ir=class{constructor(t="",e=-1,n=[],i=Mu){this.name=t,this.tracks=n,this.duration=e,this.blendMode=i,this.uuid=Cn(),this.userData={},this.duration<0&&this.resetDuration()}static parse(t){let e=[],n=t.tracks,i=1/(t.fps||1);for(let o=0,a=n.length;o!==a;++o)e.push(eb(n[o]).scale(i));let s=new this(t.name,t.duration,e,t.blendMode);return s.uuid=t.uuid,s.userData=JSON.parse(t.userData||"{}"),s}static toJSON(t){let e=[],n=t.tracks,i={name:t.name,duration:t.duration,tracks:e,uuid:t.uuid,blendMode:t.blendMode,userData:JSON.stringify(t.userData)};for(let s=0,o=n.length;s!==o;++s)e.push(bn.toJSON(n[s]));return i}static CreateFromMorphTargetSequence(t,e,n,i){let s=e.length,o=[];for(let a=0;a<s;a++){let c=[],l=[];c.push((a+s-1)%s,a,(a+1)%s),l.push(0,1,0);let f=m0(c);c=kf(c,1,f),l=kf(l,1,f),!i&&c[0]===0&&(c.push(s),l.push(l[0])),o.push(new Er(".morphTargetInfluences["+e[a].name+"]",c,l).scale(1/n))}return new this(t,-1,o)}static findByName(t,e){let n=t;if(!Array.isArray(t)){let i=t;n=i.geometry&&i.geometry.animations||i.animations}for(let i=0;i<n.length;i++)if(n[i].name===e)return n[i];return null}static CreateClipsFromMorphTargetSequences(t,e,n){let i={},s=/^([\w-]*?)([\d]+)$/;for(let a=0,c=t.length;a<c;a++){let l=t[a],f=l.name.match(s);if(f&&f.length>1){let h=f[1],u=i[h];u||(i[h]=u=[]),u.push(l)}}let o=[];for(let a in i)o.push(this.CreateFromMorphTargetSequence(a,i[a],e,n));return o}static parseAnimation(t,e){if(console.warn("THREE.AnimationClip: parseAnimation() is deprecated and will be removed with r185"),!t)return console.error("THREE.AnimationClip: No animation in JSONLoader data."),null;let n=function(h,u,d,g,x){if(d.length!==0){let p=[],m=[];Kd(d,p,m,g),p.length!==0&&x.push(new h(u,p,m))}},i=[],s=t.name||"default",o=t.fps||30,a=t.blendMode,c=t.length||-1,l=t.hierarchy||[];for(let h=0;h<l.length;h++){let u=l[h].keys;if(!(!u||u.length===0))if(u[0].morphTargets){let d={},g;for(g=0;g<u.length;g++)if(u[g].morphTargets)for(let x=0;x<u[g].morphTargets.length;x++)d[u[g].morphTargets[x]]=-1;for(let x in d){let p=[],m=[];for(let v=0;v!==u[g].morphTargets.length;++v){let _=u[g];p.push(_.time),m.push(_.morphTarget===x?1:0)}i.push(new Er(".morphTargetInfluence["+x+"]",p,m))}c=d.length*o}else{let d=".bones["+e[h].name+"]";n(Cr,d+".position",u,"pos",i),n(Rr,d+".quaternion",u,"rot",i),n(Cr,d+".scale",u,"scl",i)}}return i.length===0?null:new this(s,c,i,a)}resetDuration(){let t=this.tracks,e=0;for(let n=0,i=t.length;n!==i;++n){let s=this.tracks[n];e=Math.max(e,s.times[s.times.length-1])}return this.duration=e,this}trim(){for(let t=0;t<this.tracks.length;t++)this.tracks[t].trim(0,this.duration);return this}validate(){let t=!0;for(let e=0;e<this.tracks.length;e++)t=t&&this.tracks[e].validate();return t}optimize(){for(let t=0;t<this.tracks.length;t++)this.tracks[t].optimize();return this}clone(){let t=[];for(let n=0;n<this.tracks.length;n++)t.push(this.tracks[n].clone());let e=new this.constructor(this.name,this.duration,t,this.blendMode);return e.userData=JSON.parse(JSON.stringify(this.userData)),e}toJSON(){return this.constructor.toJSON(this)}};function tb(r){switch(r.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Er;case"vector":case"vector2":case"vector3":case"vector4":return Cr;case"color":return na;case"quaternion":return Rr;case"bool":case"boolean":return yi;case"string":return bi}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+r)}function eb(r){if(r.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");let t=tb(r.type);if(r.times===void 0){let e=[],n=[];Kd(r.keys,e,n,"value"),r.times=e,r.values=n}return t.parse!==void 0?t.parse(r):new t(r.name,r.times,r.values,r.interpolation)}var ni={enabled:!1,files:{},add:function(r,t){this.enabled!==!1&&(this.files[r]=t)},get:function(r){if(this.enabled!==!1)return this.files[r]},remove:function(r){delete this.files[r]},clear:function(){this.files={}}},ia=class{constructor(t,e,n){let i=this,s=!1,o=0,a=0,c,l=[];this.onStart=void 0,this.onLoad=t,this.onProgress=e,this.onError=n,this.abortController=new AbortController,this.itemStart=function(f){a++,s===!1&&i.onStart!==void 0&&i.onStart(f,o,a),s=!0},this.itemEnd=function(f){o++,i.onProgress!==void 0&&i.onProgress(f,o,a),o===a&&(s=!1,i.onLoad!==void 0&&i.onLoad())},this.itemError=function(f){i.onError!==void 0&&i.onError(f)},this.resolveURL=function(f){return c?c(f):f},this.setURLModifier=function(f){return c=f,this},this.addHandler=function(f,h){return l.push(f,h),this},this.removeHandler=function(f){let h=l.indexOf(f);return h!==-1&&l.splice(h,2),this},this.getHandler=function(f){for(let h=0,u=l.length;h<u;h+=2){let d=l[h],g=l[h+1];if(d.global&&(d.lastIndex=0),d.test(f))return g}return null},this.abort=function(){return this.abortController.abort(),this.abortController=new AbortController,this}}},g0=new ia,sn=class{constructor(t){this.manager=t!==void 0?t:g0,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(t,e){let n=this;return new Promise(function(i,s){n.load(t,i,e,s)})}parse(){}setCrossOrigin(t){return this.crossOrigin=t,this}setWithCredentials(t){return this.withCredentials=t,this}setPath(t){return this.path=t,this}setResourcePath(t){return this.resourcePath=t,this}setRequestHeader(t){return this.requestHeader=t,this}abort(){return this}};sn.DEFAULT_MATERIAL_NAME="__DEFAULT";var gi={},Hf=class extends Error{constructor(t,e){super(t),this.response=e}},$n=class extends sn{constructor(t){super(t),this.mimeType="",this.responseType="",this._abortController=new AbortController}load(t,e,n,i){t===void 0&&(t=""),this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);let s=ni.get(`file:${t}`);if(s!==void 0)return this.manager.itemStart(t),setTimeout(()=>{e&&e(s),this.manager.itemEnd(t)},0),s;if(gi[t]!==void 0){gi[t].push({onLoad:e,onProgress:n,onError:i});return}gi[t]=[],gi[t].push({onLoad:e,onProgress:n,onError:i});let o=new Request(t,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",signal:typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),a=this.mimeType,c=this.responseType;fetch(o).then(l=>{if(l.status===200||l.status===0){if(l.status===0&&console.warn("THREE.FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||l.body===void 0||l.body.getReader===void 0)return l;let f=gi[t],h=l.body.getReader(),u=l.headers.get("X-File-Size")||l.headers.get("Content-Length"),d=u?parseInt(u):0,g=d!==0,x=0,p=new ReadableStream({start(m){v();function v(){h.read().then(({done:_,value:y})=>{if(_)m.close();else{x+=y.byteLength;let b=new ProgressEvent("progress",{lengthComputable:g,loaded:x,total:d});for(let T=0,w=f.length;T<w;T++){let E=f[T];E.onProgress&&E.onProgress(b)}m.enqueue(y),v()}},_=>{m.error(_)})}}});return new Response(p)}else throw new Hf(`fetch for "${l.url}" responded with ${l.status}: ${l.statusText}`,l)}).then(l=>{switch(c){case"arraybuffer":return l.arrayBuffer();case"blob":return l.blob();case"document":return l.text().then(f=>new DOMParser().parseFromString(f,a));case"json":return l.json();default:if(a==="")return l.text();{let h=/charset="?([^;"\s]*)"?/i.exec(a),u=h&&h[1]?h[1].toLowerCase():void 0,d=new TextDecoder(u);return l.arrayBuffer().then(g=>d.decode(g))}}}).then(l=>{ni.add(`file:${t}`,l);let f=gi[t];delete gi[t];for(let h=0,u=f.length;h<u;h++){let d=f[h];d.onLoad&&d.onLoad(l)}}).catch(l=>{let f=gi[t];if(f===void 0)throw this.manager.itemError(t),l;delete gi[t];for(let h=0,u=f.length;h<u;h++){let d=f[h];d.onError&&d.onError(l)}this.manager.itemError(t)}).finally(()=>{this.manager.itemEnd(t)}),this.manager.itemStart(t)}setResponseType(t){return this.responseType=t,this}setMimeType(t){return this.mimeType=t,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},Gf=class extends sn{constructor(t){super(t)}load(t,e,n,i){let s=this,o=new $n(this.manager);o.setPath(this.path),o.setRequestHeader(this.requestHeader),o.setWithCredentials(this.withCredentials),o.load(t,function(a){try{e(s.parse(JSON.parse(a)))}catch(c){i?i(c):console.error(c),s.manager.itemError(t)}},n,i)}parse(t){let e=[];for(let n=0;n<t.length;n++){let i=Ir.parse(t[n]);e.push(i)}return e}},Wf=class extends sn{constructor(t){super(t)}load(t,e,n,i){let s=this,o=[],a=new Es,c=new $n(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(s.withCredentials);let l=0;function f(h){c.load(t[h],function(u){let d=s.parse(u,!0);o[h]={width:d.width,height:d.height,format:d.format,mipmaps:d.mipmaps},l+=1,l===6&&(d.mipmapCount===1&&(a.minFilter=re),a.image=o,a.format=d.format,a.needsUpdate=!0,e&&e(a))},n,i)}if(Array.isArray(t))for(let h=0,u=t.length;h<u;++h)f(h);else c.load(t,function(h){let u=s.parse(h,!0);if(u.isCubemap){let d=u.mipmaps.length/u.mipmapCount;for(let g=0;g<d;g++){o[g]={mipmaps:[]};for(let x=0;x<u.mipmapCount;x++)o[g].mipmaps.push(u.mipmaps[g*u.mipmapCount+x]),o[g].format=u.format,o[g].width=u.width,o[g].height=u.height}a.image=o}else a.image.width=u.width,a.image.height=u.height,a.mipmaps=u.mipmaps;u.mipmapCount===1&&(a.minFilter=re),a.format=u.format,a.needsUpdate=!0,e&&e(a)},n,i);return a}},fs=new WeakMap,Pr=class extends sn{constructor(t){super(t)}load(t,e,n,i){this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);let s=this,o=ni.get(`image:${t}`);if(o!==void 0){if(o.complete===!0)s.manager.itemStart(t),setTimeout(function(){e&&e(o),s.manager.itemEnd(t)},0);else{let h=fs.get(o);h===void 0&&(h=[],fs.set(o,h)),h.push({onLoad:e,onError:i})}return o}let a=_s("img");function c(){f(),e&&e(this);let h=fs.get(this)||[];for(let u=0;u<h.length;u++){let d=h[u];d.onLoad&&d.onLoad(this)}fs.delete(this),s.manager.itemEnd(t)}function l(h){f(),i&&i(h),ni.remove(`image:${t}`);let u=fs.get(this)||[];for(let d=0;d<u.length;d++){let g=u[d];g.onError&&g.onError(h)}fs.delete(this),s.manager.itemError(t),s.manager.itemEnd(t)}function f(){a.removeEventListener("load",c,!1),a.removeEventListener("error",l,!1)}return a.addEventListener("load",c,!1),a.addEventListener("error",l,!1),t.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(a.crossOrigin=this.crossOrigin),ni.add(`image:${t}`,a),s.manager.itemStart(t),a.src=t,a}},Xf=class extends sn{constructor(t){super(t)}load(t,e,n,i){let s=new Mr;s.colorSpace=vn;let o=new Pr(this.manager);o.setCrossOrigin(this.crossOrigin),o.setPath(this.path);let a=0;function c(l){o.load(t[l],function(f){s.images[l]=f,a++,a===6&&(s.needsUpdate=!0,e&&e(s))},void 0,i)}for(let l=0;l<t.length;++l)c(l);return s}},qf=class extends sn{constructor(t){super(t)}load(t,e,n,i){let s=this,o=new oe,a=new $n(this.manager);return a.setResponseType("arraybuffer"),a.setRequestHeader(this.requestHeader),a.setPath(this.path),a.setWithCredentials(s.withCredentials),a.load(t,function(c){let l;try{l=s.parse(c)}catch(f){if(i!==void 0)i(f);else{console.error(f);return}}l.image!==void 0?o.image=l.image:l.data!==void 0&&(o.image.width=l.width,o.image.height=l.height,o.image.data=l.data),o.wrapS=l.wrapS!==void 0?l.wrapS:we,o.wrapT=l.wrapT!==void 0?l.wrapT:we,o.magFilter=l.magFilter!==void 0?l.magFilter:re,o.minFilter=l.minFilter!==void 0?l.minFilter:re,o.anisotropy=l.anisotropy!==void 0?l.anisotropy:1,l.colorSpace!==void 0&&(o.colorSpace=l.colorSpace),l.flipY!==void 0&&(o.flipY=l.flipY),l.format!==void 0&&(o.format=l.format),l.type!==void 0&&(o.type=l.type),l.mipmaps!==void 0&&(o.mipmaps=l.mipmaps,o.minFilter=ai),l.mipmapCount===1&&(o.minFilter=re),l.generateMipmaps!==void 0&&(o.generateMipmaps=l.generateMipmaps),o.needsUpdate=!0,e&&e(o,l)},n,i),o}},Yf=class extends sn{constructor(t){super(t)}load(t,e,n,i){let s=new Oe,o=new Pr(this.manager);return o.setCrossOrigin(this.crossOrigin),o.setPath(this.path),o.load(t,function(a){s.image=a,s.needsUpdate=!0,e!==void 0&&e(s)},n,i),s}},si=class extends ue{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new ft(t),this.intensity=e}dispose(){}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){let e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,this.groundColor!==void 0&&(e.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(e.object.distance=this.distance),this.angle!==void 0&&(e.object.angle=this.angle),this.decay!==void 0&&(e.object.decay=this.decay),this.penumbra!==void 0&&(e.object.penumbra=this.penumbra),this.shadow!==void 0&&(e.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(e.object.target=this.target.uuid),e}},Al=class extends si{constructor(t,e,n){super(t,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(ue.DEFAULT_UP),this.updateMatrix(),this.groundColor=new ft(e)}copy(t,e){return super.copy(t,e),this.groundColor.copy(t.groundColor),this}},pf=new gt,Km=new R,Qm=new R,ra=class{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new q(512,512),this.mapType=on,this.map=null,this.mapPass=null,this.matrix=new gt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Oi,this._frameExtents=new q(1,1),this._viewportCount=1,this._viewports=[new Kt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){let e=this.camera,n=this.matrix;Km.setFromMatrixPosition(t.matrixWorld),e.position.copy(Km),Qm.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(Qm),e.updateMatrixWorld(),pf.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(pf,e.coordinateSystem,e.reversedDepth),e.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(pf)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.autoUpdate=t.autoUpdate,this.needsUpdate=t.needsUpdate,this.normalBias=t.normalBias,this.blurSamples=t.blurSamples,this.mapSize.copy(t.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){let t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}},$f=class extends ra{constructor(){super(new Re(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(t){let e=this.camera,n=br*2*t.angle*this.focus,i=this.mapSize.width/this.mapSize.height*this.aspect,s=t.distance||e.far;(n!==e.fov||i!==e.aspect||s!==e.far)&&(e.fov=n,e.aspect=i,e.far=s,e.updateProjectionMatrix()),super.updateMatrices(t)}copy(t){return super.copy(t),this.focus=t.focus,this}},Ds=class extends si{constructor(t,e,n=0,i=Math.PI/3,s=0,o=2){super(t,e),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(ue.DEFAULT_UP),this.updateMatrix(),this.target=new ue,this.distance=n,this.angle=i,this.penumbra=s,this.decay=o,this.map=null,this.shadow=new $f}get power(){return this.intensity*Math.PI}set power(t){this.intensity=t/Math.PI}dispose(){this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.angle=t.angle,this.penumbra=t.penumbra,this.decay=t.decay,this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}},jm=new gt,yo=new R,mf=new R,Zf=class extends ra{constructor(){super(new Re(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new q(4,2),this._viewportCount=6,this._viewports=[new Kt(2,1,1,1),new Kt(0,1,1,1),new Kt(3,1,1,1),new Kt(1,1,1,1),new Kt(3,0,1,1),new Kt(1,0,1,1)],this._cubeDirections=[new R(1,0,0),new R(-1,0,0),new R(0,0,1),new R(0,0,-1),new R(0,1,0),new R(0,-1,0)],this._cubeUps=[new R(0,1,0),new R(0,1,0),new R(0,1,0),new R(0,1,0),new R(0,0,1),new R(0,0,-1)]}updateMatrices(t,e=0){let n=this.camera,i=this.matrix,s=t.distance||n.far;s!==n.far&&(n.far=s,n.updateProjectionMatrix()),yo.setFromMatrixPosition(t.matrixWorld),n.position.copy(yo),mf.copy(n.position),mf.add(this._cubeDirections[e]),n.up.copy(this._cubeUps[e]),n.lookAt(mf),n.updateMatrixWorld(),i.makeTranslation(-yo.x,-yo.y,-yo.z),jm.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(jm,n.coordinateSystem,n.reversedDepth)}},El=class extends si{constructor(t,e,n=0,i=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new Zf}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}},ki=class extends Ms{constructor(t=-1,e=1,n=1,i=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=n,this.bottom=i,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,n,i,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2,s=n-t,o=n+t,a=i+e,c=i-e;if(this.view!==null&&this.view.enabled){let l=(this.right-this.left)/this.view.fullWidth/this.zoom,f=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=l*this.view.offsetX,o=s+l*this.view.width,a-=f*this.view.offsetY,c=a-f*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,c,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){let e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}},Jf=class extends ra{constructor(){super(new ki(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Rl=class extends si{constructor(t,e){super(t,e),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(ue.DEFAULT_UP),this.updateMatrix(),this.target=new ue,this.shadow=new Jf}dispose(){this.shadow.dispose()}copy(t){return super.copy(t),this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}},Cl=class extends si{constructor(t,e){super(t,e),this.isAmbientLight=!0,this.type="AmbientLight"}},Fs=class extends si{constructor(t,e,n=10,i=10){super(t,e),this.isRectAreaLight=!0,this.type="RectAreaLight",this.width=n,this.height=i}get power(){return this.intensity*this.width*this.height*Math.PI}set power(t){this.intensity=t/(this.width*this.height*Math.PI)}copy(t){return super.copy(t),this.width=t.width,this.height=t.height,this}toJSON(t){let e=super.toJSON(t);return e.object.width=this.width,e.object.height=this.height,e}},Il=class{constructor(){this.isSphericalHarmonics3=!0,this.coefficients=[];for(let t=0;t<9;t++)this.coefficients.push(new R)}set(t){for(let e=0;e<9;e++)this.coefficients[e].copy(t[e]);return this}zero(){for(let t=0;t<9;t++)this.coefficients[t].set(0,0,0);return this}getAt(t,e){let n=t.x,i=t.y,s=t.z,o=this.coefficients;return e.copy(o[0]).multiplyScalar(.282095),e.addScaledVector(o[1],.488603*i),e.addScaledVector(o[2],.488603*s),e.addScaledVector(o[3],.488603*n),e.addScaledVector(o[4],1.092548*(n*i)),e.addScaledVector(o[5],1.092548*(i*s)),e.addScaledVector(o[6],.315392*(3*s*s-1)),e.addScaledVector(o[7],1.092548*(n*s)),e.addScaledVector(o[8],.546274*(n*n-i*i)),e}getIrradianceAt(t,e){let n=t.x,i=t.y,s=t.z,o=this.coefficients;return e.copy(o[0]).multiplyScalar(.886227),e.addScaledVector(o[1],2*.511664*i),e.addScaledVector(o[2],2*.511664*s),e.addScaledVector(o[3],2*.511664*n),e.addScaledVector(o[4],2*.429043*n*i),e.addScaledVector(o[5],2*.429043*i*s),e.addScaledVector(o[6],.743125*s*s-.247708),e.addScaledVector(o[7],2*.429043*n*s),e.addScaledVector(o[8],.429043*(n*n-i*i)),e}add(t){for(let e=0;e<9;e++)this.coefficients[e].add(t.coefficients[e]);return this}addScaledSH(t,e){for(let n=0;n<9;n++)this.coefficients[n].addScaledVector(t.coefficients[n],e);return this}scale(t){for(let e=0;e<9;e++)this.coefficients[e].multiplyScalar(t);return this}lerp(t,e){for(let n=0;n<9;n++)this.coefficients[n].lerp(t.coefficients[n],e);return this}equals(t){for(let e=0;e<9;e++)if(!this.coefficients[e].equals(t.coefficients[e]))return!1;return!0}copy(t){return this.set(t.coefficients)}clone(){return new this.constructor().copy(this)}fromArray(t,e=0){let n=this.coefficients;for(let i=0;i<9;i++)n[i].fromArray(t,e+i*3);return this}toArray(t=[],e=0){let n=this.coefficients;for(let i=0;i<9;i++)n[i].toArray(t,e+i*3);return t}static getBasisAt(t,e){let n=t.x,i=t.y,s=t.z;e[0]=.282095,e[1]=.488603*i,e[2]=.488603*s,e[3]=.488603*n,e[4]=1.092548*n*i,e[5]=1.092548*i*s,e[6]=.315392*(3*s*s-1),e[7]=1.092548*n*s,e[8]=.546274*(n*n-i*i)}},Pl=class extends si{constructor(t=new Il,e=1){super(void 0,e),this.isLightProbe=!0,this.sh=t}copy(t){return super.copy(t),this.sh.copy(t.sh),this}fromJSON(t){return this.intensity=t.intensity,this.sh.fromArray(t.sh),this}toJSON(t){let e=super.toJSON(t);return e.object.sh=this.sh.toArray(),e}},Dl=class r extends sn{constructor(t){super(t),this.textures={}}load(t,e,n,i){let s=this,o=new $n(s.manager);o.setPath(s.path),o.setRequestHeader(s.requestHeader),o.setWithCredentials(s.withCredentials),o.load(t,function(a){try{e(s.parse(JSON.parse(a)))}catch(c){i?i(c):console.error(c),s.manager.itemError(t)}},n,i)}parse(t){let e=this.textures;function n(s){return e[s]===void 0&&console.warn("THREE.MaterialLoader: Undefined texture",s),e[s]}let i=this.createMaterialFromType(t.type);if(t.uuid!==void 0&&(i.uuid=t.uuid),t.name!==void 0&&(i.name=t.name),t.color!==void 0&&i.color!==void 0&&i.color.setHex(t.color),t.roughness!==void 0&&(i.roughness=t.roughness),t.metalness!==void 0&&(i.metalness=t.metalness),t.sheen!==void 0&&(i.sheen=t.sheen),t.sheenColor!==void 0&&(i.sheenColor=new ft().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(i.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&i.emissive!==void 0&&i.emissive.setHex(t.emissive),t.specular!==void 0&&i.specular!==void 0&&i.specular.setHex(t.specular),t.specularIntensity!==void 0&&(i.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&i.specularColor!==void 0&&i.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(i.shininess=t.shininess),t.clearcoat!==void 0&&(i.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(i.dispersion=t.dispersion),t.iridescence!==void 0&&(i.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(i.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(i.transmission=t.transmission),t.thickness!==void 0&&(i.thickness=t.thickness),t.attenuationDistance!==void 0&&(i.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&i.attenuationColor!==void 0&&i.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(i.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(i.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(i.fog=t.fog),t.flatShading!==void 0&&(i.flatShading=t.flatShading),t.blending!==void 0&&(i.blending=t.blending),t.combine!==void 0&&(i.combine=t.combine),t.side!==void 0&&(i.side=t.side),t.shadowSide!==void 0&&(i.shadowSide=t.shadowSide),t.opacity!==void 0&&(i.opacity=t.opacity),t.transparent!==void 0&&(i.transparent=t.transparent),t.alphaTest!==void 0&&(i.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(i.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(i.depthFunc=t.depthFunc),t.depthTest!==void 0&&(i.depthTest=t.depthTest),t.depthWrite!==void 0&&(i.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(i.colorWrite=t.colorWrite),t.blendSrc!==void 0&&(i.blendSrc=t.blendSrc),t.blendDst!==void 0&&(i.blendDst=t.blendDst),t.blendEquation!==void 0&&(i.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(i.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(i.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(i.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&i.blendColor!==void 0&&i.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(i.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(i.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(i.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(i.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(i.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(i.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(i.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(i.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(i.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(i.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(i.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(i.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(i.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(i.rotation=t.rotation),t.linewidth!==void 0&&(i.linewidth=t.linewidth),t.dashSize!==void 0&&(i.dashSize=t.dashSize),t.gapSize!==void 0&&(i.gapSize=t.gapSize),t.scale!==void 0&&(i.scale=t.scale),t.polygonOffset!==void 0&&(i.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(i.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(i.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(i.dithering=t.dithering),t.alphaToCoverage!==void 0&&(i.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(i.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(i.forceSinglePass=t.forceSinglePass),t.visible!==void 0&&(i.visible=t.visible),t.toneMapped!==void 0&&(i.toneMapped=t.toneMapped),t.userData!==void 0&&(i.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?i.vertexColors=t.vertexColors>0:i.vertexColors=t.vertexColors),t.uniforms!==void 0)for(let s in t.uniforms){let o=t.uniforms[s];switch(i.uniforms[s]={},o.type){case"t":i.uniforms[s].value=n(o.value);break;case"c":i.uniforms[s].value=new ft().setHex(o.value);break;case"v2":i.uniforms[s].value=new q().fromArray(o.value);break;case"v3":i.uniforms[s].value=new R().fromArray(o.value);break;case"v4":i.uniforms[s].value=new Kt().fromArray(o.value);break;case"m3":i.uniforms[s].value=new Xt().fromArray(o.value);break;case"m4":i.uniforms[s].value=new gt().fromArray(o.value);break;default:i.uniforms[s].value=o.value}}if(t.defines!==void 0&&(i.defines=t.defines),t.vertexShader!==void 0&&(i.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(i.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(i.glslVersion=t.glslVersion),t.extensions!==void 0)for(let s in t.extensions)i.extensions[s]=t.extensions[s];if(t.lights!==void 0&&(i.lights=t.lights),t.clipping!==void 0&&(i.clipping=t.clipping),t.size!==void 0&&(i.size=t.size),t.sizeAttenuation!==void 0&&(i.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(i.map=n(t.map)),t.matcap!==void 0&&(i.matcap=n(t.matcap)),t.alphaMap!==void 0&&(i.alphaMap=n(t.alphaMap)),t.bumpMap!==void 0&&(i.bumpMap=n(t.bumpMap)),t.bumpScale!==void 0&&(i.bumpScale=t.bumpScale),t.normalMap!==void 0&&(i.normalMap=n(t.normalMap)),t.normalMapType!==void 0&&(i.normalMapType=t.normalMapType),t.normalScale!==void 0){let s=t.normalScale;Array.isArray(s)===!1&&(s=[s,s]),i.normalScale=new q().fromArray(s)}return t.displacementMap!==void 0&&(i.displacementMap=n(t.displacementMap)),t.displacementScale!==void 0&&(i.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(i.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(i.roughnessMap=n(t.roughnessMap)),t.metalnessMap!==void 0&&(i.metalnessMap=n(t.metalnessMap)),t.emissiveMap!==void 0&&(i.emissiveMap=n(t.emissiveMap)),t.emissiveIntensity!==void 0&&(i.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(i.specularMap=n(t.specularMap)),t.specularIntensityMap!==void 0&&(i.specularIntensityMap=n(t.specularIntensityMap)),t.specularColorMap!==void 0&&(i.specularColorMap=n(t.specularColorMap)),t.envMap!==void 0&&(i.envMap=n(t.envMap)),t.envMapRotation!==void 0&&i.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(i.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(i.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(i.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(i.lightMap=n(t.lightMap)),t.lightMapIntensity!==void 0&&(i.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(i.aoMap=n(t.aoMap)),t.aoMapIntensity!==void 0&&(i.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(i.gradientMap=n(t.gradientMap)),t.clearcoatMap!==void 0&&(i.clearcoatMap=n(t.clearcoatMap)),t.clearcoatRoughnessMap!==void 0&&(i.clearcoatRoughnessMap=n(t.clearcoatRoughnessMap)),t.clearcoatNormalMap!==void 0&&(i.clearcoatNormalMap=n(t.clearcoatNormalMap)),t.clearcoatNormalScale!==void 0&&(i.clearcoatNormalScale=new q().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(i.iridescenceMap=n(t.iridescenceMap)),t.iridescenceThicknessMap!==void 0&&(i.iridescenceThicknessMap=n(t.iridescenceThicknessMap)),t.transmissionMap!==void 0&&(i.transmissionMap=n(t.transmissionMap)),t.thicknessMap!==void 0&&(i.thicknessMap=n(t.thicknessMap)),t.anisotropyMap!==void 0&&(i.anisotropyMap=n(t.anisotropyMap)),t.sheenColorMap!==void 0&&(i.sheenColorMap=n(t.sheenColorMap)),t.sheenRoughnessMap!==void 0&&(i.sheenRoughnessMap=n(t.sheenRoughnessMap)),i}setTextures(t){return this.textures=t,this}createMaterialFromType(t){return r.createMaterialFromType(t)}static createMaterialFromType(t){let e={ShadowMaterial:pl,SpriteMaterial:No,RawShaderMaterial:ml,ShaderMaterial:Ue,PointsMaterial:Bo,MeshPhysicalMaterial:gl,MeshStandardMaterial:Qo,MeshPhongMaterial:xl,MeshToonMaterial:vl,MeshNormalMaterial:_l,MeshLambertMaterial:yl,MeshDepthMaterial:jo,MeshDistanceMaterial:ta,MeshBasicMaterial:zn,MeshMatcapMaterial:bl,LineDashedMaterial:Sl,LineBasicMaterial:Qe,Material:Je};return new e[t]}},sa=class{static extractUrlBase(t){let e=t.lastIndexOf("/");return e===-1?"./":t.slice(0,e+1)}static resolveURL(t,e){return typeof t!="string"||t===""?"":(/^https?:\/\//i.test(e)&&/^\//.test(t)&&(e=e.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(t)||/^data:.*,.*$/i.test(t)||/^blob:.*$/i.test(t)?t:e+t)}},Fl=class extends Ft{constructor(){super(),this.isInstancedBufferGeometry=!0,this.type="InstancedBufferGeometry",this.instanceCount=1/0}copy(t){return super.copy(t),this.instanceCount=t.instanceCount,this}toJSON(){let t=super.toJSON();return t.instanceCount=this.instanceCount,t.isInstancedBufferGeometry=!0,t}},Ll=class extends sn{constructor(t){super(t)}load(t,e,n,i){let s=this,o=new $n(s.manager);o.setPath(s.path),o.setRequestHeader(s.requestHeader),o.setWithCredentials(s.withCredentials),o.load(t,function(a){try{e(s.parse(JSON.parse(a)))}catch(c){i?i(c):console.error(c),s.manager.itemError(t)}},n,i)}parse(t){let e={},n={};function i(d,g){if(e[g]!==void 0)return e[g];let p=d.interleavedBuffers[g],m=s(d,p.buffer),v=ms(p.type,m),_=new As(v,p.stride);return _.uuid=p.uuid,e[g]=_,_}function s(d,g){if(n[g]!==void 0)return n[g];let p=d.arrayBuffers[g],m=new Uint32Array(p).buffer;return n[g]=m,m}let o=t.isInstancedBufferGeometry?new Fl:new Ft,a=t.data.index;if(a!==void 0){let d=ms(a.type,a.array);o.setIndex(new Ot(d,1))}let c=t.data.attributes;for(let d in c){let g=c[d],x;if(g.isInterleavedBufferAttribute){let p=i(t.data,g.data);x=new Tr(p,g.itemSize,g.offset,g.normalized)}else{let p=ms(g.type,g.array),m=g.isInstancedBufferAttribute?Bi:Ot;x=new m(p,g.itemSize,g.normalized)}g.name!==void 0&&(x.name=g.name),g.usage!==void 0&&x.setUsage(g.usage),o.setAttribute(d,x)}let l=t.data.morphAttributes;if(l)for(let d in l){let g=l[d],x=[];for(let p=0,m=g.length;p<m;p++){let v=g[p],_;if(v.isInterleavedBufferAttribute){let y=i(t.data,v.data);_=new Tr(y,v.itemSize,v.offset,v.normalized)}else{let y=ms(v.type,v.array);_=new Ot(y,v.itemSize,v.normalized)}v.name!==void 0&&(_.name=v.name),x.push(_)}o.morphAttributes[d]=x}t.data.morphTargetsRelative&&(o.morphTargetsRelative=!0);let h=t.data.groups||t.data.drawcalls||t.data.offsets;if(h!==void 0)for(let d=0,g=h.length;d!==g;++d){let x=h[d];o.addGroup(x.start,x.count,x.materialIndex)}let u=t.data.boundingSphere;return u!==void 0&&(o.boundingSphere=new Ve().fromJSON(u)),t.name&&(o.name=t.name),t.userData&&(o.userData=t.userData),o}},Kf=class extends sn{constructor(t){super(t)}load(t,e,n,i){let s=this,o=this.path===""?sa.extractUrlBase(t):this.path;this.resourcePath=this.resourcePath||o;let a=new $n(this.manager);a.setPath(this.path),a.setRequestHeader(this.requestHeader),a.setWithCredentials(this.withCredentials),a.load(t,function(c){let l=null;try{l=JSON.parse(c)}catch(h){i!==void 0&&i(h),console.error("THREE:ObjectLoader: Can't parse "+t+".",h.message);return}let f=l.metadata;if(f===void 0||f.type===void 0||f.type.toLowerCase()==="geometry"){i!==void 0&&i(new Error("THREE.ObjectLoader: Can't load "+t)),console.error("THREE.ObjectLoader: Can't load "+t);return}s.parse(l,e)},n,i)}async loadAsync(t,e){let n=this,i=this.path===""?sa.extractUrlBase(t):this.path;this.resourcePath=this.resourcePath||i;let s=new $n(this.manager);s.setPath(this.path),s.setRequestHeader(this.requestHeader),s.setWithCredentials(this.withCredentials);let o=await s.loadAsync(t,e),a=JSON.parse(o),c=a.metadata;if(c===void 0||c.type===void 0||c.type.toLowerCase()==="geometry")throw new Error("THREE.ObjectLoader: Can't load "+t);return await n.parseAsync(a)}parse(t,e){let n=this.parseAnimations(t.animations),i=this.parseShapes(t.shapes),s=this.parseGeometries(t.geometries,i),o=this.parseImages(t.images,function(){e!==void 0&&e(l)}),a=this.parseTextures(t.textures,o),c=this.parseMaterials(t.materials,a),l=this.parseObject(t.object,s,c,a,n),f=this.parseSkeletons(t.skeletons,l);if(this.bindSkeletons(l,f),this.bindLightTargets(l),e!==void 0){let h=!1;for(let u in o)if(o[u].data instanceof HTMLImageElement){h=!0;break}h===!1&&e(l)}return l}async parseAsync(t){let e=this.parseAnimations(t.animations),n=this.parseShapes(t.shapes),i=this.parseGeometries(t.geometries,n),s=await this.parseImagesAsync(t.images),o=this.parseTextures(t.textures,s),a=this.parseMaterials(t.materials,o),c=this.parseObject(t.object,i,a,o,e),l=this.parseSkeletons(t.skeletons,c);return this.bindSkeletons(c,l),this.bindLightTargets(c),c}parseShapes(t){let e={};if(t!==void 0)for(let n=0,i=t.length;n<i;n++){let s=new _i().fromJSON(t[n]);e[s.uuid]=s}return e}parseSkeletons(t,e){let n={},i={};if(e.traverse(function(s){s.isBone&&(i[s.uuid]=s)}),t!==void 0)for(let s=0,o=t.length;s<o;s++){let a=new zc().fromJSON(t[s],i);n[a.uuid]=a}return n}parseGeometries(t,e){let n={};if(t!==void 0){let i=new Ll;for(let s=0,o=t.length;s<o;s++){let a,c=t[s];switch(c.type){case"BufferGeometry":case"InstancedBufferGeometry":a=i.parse(c);break;default:c.type in Jm?a=Jm[c.type].fromJSON(c,e):console.warn(`THREE.ObjectLoader: Unsupported geometry type "${c.type}"`)}a.uuid=c.uuid,c.name!==void 0&&(a.name=c.name),c.userData!==void 0&&(a.userData=c.userData),n[c.uuid]=a}}return n}parseMaterials(t,e){let n={},i={};if(t!==void 0){let s=new Dl;s.setTextures(e);for(let o=0,a=t.length;o<a;o++){let c=t[o];n[c.uuid]===void 0&&(n[c.uuid]=s.parse(c)),i[c.uuid]=n[c.uuid]}}return i}parseAnimations(t){let e={};if(t!==void 0)for(let n=0;n<t.length;n++){let i=t[n],s=Ir.parse(i);e[s.uuid]=s}return e}parseImages(t,e){let n=this,i={},s;function o(c){return n.manager.itemStart(c),s.load(c,function(){n.manager.itemEnd(c)},void 0,function(){n.manager.itemError(c),n.manager.itemEnd(c)})}function a(c){if(typeof c=="string"){let l=c,f=/^(\/\/)|([a-z]+:(\/\/)?)/i.test(l)?l:n.resourcePath+l;return o(f)}else return c.data?{data:ms(c.type,c.data),width:c.width,height:c.height}:null}if(t!==void 0&&t.length>0){let c=new ia(e);s=new Pr(c),s.setCrossOrigin(this.crossOrigin);for(let l=0,f=t.length;l<f;l++){let h=t[l],u=h.url;if(Array.isArray(u)){let d=[];for(let g=0,x=u.length;g<x;g++){let p=u[g],m=a(p);m!==null&&(m instanceof HTMLImageElement?d.push(m):d.push(new oe(m.data,m.width,m.height)))}i[h.uuid]=new Bn(d)}else{let d=a(h.url);i[h.uuid]=new Bn(d)}}}return i}async parseImagesAsync(t){let e=this,n={},i;async function s(o){if(typeof o=="string"){let a=o,c=/^(\/\/)|([a-z]+:(\/\/)?)/i.test(a)?a:e.resourcePath+a;return await i.loadAsync(c)}else return o.data?{data:ms(o.type,o.data),width:o.width,height:o.height}:null}if(t!==void 0&&t.length>0){i=new Pr(this.manager),i.setCrossOrigin(this.crossOrigin);for(let o=0,a=t.length;o<a;o++){let c=t[o],l=c.url;if(Array.isArray(l)){let f=[];for(let h=0,u=l.length;h<u;h++){let d=l[h],g=await s(d);g!==null&&(g instanceof HTMLImageElement?f.push(g):f.push(new oe(g.data,g.width,g.height)))}n[c.uuid]=new Bn(f)}else{let f=await s(c.url);n[c.uuid]=new Bn(f)}}}return n}parseTextures(t,e){function n(s,o){return typeof s=="number"?s:(console.warn("THREE.ObjectLoader.parseTexture: Constant should be in numeric form.",s),o[s])}let i={};if(t!==void 0)for(let s=0,o=t.length;s<o;s++){let a=t[s];a.image===void 0&&console.warn('THREE.ObjectLoader: No "image" specified for',a.uuid),e[a.image]===void 0&&console.warn("THREE.ObjectLoader: Undefined image",a.image);let c=e[a.image],l=c.data,f;Array.isArray(l)?(f=new Mr,l.length===6&&(f.needsUpdate=!0)):(l&&l.data?f=new oe:f=new Oe,l&&(f.needsUpdate=!0)),f.source=c,f.uuid=a.uuid,a.name!==void 0&&(f.name=a.name),a.mapping!==void 0&&(f.mapping=n(a.mapping,nb)),a.channel!==void 0&&(f.channel=a.channel),a.offset!==void 0&&f.offset.fromArray(a.offset),a.repeat!==void 0&&f.repeat.fromArray(a.repeat),a.center!==void 0&&f.center.fromArray(a.center),a.rotation!==void 0&&(f.rotation=a.rotation),a.wrap!==void 0&&(f.wrapS=n(a.wrap[0],tg),f.wrapT=n(a.wrap[1],tg)),a.format!==void 0&&(f.format=a.format),a.internalFormat!==void 0&&(f.internalFormat=a.internalFormat),a.type!==void 0&&(f.type=a.type),a.colorSpace!==void 0&&(f.colorSpace=a.colorSpace),a.minFilter!==void 0&&(f.minFilter=n(a.minFilter,eg)),a.magFilter!==void 0&&(f.magFilter=n(a.magFilter,eg)),a.anisotropy!==void 0&&(f.anisotropy=a.anisotropy),a.flipY!==void 0&&(f.flipY=a.flipY),a.generateMipmaps!==void 0&&(f.generateMipmaps=a.generateMipmaps),a.premultiplyAlpha!==void 0&&(f.premultiplyAlpha=a.premultiplyAlpha),a.unpackAlignment!==void 0&&(f.unpackAlignment=a.unpackAlignment),a.compareFunction!==void 0&&(f.compareFunction=a.compareFunction),a.userData!==void 0&&(f.userData=a.userData),i[a.uuid]=f}return i}parseObject(t,e,n,i,s){let o;function a(u){return e[u]===void 0&&console.warn("THREE.ObjectLoader: Undefined geometry",u),e[u]}function c(u){if(u!==void 0){if(Array.isArray(u)){let d=[];for(let g=0,x=u.length;g<x;g++){let p=u[g];n[p]===void 0&&console.warn("THREE.ObjectLoader: Undefined material",p),d.push(n[p])}return d}return n[u]===void 0&&console.warn("THREE.ObjectLoader: Undefined material",u),n[u]}}function l(u){return i[u]===void 0&&console.warn("THREE.ObjectLoader: Undefined texture",u),i[u]}let f,h;switch(t.type){case"Scene":o=new ws,t.background!==void 0&&(Number.isInteger(t.background)?o.background=new ft(t.background):o.background=l(t.background)),t.environment!==void 0&&(o.environment=l(t.environment)),t.fog!==void 0&&(t.fog.type==="Fog"?o.fog=new Nc(t.fog.color,t.fog.near,t.fog.far):t.fog.type==="FogExp2"&&(o.fog=new Lc(t.fog.color,t.fog.density)),t.fog.name!==""&&(o.fog.name=t.fog.name)),t.backgroundBlurriness!==void 0&&(o.backgroundBlurriness=t.backgroundBlurriness),t.backgroundIntensity!==void 0&&(o.backgroundIntensity=t.backgroundIntensity),t.backgroundRotation!==void 0&&o.backgroundRotation.fromArray(t.backgroundRotation),t.environmentIntensity!==void 0&&(o.environmentIntensity=t.environmentIntensity),t.environmentRotation!==void 0&&o.environmentRotation.fromArray(t.environmentRotation);break;case"PerspectiveCamera":o=new Re(t.fov,t.aspect,t.near,t.far),t.focus!==void 0&&(o.focus=t.focus),t.zoom!==void 0&&(o.zoom=t.zoom),t.filmGauge!==void 0&&(o.filmGauge=t.filmGauge),t.filmOffset!==void 0&&(o.filmOffset=t.filmOffset),t.view!==void 0&&(o.view=Object.assign({},t.view));break;case"OrthographicCamera":o=new ki(t.left,t.right,t.top,t.bottom,t.near,t.far),t.zoom!==void 0&&(o.zoom=t.zoom),t.view!==void 0&&(o.view=Object.assign({},t.view));break;case"AmbientLight":o=new Cl(t.color,t.intensity);break;case"DirectionalLight":o=new Rl(t.color,t.intensity),o.target=t.target||"";break;case"PointLight":o=new El(t.color,t.intensity,t.distance,t.decay);break;case"RectAreaLight":o=new Fs(t.color,t.intensity,t.width,t.height);break;case"SpotLight":o=new Ds(t.color,t.intensity,t.distance,t.angle,t.penumbra,t.decay),o.target=t.target||"";break;case"HemisphereLight":o=new Al(t.color,t.groundColor,t.intensity);break;case"LightProbe":o=new Pl().fromJSON(t);break;case"SkinnedMesh":f=a(t.geometry),h=c(t.material),o=new Oc(f,h),t.bindMode!==void 0&&(o.bindMode=t.bindMode),t.bindMatrix!==void 0&&o.bindMatrix.fromArray(t.bindMatrix),t.skeleton!==void 0&&(o.skeleton=t.skeleton);break;case"Mesh":f=a(t.geometry),h=c(t.material),o=new Me(f,h);break;case"InstancedMesh":f=a(t.geometry),h=c(t.material);let u=t.count,d=t.instanceMatrix,g=t.instanceColor;o=new kc(f,h,u),o.instanceMatrix=new Bi(new Float32Array(d.array),16),g!==void 0&&(o.instanceColor=new Bi(new Float32Array(g.array),g.itemSize));break;case"BatchedMesh":f=a(t.geometry),h=c(t.material),o=new Hc(t.maxInstanceCount,t.maxVertexCount,t.maxIndexCount,h),o.geometry=f,o.perObjectFrustumCulled=t.perObjectFrustumCulled,o.sortObjects=t.sortObjects,o._drawRanges=t.drawRanges,o._reservedRanges=t.reservedRanges,o._geometryInfo=t.geometryInfo.map(x=>{let p=null,m=null;return x.boundingBox!==void 0&&(p=new se().fromJSON(x.boundingBox)),x.boundingSphere!==void 0&&(m=new Ve().fromJSON(x.boundingSphere)),{...x,boundingBox:p,boundingSphere:m}}),o._instanceInfo=t.instanceInfo,o._availableInstanceIds=t._availableInstanceIds,o._availableGeometryIds=t._availableGeometryIds,o._nextIndexStart=t.nextIndexStart,o._nextVertexStart=t.nextVertexStart,o._geometryCount=t.geometryCount,o._maxInstanceCount=t.maxInstanceCount,o._maxVertexCount=t.maxVertexCount,o._maxIndexCount=t.maxIndexCount,o._geometryInitialized=t.geometryInitialized,o._matricesTexture=l(t.matricesTexture.uuid),o._indirectTexture=l(t.indirectTexture.uuid),t.colorsTexture!==void 0&&(o._colorsTexture=l(t.colorsTexture.uuid)),t.boundingSphere!==void 0&&(o.boundingSphere=new Ve().fromJSON(t.boundingSphere)),t.boundingBox!==void 0&&(o.boundingBox=new se().fromJSON(t.boundingBox));break;case"LOD":o=new Bc;break;case"Line":o=new ri(a(t.geometry),c(t.material));break;case"LineLoop":o=new Xc(a(t.geometry),c(t.material));break;case"LineSegments":o=new kn(a(t.geometry),c(t.material));break;case"PointCloud":case"Points":o=new qc(a(t.geometry),c(t.material));break;case"Sprite":o=new Uc(c(t.material));break;case"Group":o=new Li;break;case"Bone":o=new Uo;break;default:o=new ue}if(o.uuid=t.uuid,t.name!==void 0&&(o.name=t.name),t.matrix!==void 0?(o.matrix.fromArray(t.matrix),t.matrixAutoUpdate!==void 0&&(o.matrixAutoUpdate=t.matrixAutoUpdate),o.matrixAutoUpdate&&o.matrix.decompose(o.position,o.quaternion,o.scale)):(t.position!==void 0&&o.position.fromArray(t.position),t.rotation!==void 0&&o.rotation.fromArray(t.rotation),t.quaternion!==void 0&&o.quaternion.fromArray(t.quaternion),t.scale!==void 0&&o.scale.fromArray(t.scale)),t.up!==void 0&&o.up.fromArray(t.up),t.castShadow!==void 0&&(o.castShadow=t.castShadow),t.receiveShadow!==void 0&&(o.receiveShadow=t.receiveShadow),t.shadow&&(t.shadow.intensity!==void 0&&(o.shadow.intensity=t.shadow.intensity),t.shadow.bias!==void 0&&(o.shadow.bias=t.shadow.bias),t.shadow.normalBias!==void 0&&(o.shadow.normalBias=t.shadow.normalBias),t.shadow.radius!==void 0&&(o.shadow.radius=t.shadow.radius),t.shadow.mapSize!==void 0&&o.shadow.mapSize.fromArray(t.shadow.mapSize),t.shadow.camera!==void 0&&(o.shadow.camera=this.parseObject(t.shadow.camera))),t.visible!==void 0&&(o.visible=t.visible),t.frustumCulled!==void 0&&(o.frustumCulled=t.frustumCulled),t.renderOrder!==void 0&&(o.renderOrder=t.renderOrder),t.userData!==void 0&&(o.userData=t.userData),t.layers!==void 0&&(o.layers.mask=t.layers),t.children!==void 0){let u=t.children;for(let d=0;d<u.length;d++)o.add(this.parseObject(u[d],e,n,i,s))}if(t.animations!==void 0){let u=t.animations;for(let d=0;d<u.length;d++){let g=u[d];o.animations.push(s[g])}}if(t.type==="LOD"){t.autoUpdate!==void 0&&(o.autoUpdate=t.autoUpdate);let u=t.levels;for(let d=0;d<u.length;d++){let g=u[d],x=o.getObjectByProperty("uuid",g.object);x!==void 0&&o.addLevel(x,g.distance,g.hysteresis)}}return o}bindSkeletons(t,e){Object.keys(e).length!==0&&t.traverse(function(n){if(n.isSkinnedMesh===!0&&n.skeleton!==void 0){let i=e[n.skeleton];i===void 0?console.warn("THREE.ObjectLoader: No skeleton found with UUID:",n.skeleton):n.bind(i,n.bindMatrix)}})}bindLightTargets(t){t.traverse(function(e){if(e.isDirectionalLight||e.isSpotLight){let n=e.target,i=t.getObjectByProperty("uuid",n);i!==void 0?e.target=i:e.target=new ue}})}},nb={UVMapping:ql,CubeReflectionMapping:Si,CubeRefractionMapping:Vi,EquirectangularReflectionMapping:Mi,EquirectangularRefractionMapping:ha,CubeUVReflectionMapping:Ns},tg={RepeatWrapping:Ke,ClampToEdgeWrapping:we,MirroredRepeatWrapping:Ao},eg={NearestFilter:Vt,NearestMipmapNearestFilter:Od,NearestMipmapLinearFilter:Us,LinearFilter:re,LinearMipmapNearestFilter:fa,LinearMipmapLinearFilter:ai},gf=new WeakMap,Qf=class extends sn{constructor(t){super(t),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&console.warn("THREE.ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"},this._abortController=new AbortController}setOptions(t){return this.options=t,this}load(t,e,n,i){t===void 0&&(t=""),this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);let s=this,o=ni.get(`image-bitmap:${t}`);if(o!==void 0){if(s.manager.itemStart(t),o.then){o.then(l=>{if(gf.has(o)===!0)i&&i(gf.get(o)),s.manager.itemError(t),s.manager.itemEnd(t);else return e&&e(l),s.manager.itemEnd(t),l});return}return setTimeout(function(){e&&e(o),s.manager.itemEnd(t)},0),o}let a={};a.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",a.headers=this.requestHeader,a.signal=typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal;let c=fetch(t,a).then(function(l){return l.blob()}).then(function(l){return createImageBitmap(l,Object.assign(s.options,{colorSpaceConversion:"none"}))}).then(function(l){return ni.add(`image-bitmap:${t}`,l),e&&e(l),s.manager.itemEnd(t),l}).catch(function(l){i&&i(l),gf.set(c,l),ni.remove(`image-bitmap:${t}`),s.manager.itemError(t),s.manager.itemEnd(t)});ni.add(`image-bitmap:${t}`,c),s.manager.itemStart(t)}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},yc,oa=class{static getContext(){return yc===void 0&&(yc=new(window.AudioContext||window.webkitAudioContext)),yc}static setContext(t){yc=t}},jf=class extends sn{constructor(t){super(t)}load(t,e,n,i){let s=this,o=new $n(this.manager);o.setResponseType("arraybuffer"),o.setPath(this.path),o.setRequestHeader(this.requestHeader),o.setWithCredentials(this.withCredentials),o.load(t,function(c){try{let l=c.slice(0);oa.getContext().decodeAudioData(l,function(h){e(h)}).catch(a)}catch(l){a(l)}},n,i);function a(c){i?i(c):console.error(c),s.manager.itemError(t)}}},ng=new gt,ig=new gt,cr=new gt,td=class{constructor(){this.type="StereoCamera",this.aspect=1,this.eyeSep=.064,this.cameraL=new Re,this.cameraL.layers.enable(1),this.cameraL.matrixAutoUpdate=!1,this.cameraR=new Re,this.cameraR.layers.enable(2),this.cameraR.matrixAutoUpdate=!1,this._cache={focus:null,fov:null,aspect:null,near:null,far:null,zoom:null,eyeSep:null}}update(t){let e=this._cache;if(e.focus!==t.focus||e.fov!==t.fov||e.aspect!==t.aspect*this.aspect||e.near!==t.near||e.far!==t.far||e.zoom!==t.zoom||e.eyeSep!==this.eyeSep){e.focus=t.focus,e.fov=t.fov,e.aspect=t.aspect*this.aspect,e.near=t.near,e.far=t.far,e.zoom=t.zoom,e.eyeSep=this.eyeSep,cr.copy(t.projectionMatrix);let i=e.eyeSep/2,s=i*e.near/e.focus,o=e.near*Math.tan(vr*e.fov*.5)/e.zoom,a,c;ig.elements[12]=-i,ng.elements[12]=i,a=-o*e.aspect+s,c=o*e.aspect+s,cr.elements[0]=2*e.near/(c-a),cr.elements[8]=(c+a)/(c-a),this.cameraL.projectionMatrix.copy(cr),a=-o*e.aspect-s,c=o*e.aspect-s,cr.elements[0]=2*e.near/(c-a),cr.elements[8]=(c+a)/(c-a),this.cameraR.projectionMatrix.copy(cr)}this.cameraL.matrixWorld.copy(t.matrixWorld).multiply(ig),this.cameraR.matrixWorld.copy(t.matrixWorld).multiply(ng)}},Nl=class extends Re{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}},Ls=class{constructor(t=!0){this.autoStart=t,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=performance.now(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let t=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){let e=performance.now();t=(e-this.oldTime)/1e3,this.oldTime=e,this.elapsedTime+=t}return t}},lr=new R,xf=new Ze,ib=new R,ur=new R,hr=new R,ed=class extends ue{constructor(){super(),this.type="AudioListener",this.context=oa.getContext(),this.gain=this.context.createGain(),this.gain.connect(this.context.destination),this.filter=null,this.timeDelta=0,this._clock=new Ls}getInput(){return this.gain}removeFilter(){return this.filter!==null&&(this.gain.disconnect(this.filter),this.filter.disconnect(this.context.destination),this.gain.connect(this.context.destination),this.filter=null),this}getFilter(){return this.filter}setFilter(t){return this.filter!==null?(this.gain.disconnect(this.filter),this.filter.disconnect(this.context.destination)):this.gain.disconnect(this.context.destination),this.filter=t,this.gain.connect(this.filter),this.filter.connect(this.context.destination),this}getMasterVolume(){return this.gain.gain.value}setMasterVolume(t){return this.gain.gain.setTargetAtTime(t,this.context.currentTime,.01),this}updateMatrixWorld(t){super.updateMatrixWorld(t);let e=this.context.listener;if(this.timeDelta=this._clock.getDelta(),this.matrixWorld.decompose(lr,xf,ib),ur.set(0,0,-1).applyQuaternion(xf),hr.set(0,1,0).applyQuaternion(xf),e.positionX){let n=this.context.currentTime+this.timeDelta;e.positionX.linearRampToValueAtTime(lr.x,n),e.positionY.linearRampToValueAtTime(lr.y,n),e.positionZ.linearRampToValueAtTime(lr.z,n),e.forwardX.linearRampToValueAtTime(ur.x,n),e.forwardY.linearRampToValueAtTime(ur.y,n),e.forwardZ.linearRampToValueAtTime(ur.z,n),e.upX.linearRampToValueAtTime(hr.x,n),e.upY.linearRampToValueAtTime(hr.y,n),e.upZ.linearRampToValueAtTime(hr.z,n)}else e.setPosition(lr.x,lr.y,lr.z),e.setOrientation(ur.x,ur.y,ur.z,hr.x,hr.y,hr.z)}},Ul=class extends ue{constructor(t){super(),this.type="Audio",this.listener=t,this.context=t.context,this.gain=this.context.createGain(),this.gain.connect(t.getInput()),this.autoplay=!1,this.buffer=null,this.detune=0,this.loop=!1,this.loopStart=0,this.loopEnd=0,this.offset=0,this.duration=void 0,this.playbackRate=1,this.isPlaying=!1,this.hasPlaybackControl=!0,this.source=null,this.sourceType="empty",this._startedAt=0,this._progress=0,this._connected=!1,this.filters=[]}getOutput(){return this.gain}setNodeSource(t){return this.hasPlaybackControl=!1,this.sourceType="audioNode",this.source=t,this.connect(),this}setMediaElementSource(t){return this.hasPlaybackControl=!1,this.sourceType="mediaNode",this.source=this.context.createMediaElementSource(t),this.connect(),this}setMediaStreamSource(t){return this.hasPlaybackControl=!1,this.sourceType="mediaStreamNode",this.source=this.context.createMediaStreamSource(t),this.connect(),this}setBuffer(t){return this.buffer=t,this.sourceType="buffer",this.autoplay&&this.play(),this}play(t=0){if(this.isPlaying===!0){console.warn("THREE.Audio: Audio is already playing.");return}if(this.hasPlaybackControl===!1){console.warn("THREE.Audio: this Audio has no playback control.");return}this._startedAt=this.context.currentTime+t;let e=this.context.createBufferSource();return e.buffer=this.buffer,e.loop=this.loop,e.loopStart=this.loopStart,e.loopEnd=this.loopEnd,e.onended=this.onEnded.bind(this),e.start(this._startedAt,this._progress+this.offset,this.duration),this.isPlaying=!0,this.source=e,this.setDetune(this.detune),this.setPlaybackRate(this.playbackRate),this.connect()}pause(){if(this.hasPlaybackControl===!1){console.warn("THREE.Audio: this Audio has no playback control.");return}return this.isPlaying===!0&&(this._progress+=Math.max(this.context.currentTime-this._startedAt,0)*this.playbackRate,this.loop===!0&&(this._progress=this._progress%(this.duration||this.buffer.duration)),this.source.stop(),this.source.onended=null,this.isPlaying=!1),this}stop(t=0){if(this.hasPlaybackControl===!1){console.warn("THREE.Audio: this Audio has no playback control.");return}return this._progress=0,this.source!==null&&(this.source.stop(this.context.currentTime+t),this.source.onended=null),this.isPlaying=!1,this}connect(){if(this.filters.length>0){this.source.connect(this.filters[0]);for(let t=1,e=this.filters.length;t<e;t++)this.filters[t-1].connect(this.filters[t]);this.filters[this.filters.length-1].connect(this.getOutput())}else this.source.connect(this.getOutput());return this._connected=!0,this}disconnect(){if(this._connected!==!1){if(this.filters.length>0){this.source.disconnect(this.filters[0]);for(let t=1,e=this.filters.length;t<e;t++)this.filters[t-1].disconnect(this.filters[t]);this.filters[this.filters.length-1].disconnect(this.getOutput())}else this.source.disconnect(this.getOutput());return this._connected=!1,this}}getFilters(){return this.filters}setFilters(t){return t||(t=[]),this._connected===!0?(this.disconnect(),this.filters=t.slice(),this.connect()):this.filters=t.slice(),this}setDetune(t){return this.detune=t,this.isPlaying===!0&&this.source.detune!==void 0&&this.source.detune.setTargetAtTime(this.detune,this.context.currentTime,.01),this}getDetune(){return this.detune}getFilter(){return this.getFilters()[0]}setFilter(t){return this.setFilters(t?[t]:[])}setPlaybackRate(t){if(this.hasPlaybackControl===!1){console.warn("THREE.Audio: this Audio has no playback control.");return}return this.playbackRate=t,this.isPlaying===!0&&this.source.playbackRate.setTargetAtTime(this.playbackRate,this.context.currentTime,.01),this}getPlaybackRate(){return this.playbackRate}onEnded(){this.isPlaying=!1,this._progress=0}getLoop(){return this.hasPlaybackControl===!1?(console.warn("THREE.Audio: this Audio has no playback control."),!1):this.loop}setLoop(t){if(this.hasPlaybackControl===!1){console.warn("THREE.Audio: this Audio has no playback control.");return}return this.loop=t,this.isPlaying===!0&&(this.source.loop=this.loop),this}setLoopStart(t){return this.loopStart=t,this}setLoopEnd(t){return this.loopEnd=t,this}getVolume(){return this.gain.gain.value}setVolume(t){return this.gain.gain.setTargetAtTime(t,this.context.currentTime,.01),this}copy(t,e){return super.copy(t,e),t.sourceType!=="buffer"?(console.warn("THREE.Audio: Audio source type cannot be copied."),this):(this.autoplay=t.autoplay,this.buffer=t.buffer,this.detune=t.detune,this.loop=t.loop,this.loopStart=t.loopStart,this.loopEnd=t.loopEnd,this.offset=t.offset,this.duration=t.duration,this.playbackRate=t.playbackRate,this.hasPlaybackControl=t.hasPlaybackControl,this.sourceType=t.sourceType,this.filters=t.filters.slice(),this)}clone(t){return new this.constructor(this.listener).copy(this,t)}},fr=new R,rg=new Ze,rb=new R,dr=new R,nd=class extends Ul{constructor(t){super(t),this.panner=this.context.createPanner(),this.panner.panningModel="HRTF",this.panner.connect(this.gain)}connect(){return super.connect(),this.panner.connect(this.gain),this}disconnect(){return super.disconnect(),this.panner.disconnect(this.gain),this}getOutput(){return this.panner}getRefDistance(){return this.panner.refDistance}setRefDistance(t){return this.panner.refDistance=t,this}getRolloffFactor(){return this.panner.rolloffFactor}setRolloffFactor(t){return this.panner.rolloffFactor=t,this}getDistanceModel(){return this.panner.distanceModel}setDistanceModel(t){return this.panner.distanceModel=t,this}getMaxDistance(){return this.panner.maxDistance}setMaxDistance(t){return this.panner.maxDistance=t,this}setDirectionalCone(t,e,n){return this.panner.coneInnerAngle=t,this.panner.coneOuterAngle=e,this.panner.coneOuterGain=n,this}updateMatrixWorld(t){if(super.updateMatrixWorld(t),this.hasPlaybackControl===!0&&this.isPlaying===!1)return;this.matrixWorld.decompose(fr,rg,rb),dr.set(0,0,1).applyQuaternion(rg);let e=this.panner;if(e.positionX){let n=this.context.currentTime+this.listener.timeDelta;e.positionX.linearRampToValueAtTime(fr.x,n),e.positionY.linearRampToValueAtTime(fr.y,n),e.positionZ.linearRampToValueAtTime(fr.z,n),e.orientationX.linearRampToValueAtTime(dr.x,n),e.orientationY.linearRampToValueAtTime(dr.y,n),e.orientationZ.linearRampToValueAtTime(dr.z,n)}else e.setPosition(fr.x,fr.y,fr.z),e.setOrientation(dr.x,dr.y,dr.z)}},id=class{constructor(t,e=2048){this.analyser=t.context.createAnalyser(),this.analyser.fftSize=e,this.data=new Uint8Array(this.analyser.frequencyBinCount),t.getOutput().connect(this.analyser)}getFrequencyData(){return this.analyser.getByteFrequencyData(this.data),this.data}getAverageFrequency(){let t=0,e=this.getFrequencyData();for(let n=0;n<e.length;n++)t+=e[n];return t/e.length}},Bl=class{constructor(t,e,n){this.binding=t,this.valueSize=n;let i,s,o;switch(e){case"quaternion":i=this._slerp,s=this._slerpAdditive,o=this._setAdditiveIdentityQuaternion,this.buffer=new Float64Array(n*6),this._workIndex=5;break;case"string":case"bool":i=this._select,s=this._select,o=this._setAdditiveIdentityOther,this.buffer=new Array(n*5);break;default:i=this._lerp,s=this._lerpAdditive,o=this._setAdditiveIdentityNumeric,this.buffer=new Float64Array(n*5)}this._mixBufferRegion=i,this._mixBufferRegionAdditive=s,this._setIdentity=o,this._origIndex=3,this._addIndex=4,this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,this.useCount=0,this.referenceCount=0}accumulate(t,e){let n=this.buffer,i=this.valueSize,s=t*i+i,o=this.cumulativeWeight;if(o===0){for(let a=0;a!==i;++a)n[s+a]=n[a];o=e}else{o+=e;let a=e/o;this._mixBufferRegion(n,s,0,a,i)}this.cumulativeWeight=o}accumulateAdditive(t){let e=this.buffer,n=this.valueSize,i=n*this._addIndex;this.cumulativeWeightAdditive===0&&this._setIdentity(),this._mixBufferRegionAdditive(e,i,0,t,n),this.cumulativeWeightAdditive+=t}apply(t){let e=this.valueSize,n=this.buffer,i=t*e+e,s=this.cumulativeWeight,o=this.cumulativeWeightAdditive,a=this.binding;if(this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,s<1){let c=e*this._origIndex;this._mixBufferRegion(n,i,c,1-s,e)}o>0&&this._mixBufferRegionAdditive(n,i,this._addIndex*e,1,e);for(let c=e,l=e+e;c!==l;++c)if(n[c]!==n[c+e]){a.setValue(n,i);break}}saveOriginalState(){let t=this.binding,e=this.buffer,n=this.valueSize,i=n*this._origIndex;t.getValue(e,i);for(let s=n,o=i;s!==o;++s)e[s]=e[i+s%n];this._setIdentity(),this.cumulativeWeight=0,this.cumulativeWeightAdditive=0}restoreOriginalState(){let t=this.valueSize*3;this.binding.setValue(this.buffer,t)}_setAdditiveIdentityNumeric(){let t=this._addIndex*this.valueSize,e=t+this.valueSize;for(let n=t;n<e;n++)this.buffer[n]=0}_setAdditiveIdentityQuaternion(){this._setAdditiveIdentityNumeric(),this.buffer[this._addIndex*this.valueSize+3]=1}_setAdditiveIdentityOther(){let t=this._origIndex*this.valueSize,e=this._addIndex*this.valueSize;for(let n=0;n<this.valueSize;n++)this.buffer[e+n]=this.buffer[t+n]}_select(t,e,n,i,s){if(i>=.5)for(let o=0;o!==s;++o)t[e+o]=t[n+o]}_slerp(t,e,n,i){Ze.slerpFlat(t,e,t,e,t,n,i)}_slerpAdditive(t,e,n,i,s){let o=this._workIndex*s;Ze.multiplyQuaternionsFlat(t,o,t,e,t,n),Ze.slerpFlat(t,e,t,e,t,o,i)}_lerp(t,e,n,i,s){let o=1-i;for(let a=0;a!==s;++a){let c=e+a;t[c]=t[c]*o+t[n+a]*i}}_lerpAdditive(t,e,n,i,s){for(let o=0;o!==s;++o){let a=e+o;t[a]=t[a]+t[n+o]*i}}},Qd="\\[\\]\\.:\\/",sb=new RegExp("["+Qd+"]","g"),jd="[^"+Qd+"]",ob="[^"+Qd.replace("\\.","")+"]",ab=/((?:WC+[\/:])*)/.source.replace("WC",jd),cb=/(WCOD+)?/.source.replace("WCOD",ob),lb=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",jd),ub=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",jd),hb=new RegExp("^"+ab+cb+lb+ub+"$"),fb=["material","materials","bones","map"],rd=class{constructor(t,e,n){let i=n||pe.parseTrackName(e);this._targetGroup=t,this._bindings=t.subscribe_(e,i)}getValue(t,e){this.bind();let n=this._targetGroup.nCachedObjects_,i=this._bindings[n];i!==void 0&&i.getValue(t,e)}setValue(t,e){let n=this._bindings;for(let i=this._targetGroup.nCachedObjects_,s=n.length;i!==s;++i)n[i].setValue(t,e)}bind(){let t=this._bindings;for(let e=this._targetGroup.nCachedObjects_,n=t.length;e!==n;++e)t[e].bind()}unbind(){let t=this._bindings;for(let e=this._targetGroup.nCachedObjects_,n=t.length;e!==n;++e)t[e].unbind()}},pe=class r{constructor(t,e,n){this.path=e,this.parsedPath=n||r.parseTrackName(e),this.node=r.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,e,n){return t&&t.isAnimationObjectGroup?new r.Composite(t,e,n):new r(t,e,n)}static sanitizeNodeName(t){return t.replace(/\s/g,"_").replace(sb,"")}static parseTrackName(t){let e=hb.exec(t);if(e===null)throw new Error("PropertyBinding: Cannot parse trackName: "+t);let n={nodeName:e[2],objectName:e[3],objectIndex:e[4],propertyName:e[5],propertyIndex:e[6]},i=n.nodeName&&n.nodeName.lastIndexOf(".");if(i!==void 0&&i!==-1){let s=n.nodeName.substring(i+1);fb.indexOf(s)!==-1&&(n.nodeName=n.nodeName.substring(0,i),n.objectName=s)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+t);return n}static findNode(t,e){if(e===void 0||e===""||e==="."||e===-1||e===t.name||e===t.uuid)return t;if(t.skeleton){let n=t.skeleton.getBoneByName(e);if(n!==void 0)return n}if(t.children){let n=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===e||a.uuid===e)return a;let c=n(a.children);if(c)return c}return null},i=n(t.children);if(i)return i}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(t,e){t[e]=this.targetObject[this.propertyName]}_getValue_array(t,e){let n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)t[e++]=n[i]}_getValue_arrayElement(t,e){t[e]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(t,e){this.resolvedProperty.toArray(t,e)}_setValue_direct(t,e){this.targetObject[this.propertyName]=t[e]}_setValue_direct_setNeedsUpdate(t,e){this.targetObject[this.propertyName]=t[e],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(t,e){this.targetObject[this.propertyName]=t[e],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(t,e){let n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=t[e++]}_setValue_array_setNeedsUpdate(t,e){let n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=t[e++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(t,e){let n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=t[e++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(t,e){this.resolvedProperty[this.propertyIndex]=t[e]}_setValue_arrayElement_setNeedsUpdate(t,e){this.resolvedProperty[this.propertyIndex]=t[e],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(t,e){this.resolvedProperty[this.propertyIndex]=t[e],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(t,e){this.resolvedProperty.fromArray(t,e)}_setValue_fromArray_setNeedsUpdate(t,e){this.resolvedProperty.fromArray(t,e),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(t,e){this.resolvedProperty.fromArray(t,e),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(t,e){this.bind(),this.getValue(t,e)}_setValue_unbound(t,e){this.bind(),this.setValue(t,e)}bind(){let t=this.node,e=this.parsedPath,n=e.objectName,i=e.propertyName,s=e.propertyIndex;if(t||(t=r.findNode(this.rootNode,e.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let l=e.objectIndex;switch(n){case"materials":if(!t.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}t=t.material.materials;break;case"bones":if(!t.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}t=t.skeleton.bones;for(let f=0;f<t.length;f++)if(t[f].name===l){l=f;break}break;case"map":if("map"in t){t=t.map;break}if(!t.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}t=t.material.map;break;default:if(t[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}t=t[n]}if(l!==void 0){if(t[l]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,t);return}t=t[l]}}let o=t[i];if(o===void 0){let l=e.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+l+"."+i+" but it wasn't found.",t);return}let a=this.Versioning.None;this.targetObject=t,t.isMaterial===!0?a=this.Versioning.NeedsUpdate:t.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(s!==void 0){if(i==="morphTargetInfluences"){if(!t.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!t.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}t.morphTargetDictionary[s]!==void 0&&(s=t.morphTargetDictionary[s])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=i;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};pe.Composite=rd;pe.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};pe.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};pe.prototype.GetterByBindingType=[pe.prototype._getValue_direct,pe.prototype._getValue_array,pe.prototype._getValue_arrayElement,pe.prototype._getValue_toArray];pe.prototype.SetterByBindingTypeAndVersioning=[[pe.prototype._setValue_direct,pe.prototype._setValue_direct_setNeedsUpdate,pe.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[pe.prototype._setValue_array,pe.prototype._setValue_array_setNeedsUpdate,pe.prototype._setValue_array_setMatrixWorldNeedsUpdate],[pe.prototype._setValue_arrayElement,pe.prototype._setValue_arrayElement_setNeedsUpdate,pe.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[pe.prototype._setValue_fromArray,pe.prototype._setValue_fromArray_setNeedsUpdate,pe.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var sd=class{constructor(){this.isAnimationObjectGroup=!0,this.uuid=Cn(),this._objects=Array.prototype.slice.call(arguments),this.nCachedObjects_=0;let t={};this._indicesByUUID=t;for(let n=0,i=arguments.length;n!==i;++n)t[arguments[n].uuid]=n;this._paths=[],this._parsedPaths=[],this._bindings=[],this._bindingsIndicesByPath={};let e=this;this.stats={objects:{get total(){return e._objects.length},get inUse(){return this.total-e.nCachedObjects_}},get bindingsPerObject(){return e._bindings.length}}}add(){let t=this._objects,e=this._indicesByUUID,n=this._paths,i=this._parsedPaths,s=this._bindings,o=s.length,a,c=t.length,l=this.nCachedObjects_;for(let f=0,h=arguments.length;f!==h;++f){let u=arguments[f],d=u.uuid,g=e[d];if(g===void 0){g=c++,e[d]=g,t.push(u);for(let x=0,p=o;x!==p;++x)s[x].push(new pe(u,n[x],i[x]))}else if(g<l){a=t[g];let x=--l,p=t[x];e[p.uuid]=g,t[g]=p,e[d]=x,t[x]=u;for(let m=0,v=o;m!==v;++m){let _=s[m],y=_[x],b=_[g];_[g]=y,b===void 0&&(b=new pe(u,n[m],i[m])),_[x]=b}}else t[g]!==a&&console.error("THREE.AnimationObjectGroup: Different objects with the same UUID detected. Clean the caches or recreate your infrastructure when reloading scenes.")}this.nCachedObjects_=l}remove(){let t=this._objects,e=this._indicesByUUID,n=this._bindings,i=n.length,s=this.nCachedObjects_;for(let o=0,a=arguments.length;o!==a;++o){let c=arguments[o],l=c.uuid,f=e[l];if(f!==void 0&&f>=s){let h=s++,u=t[h];e[u.uuid]=f,t[f]=u,e[l]=h,t[h]=c;for(let d=0,g=i;d!==g;++d){let x=n[d],p=x[h],m=x[f];x[f]=p,x[h]=m}}}this.nCachedObjects_=s}uncache(){let t=this._objects,e=this._indicesByUUID,n=this._bindings,i=n.length,s=this.nCachedObjects_,o=t.length;for(let a=0,c=arguments.length;a!==c;++a){let l=arguments[a],f=l.uuid,h=e[f];if(h!==void 0)if(delete e[f],h<s){let u=--s,d=t[u],g=--o,x=t[g];e[d.uuid]=h,t[h]=d,e[x.uuid]=u,t[u]=x,t.pop();for(let p=0,m=i;p!==m;++p){let v=n[p],_=v[u],y=v[g];v[h]=_,v[u]=y,v.pop()}}else{let u=--o,d=t[u];u>0&&(e[d.uuid]=h),t[h]=d,t.pop();for(let g=0,x=i;g!==x;++g){let p=n[g];p[h]=p[u],p.pop()}}}this.nCachedObjects_=s}subscribe_(t,e){let n=this._bindingsIndicesByPath,i=n[t],s=this._bindings;if(i!==void 0)return s[i];let o=this._paths,a=this._parsedPaths,c=this._objects,l=c.length,f=this.nCachedObjects_,h=new Array(l);i=s.length,n[t]=i,o.push(t),a.push(e),s.push(h);for(let u=f,d=c.length;u!==d;++u){let g=c[u];h[u]=new pe(g,t,e)}return h}unsubscribe_(t){let e=this._bindingsIndicesByPath,n=e[t];if(n!==void 0){let i=this._paths,s=this._parsedPaths,o=this._bindings,a=o.length-1,c=o[a],l=t[a];e[l]=n,o[n]=c,o.pop(),s[n]=s[a],s.pop(),i[n]=i[a],i.pop()}}},Ol=class{constructor(t,e,n=null,i=e.blendMode){this._mixer=t,this._clip=e,this._localRoot=n,this.blendMode=i;let s=e.tracks,o=s.length,a=new Array(o),c={endingStart:mr,endingEnd:mr};for(let l=0;l!==o;++l){let f=s[l].createInterpolant(null);a[l]=f,f.settings=c}this._interpolantSettings=c,this._interpolants=a,this._propertyBindings=new Array(o),this._cacheIndex=null,this._byClipCacheIndex=null,this._timeScaleInterpolant=null,this._weightInterpolant=null,this.loop=Yg,this._loopCount=-1,this._startTime=null,this.time=0,this.timeScale=1,this._effectiveTimeScale=1,this.weight=1,this._effectiveWeight=1,this.repetitions=1/0,this.paused=!1,this.enabled=!0,this.clampWhenFinished=!1,this.zeroSlopeAtStart=!0,this.zeroSlopeAtEnd=!0}play(){return this._mixer._activateAction(this),this}stop(){return this._mixer._deactivateAction(this),this.reset()}reset(){return this.paused=!1,this.enabled=!0,this.time=0,this._loopCount=-1,this._startTime=null,this.stopFading().stopWarping()}isRunning(){return this.enabled&&!this.paused&&this.timeScale!==0&&this._startTime===null&&this._mixer._isActiveAction(this)}isScheduled(){return this._mixer._isActiveAction(this)}startAt(t){return this._startTime=t,this}setLoop(t,e){return this.loop=t,this.repetitions=e,this}setEffectiveWeight(t){return this.weight=t,this._effectiveWeight=this.enabled?t:0,this.stopFading()}getEffectiveWeight(){return this._effectiveWeight}fadeIn(t){return this._scheduleFading(t,0,1)}fadeOut(t){return this._scheduleFading(t,1,0)}crossFadeFrom(t,e,n=!1){if(t.fadeOut(e),this.fadeIn(e),n===!0){let i=this._clip.duration,s=t._clip.duration,o=s/i,a=i/s;t.warp(1,o,e),this.warp(a,1,e)}return this}crossFadeTo(t,e,n=!1){return t.crossFadeFrom(this,e,n)}stopFading(){let t=this._weightInterpolant;return t!==null&&(this._weightInterpolant=null,this._mixer._takeBackControlInterpolant(t)),this}setEffectiveTimeScale(t){return this.timeScale=t,this._effectiveTimeScale=this.paused?0:t,this.stopWarping()}getEffectiveTimeScale(){return this._effectiveTimeScale}setDuration(t){return this.timeScale=this._clip.duration/t,this.stopWarping()}syncWith(t){return this.time=t.time,this.timeScale=t.timeScale,this.stopWarping()}halt(t){return this.warp(this._effectiveTimeScale,0,t)}warp(t,e,n){let i=this._mixer,s=i.time,o=this.timeScale,a=this._timeScaleInterpolant;a===null&&(a=i._lendControlInterpolant(),this._timeScaleInterpolant=a);let c=a.parameterPositions,l=a.sampleValues;return c[0]=s,c[1]=s+n,l[0]=t/o,l[1]=e/o,this}stopWarping(){let t=this._timeScaleInterpolant;return t!==null&&(this._timeScaleInterpolant=null,this._mixer._takeBackControlInterpolant(t)),this}getMixer(){return this._mixer}getClip(){return this._clip}getRoot(){return this._localRoot||this._mixer._root}_update(t,e,n,i){if(!this.enabled){this._updateWeight(t);return}let s=this._startTime;if(s!==null){let c=(t-s)*n;c<0||n===0?e=0:(this._startTime=null,e=n*c)}e*=this._updateTimeScale(t);let o=this._updateTime(e),a=this._updateWeight(t);if(a>0){let c=this._interpolants,l=this._propertyBindings;switch(this.blendMode){case Wd:for(let f=0,h=c.length;f!==h;++f)c[f].evaluate(o),l[f].accumulateAdditive(a);break;case Mu:default:for(let f=0,h=c.length;f!==h;++f)c[f].evaluate(o),l[f].accumulate(i,a)}}}_updateWeight(t){let e=0;if(this.enabled){e=this.weight;let n=this._weightInterpolant;if(n!==null){let i=n.evaluate(t)[0];e*=i,t>n.parameterPositions[1]&&(this.stopFading(),i===0&&(this.enabled=!1))}}return this._effectiveWeight=e,e}_updateTimeScale(t){let e=0;if(!this.paused){e=this.timeScale;let n=this._timeScaleInterpolant;if(n!==null){let i=n.evaluate(t)[0];e*=i,t>n.parameterPositions[1]&&(this.stopWarping(),e===0?this.paused=!0:this.timeScale=e)}}return this._effectiveTimeScale=e,e}_updateTime(t){let e=this._clip.duration,n=this.loop,i=this.time+t,s=this._loopCount,o=n===$g;if(t===0)return s===-1?i:o&&(s&1)===1?e-i:i;if(n===qg){s===-1&&(this._loopCount=0,this._setEndings(!0,!0,!1));t:{if(i>=e)i=e;else if(i<0)i=0;else{this.time=i;break t}this.clampWhenFinished?this.paused=!0:this.enabled=!1,this.time=i,this._mixer.dispatchEvent({type:"finished",action:this,direction:t<0?-1:1})}}else{if(s===-1&&(t>=0?(s=0,this._setEndings(!0,this.repetitions===0,o)):this._setEndings(this.repetitions===0,!0,o)),i>=e||i<0){let a=Math.floor(i/e);i-=e*a,s+=Math.abs(a);let c=this.repetitions-s;if(c<=0)this.clampWhenFinished?this.paused=!0:this.enabled=!1,i=t>0?e:0,this.time=i,this._mixer.dispatchEvent({type:"finished",action:this,direction:t>0?1:-1});else{if(c===1){let l=t<0;this._setEndings(l,!l,o)}else this._setEndings(!1,!1,o);this._loopCount=s,this.time=i,this._mixer.dispatchEvent({type:"loop",action:this,loopDelta:a})}}else this.time=i;if(o&&(s&1)===1)return e-i}return i}_setEndings(t,e,n){let i=this._interpolantSettings;n?(i.endingStart=gr,i.endingEnd=gr):(t?i.endingStart=this.zeroSlopeAtStart?gr:mr:i.endingStart=Ro,e?i.endingEnd=this.zeroSlopeAtEnd?gr:mr:i.endingEnd=Ro)}_scheduleFading(t,e,n){let i=this._mixer,s=i.time,o=this._weightInterpolant;o===null&&(o=i._lendControlInterpolant(),this._weightInterpolant=o);let a=o.parameterPositions,c=o.sampleValues;return a[0]=s,c[0]=e,a[1]=s+t,c[1]=n,this}},db=new Float32Array(1),od=class extends On{constructor(t){super(),this._root=t,this._initMemoryManager(),this._accuIndex=0,this.time=0,this.timeScale=1}_bindAction(t,e){let n=t._localRoot||this._root,i=t._clip.tracks,s=i.length,o=t._propertyBindings,a=t._interpolants,c=n.uuid,l=this._bindingsByRootAndName,f=l[c];f===void 0&&(f={},l[c]=f);for(let h=0;h!==s;++h){let u=i[h],d=u.name,g=f[d];if(g!==void 0)++g.referenceCount,o[h]=g;else{if(g=o[h],g!==void 0){g._cacheIndex===null&&(++g.referenceCount,this._addInactiveBinding(g,c,d));continue}let x=e&&e._propertyBindings[h].binding.parsedPath;g=new Bl(pe.create(n,d,x),u.ValueTypeName,u.getValueSize()),++g.referenceCount,this._addInactiveBinding(g,c,d),o[h]=g}a[h].resultBuffer=g.buffer}}_activateAction(t){if(!this._isActiveAction(t)){if(t._cacheIndex===null){let n=(t._localRoot||this._root).uuid,i=t._clip.uuid,s=this._actionsByClip[i];this._bindAction(t,s&&s.knownActions[0]),this._addInactiveAction(t,i,n)}let e=t._propertyBindings;for(let n=0,i=e.length;n!==i;++n){let s=e[n];s.useCount++===0&&(this._lendBinding(s),s.saveOriginalState())}this._lendAction(t)}}_deactivateAction(t){if(this._isActiveAction(t)){let e=t._propertyBindings;for(let n=0,i=e.length;n!==i;++n){let s=e[n];--s.useCount===0&&(s.restoreOriginalState(),this._takeBackBinding(s))}this._takeBackAction(t)}}_initMemoryManager(){this._actions=[],this._nActiveActions=0,this._actionsByClip={},this._bindings=[],this._nActiveBindings=0,this._bindingsByRootAndName={},this._controlInterpolants=[],this._nActiveControlInterpolants=0;let t=this;this.stats={actions:{get total(){return t._actions.length},get inUse(){return t._nActiveActions}},bindings:{get total(){return t._bindings.length},get inUse(){return t._nActiveBindings}},controlInterpolants:{get total(){return t._controlInterpolants.length},get inUse(){return t._nActiveControlInterpolants}}}}_isActiveAction(t){let e=t._cacheIndex;return e!==null&&e<this._nActiveActions}_addInactiveAction(t,e,n){let i=this._actions,s=this._actionsByClip,o=s[e];if(o===void 0)o={knownActions:[t],actionByRoot:{}},t._byClipCacheIndex=0,s[e]=o;else{let a=o.knownActions;t._byClipCacheIndex=a.length,a.push(t)}t._cacheIndex=i.length,i.push(t),o.actionByRoot[n]=t}_removeInactiveAction(t){let e=this._actions,n=e[e.length-1],i=t._cacheIndex;n._cacheIndex=i,e[i]=n,e.pop(),t._cacheIndex=null;let s=t._clip.uuid,o=this._actionsByClip,a=o[s],c=a.knownActions,l=c[c.length-1],f=t._byClipCacheIndex;l._byClipCacheIndex=f,c[f]=l,c.pop(),t._byClipCacheIndex=null;let h=a.actionByRoot,u=(t._localRoot||this._root).uuid;delete h[u],c.length===0&&delete o[s],this._removeInactiveBindingsForAction(t)}_removeInactiveBindingsForAction(t){let e=t._propertyBindings;for(let n=0,i=e.length;n!==i;++n){let s=e[n];--s.referenceCount===0&&this._removeInactiveBinding(s)}}_lendAction(t){let e=this._actions,n=t._cacheIndex,i=this._nActiveActions++,s=e[i];t._cacheIndex=i,e[i]=t,s._cacheIndex=n,e[n]=s}_takeBackAction(t){let e=this._actions,n=t._cacheIndex,i=--this._nActiveActions,s=e[i];t._cacheIndex=i,e[i]=t,s._cacheIndex=n,e[n]=s}_addInactiveBinding(t,e,n){let i=this._bindingsByRootAndName,s=this._bindings,o=i[e];o===void 0&&(o={},i[e]=o),o[n]=t,t._cacheIndex=s.length,s.push(t)}_removeInactiveBinding(t){let e=this._bindings,n=t.binding,i=n.rootNode.uuid,s=n.path,o=this._bindingsByRootAndName,a=o[i],c=e[e.length-1],l=t._cacheIndex;c._cacheIndex=l,e[l]=c,e.pop(),delete a[s],Object.keys(a).length===0&&delete o[i]}_lendBinding(t){let e=this._bindings,n=t._cacheIndex,i=this._nActiveBindings++,s=e[i];t._cacheIndex=i,e[i]=t,s._cacheIndex=n,e[n]=s}_takeBackBinding(t){let e=this._bindings,n=t._cacheIndex,i=--this._nActiveBindings,s=e[i];t._cacheIndex=i,e[i]=t,s._cacheIndex=n,e[n]=s}_lendControlInterpolant(){let t=this._controlInterpolants,e=this._nActiveControlInterpolants++,n=t[e];return n===void 0&&(n=new ea(new Float32Array(2),new Float32Array(2),1,db),n.__cacheIndex=e,t[e]=n),n}_takeBackControlInterpolant(t){let e=this._controlInterpolants,n=t.__cacheIndex,i=--this._nActiveControlInterpolants,s=e[i];t.__cacheIndex=i,e[i]=t,s.__cacheIndex=n,e[n]=s}clipAction(t,e,n){let i=e||this._root,s=i.uuid,o=typeof t=="string"?Ir.findByName(i,t):t,a=o!==null?o.uuid:t,c=this._actionsByClip[a],l=null;if(n===void 0&&(o!==null?n=o.blendMode:n=Mu),c!==void 0){let h=c.actionByRoot[s];if(h!==void 0&&h.blendMode===n)return h;l=c.knownActions[0],o===null&&(o=l._clip)}if(o===null)return null;let f=new Ol(this,o,e,n);return this._bindAction(f,l),this._addInactiveAction(f,a,s),f}existingAction(t,e){let n=e||this._root,i=n.uuid,s=typeof t=="string"?Ir.findByName(n,t):t,o=s?s.uuid:t,a=this._actionsByClip[o];return a!==void 0&&a.actionByRoot[i]||null}stopAllAction(){let t=this._actions,e=this._nActiveActions;for(let n=e-1;n>=0;--n)t[n].stop();return this}update(t){t*=this.timeScale;let e=this._actions,n=this._nActiveActions,i=this.time+=t,s=Math.sign(t),o=this._accuIndex^=1;for(let l=0;l!==n;++l)e[l]._update(i,t,s,o);let a=this._bindings,c=this._nActiveBindings;for(let l=0;l!==c;++l)a[l].apply(o);return this}setTime(t){this.time=0;for(let e=0;e<this._actions.length;e++)this._actions[e].time=0;return this.update(t)}getRoot(){return this._root}uncacheClip(t){let e=this._actions,n=t.uuid,i=this._actionsByClip,s=i[n];if(s!==void 0){let o=s.knownActions;for(let a=0,c=o.length;a!==c;++a){let l=o[a];this._deactivateAction(l);let f=l._cacheIndex,h=e[e.length-1];l._cacheIndex=null,l._byClipCacheIndex=null,h._cacheIndex=f,e[f]=h,e.pop(),this._removeInactiveBindingsForAction(l)}delete i[n]}}uncacheRoot(t){let e=t.uuid,n=this._actionsByClip;for(let o in n){let a=n[o].actionByRoot,c=a[e];c!==void 0&&(this._deactivateAction(c),this._removeInactiveAction(c))}let i=this._bindingsByRootAndName,s=i[e];if(s!==void 0)for(let o in s){let a=s[o];a.restoreOriginalState(),this._removeInactiveBinding(a)}}uncacheAction(t,e){let n=this.existingAction(t,e);n!==null&&(this._deactivateAction(n),this._removeInactiveAction(n))}},ad=class extends Po{constructor(t=1,e=1,n=1,i={}){super(t,e,i),this.isRenderTarget3D=!0,this.depth=n,this.texture=new bs(null,t,e,n),this._setTextureOptions(i),this.texture.isRenderTargetTexture=!0}},cd=class r{constructor(t){this.value=t}clone(){return new r(this.value.clone===void 0?this.value:this.value.clone())}},pb=0,ld=class extends On{constructor(){super(),this.isUniformsGroup=!0,Object.defineProperty(this,"id",{value:pb++}),this.name="",this.usage=Io,this.uniforms=[]}add(t){return this.uniforms.push(t),this}remove(t){let e=this.uniforms.indexOf(t);return e!==-1&&this.uniforms.splice(e,1),this}setName(t){return this.name=t,this}setUsage(t){return this.usage=t,this}dispose(){this.dispatchEvent({type:"dispose"})}copy(t){this.name=t.name,this.usage=t.usage;let e=t.uniforms;this.uniforms.length=0;for(let n=0,i=e.length;n<i;n++){let s=Array.isArray(e[n])?e[n]:[e[n]];for(let o=0;o<s.length;o++)this.uniforms.push(s[o].clone())}return this}clone(){return new this.constructor().copy(this)}},ud=class extends As{constructor(t,e,n=1){super(t,e),this.isInstancedInterleavedBuffer=!0,this.meshPerAttribute=n}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}clone(t){let e=super.clone(t);return e.meshPerAttribute=this.meshPerAttribute,e}toJSON(t){let e=super.toJSON(t);return e.isInstancedInterleavedBuffer=!0,e.meshPerAttribute=this.meshPerAttribute,e}},hd=class{constructor(t,e,n,i,s,o=!1){this.isGLBufferAttribute=!0,this.name="",this.buffer=t,this.type=e,this.itemSize=n,this.elementSize=i,this.count=s,this.normalized=o,this.version=0}set needsUpdate(t){t===!0&&this.version++}setBuffer(t){return this.buffer=t,this}setType(t,e){return this.type=t,this.elementSize=e,this}setItemSize(t){return this.itemSize=t,this}setCount(t){return this.count=t,this}},sg=new gt,fd=class{constructor(t,e,n=0,i=1/0){this.ray=new ii(t,e),this.near=n,this.far=i,this.camera=null,this.layers=new Ss,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(t,e){this.ray.set(t,e)}setFromCamera(t,e){e.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(t.x,t.y,.5).unproject(e).sub(this.ray.origin).normalize(),this.camera=e):e.isOrthographicCamera?(this.ray.origin.set(t.x,t.y,(e.near+e.far)/(e.near-e.far)).unproject(e),this.ray.direction.set(0,0,-1).transformDirection(e.matrixWorld),this.camera=e):console.error("THREE.Raycaster: Unsupported camera type: "+e.type)}setFromXRController(t){return sg.identity().extractRotation(t.matrixWorld),this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(sg),this}intersectObject(t,e=!0,n=[]){return dd(t,this,n,e),n.sort(og),n}intersectObjects(t,e=!0,n=[]){for(let i=0,s=t.length;i<s;i++)dd(t[i],this,n,e);return n.sort(og),n}};function og(r,t){return r.distance-t.distance}function dd(r,t,e,n){let i=!0;if(r.layers.test(t.layers)&&r.raycast(t,e)===!1&&(i=!1),i===!0&&n===!0){let s=r.children;for(let o=0,a=s.length;o<a;o++)dd(s[o],t,e,!0)}}var pd=class{constructor(){this._previousTime=0,this._currentTime=0,this._startTime=performance.now(),this._delta=0,this._elapsed=0,this._timescale=1,this._document=null,this._pageVisibilityHandler=null}connect(t){this._document=t,t.hidden!==void 0&&(this._pageVisibilityHandler=mb.bind(this),t.addEventListener("visibilitychange",this._pageVisibilityHandler,!1))}disconnect(){this._pageVisibilityHandler!==null&&(this._document.removeEventListener("visibilitychange",this._pageVisibilityHandler),this._pageVisibilityHandler=null),this._document=null}getDelta(){return this._delta/1e3}getElapsed(){return this._elapsed/1e3}getTimescale(){return this._timescale}setTimescale(t){return this._timescale=t,this}reset(){return this._currentTime=performance.now()-this._startTime,this}dispose(){this.disconnect()}update(t){return this._pageVisibilityHandler!==null&&this._document.hidden===!0?this._delta=0:(this._previousTime=this._currentTime,this._currentTime=(t!==void 0?t:performance.now())-this._startTime,this._delta=(this._currentTime-this._previousTime)*this._timescale,this._elapsed+=this._delta),this}};function mb(){this._document.hidden===!1&&this.reset()}var aa=class{constructor(t=1,e=0,n=0){this.radius=t,this.phi=e,this.theta=n}set(t,e,n){return this.radius=t,this.phi=e,this.theta=n,this}copy(t){return this.radius=t.radius,this.phi=t.phi,this.theta=t.theta,this}makeSafe(){return this.phi=Bt(this.phi,1e-6,Math.PI-1e-6),this}setFromVector3(t){return this.setFromCartesianCoords(t.x,t.y,t.z)}setFromCartesianCoords(t,e,n){return this.radius=Math.sqrt(t*t+e*e+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(t,n),this.phi=Math.acos(Bt(e/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}},md=class{constructor(t=1,e=0,n=0){this.radius=t,this.theta=e,this.y=n}set(t,e,n){return this.radius=t,this.theta=e,this.y=n,this}copy(t){return this.radius=t.radius,this.theta=t.theta,this.y=t.y,this}setFromVector3(t){return this.setFromCartesianCoords(t.x,t.y,t.z)}setFromCartesianCoords(t,e,n){return this.radius=Math.sqrt(t*t+n*n),this.theta=Math.atan2(t,n),this.y=e,this}clone(){return new this.constructor().copy(this)}},gd=class r{constructor(t,e,n,i){r.prototype.isMatrix2=!0,this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,n,i)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let n=0;n<4;n++)this.elements[n]=t[n+e];return this}set(t,e,n,i){let s=this.elements;return s[0]=t,s[2]=e,s[1]=n,s[3]=i,this}},ag=new q,xd=class{constructor(t=new q(1/0,1/0),e=new q(-1/0,-1/0)){this.isBox2=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){let n=ag.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=1/0,this.max.x=this.max.y=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y}getCenter(t){return this.isEmpty()?t.set(0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,ag).distanceTo(t)}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}},cg=new R,bc=new R,ds=new R,ps=new R,vf=new R,gb=new R,xb=new R,dn=class{constructor(t=new R,e=new R){this.start=t,this.end=e}set(t,e){return this.start.copy(t),this.end.copy(e),this}copy(t){return this.start.copy(t.start),this.end.copy(t.end),this}getCenter(t){return t.addVectors(this.start,this.end).multiplyScalar(.5)}delta(t){return t.subVectors(this.end,this.start)}distanceSq(){return this.start.distanceToSquared(this.end)}distance(){return this.start.distanceTo(this.end)}at(t,e){return this.delta(e).multiplyScalar(t).add(this.start)}closestPointToPointParameter(t,e){cg.subVectors(t,this.start),bc.subVectors(this.end,this.start);let n=bc.dot(bc),s=bc.dot(cg)/n;return e&&(s=Bt(s,0,1)),s}closestPointToPoint(t,e,n){let i=this.closestPointToPointParameter(t,e);return this.delta(n).multiplyScalar(i).add(this.start)}distanceSqToLine3(t,e=gb,n=xb){let i=10000000000000001e-32,s,o,a=this.start,c=t.start,l=this.end,f=t.end;ds.subVectors(l,a),ps.subVectors(f,c),vf.subVectors(a,c);let h=ds.dot(ds),u=ps.dot(ps),d=ps.dot(vf);if(h<=i&&u<=i)return e.copy(a),n.copy(c),e.sub(n),e.dot(e);if(h<=i)s=0,o=d/u,o=Bt(o,0,1);else{let g=ds.dot(vf);if(u<=i)o=0,s=Bt(-g/h,0,1);else{let x=ds.dot(ps),p=h*u-x*x;p!==0?s=Bt((x*d-g*u)/p,0,1):s=0,o=(x*s+d)/u,o<0?(o=0,s=Bt(-g/h,0,1)):o>1&&(o=1,s=Bt((x-g)/h,0,1))}}return e.copy(a).add(ds.multiplyScalar(s)),n.copy(c).add(ps.multiplyScalar(o)),e.sub(n),e.dot(e)}applyMatrix4(t){return this.start.applyMatrix4(t),this.end.applyMatrix4(t),this}equals(t){return t.start.equals(this.start)&&t.end.equals(this.end)}clone(){return new this.constructor().copy(this)}},lg=new R,vd=class extends ue{constructor(t,e){super(),this.light=t,this.matrixAutoUpdate=!1,this.color=e,this.type="SpotLightHelper";let n=new Ft,i=[0,0,0,0,0,1,0,0,0,1,0,1,0,0,0,-1,0,1,0,0,0,0,1,1,0,0,0,0,-1,1];for(let o=0,a=1,c=32;o<c;o++,a++){let l=o/c*Math.PI*2,f=a/c*Math.PI*2;i.push(Math.cos(l),Math.sin(l),1,Math.cos(f),Math.sin(f),1)}n.setAttribute("position",new bt(i,3));let s=new Qe({fog:!1,toneMapped:!1});this.cone=new kn(n,s),this.add(this.cone),this.update()}dispose(){this.cone.geometry.dispose(),this.cone.material.dispose()}update(){this.light.updateWorldMatrix(!0,!1),this.light.target.updateWorldMatrix(!0,!1),this.parent?(this.parent.updateWorldMatrix(!0),this.matrix.copy(this.parent.matrixWorld).invert().multiply(this.light.matrixWorld)):this.matrix.copy(this.light.matrixWorld),this.matrixWorld.copy(this.light.matrixWorld);let t=this.light.distance?this.light.distance:1e3,e=t*Math.tan(this.light.angle);this.cone.scale.set(e,e,t),lg.setFromMatrixPosition(this.light.target.matrixWorld),this.cone.lookAt(lg),this.color!==void 0?this.cone.material.color.set(this.color):this.cone.material.color.copy(this.light.color)}},Fi=new R,Sc=new gt,_f=new gt,_d=class extends kn{constructor(t){let e=x0(t),n=new Ft,i=[],s=[];for(let l=0;l<e.length;l++){let f=e[l];f.parent&&f.parent.isBone&&(i.push(0,0,0),i.push(0,0,0),s.push(0,0,0),s.push(0,0,0))}n.setAttribute("position",new bt(i,3)),n.setAttribute("color",new bt(s,3));let o=new Qe({vertexColors:!0,depthTest:!1,depthWrite:!1,toneMapped:!1,transparent:!0});super(n,o),this.isSkeletonHelper=!0,this.type="SkeletonHelper",this.root=t,this.bones=e,this.matrix=t.matrixWorld,this.matrixAutoUpdate=!1;let a=new ft(255),c=new ft(65280);this.setColors(a,c)}updateMatrixWorld(t){let e=this.bones,n=this.geometry,i=n.getAttribute("position");_f.copy(this.root.matrixWorld).invert();for(let s=0,o=0;s<e.length;s++){let a=e[s];a.parent&&a.parent.isBone&&(Sc.multiplyMatrices(_f,a.matrixWorld),Fi.setFromMatrixPosition(Sc),i.setXYZ(o,Fi.x,Fi.y,Fi.z),Sc.multiplyMatrices(_f,a.parent.matrixWorld),Fi.setFromMatrixPosition(Sc),i.setXYZ(o+1,Fi.x,Fi.y,Fi.z),o+=2)}n.getAttribute("position").needsUpdate=!0,super.updateMatrixWorld(t)}setColors(t,e){let i=this.geometry.getAttribute("color");for(let s=0;s<i.count;s+=2)i.setXYZ(s,t.r,t.g,t.b),i.setXYZ(s+1,e.r,e.g,e.b);return i.needsUpdate=!0,this}dispose(){this.geometry.dispose(),this.material.dispose()}};function x0(r){let t=[];r.isBone===!0&&t.push(r);for(let e=0;e<r.children.length;e++)t.push(...x0(r.children[e]));return t}var yd=class extends Me{constructor(t,e,n){let i=new Ko(e,4,2),s=new zn({wireframe:!0,fog:!1,toneMapped:!1});super(i,s),this.light=t,this.color=n,this.type="PointLightHelper",this.matrix=this.light.matrixWorld,this.matrixAutoUpdate=!1,this.update()}dispose(){this.geometry.dispose(),this.material.dispose()}update(){this.light.updateWorldMatrix(!0,!1),this.color!==void 0?this.material.color.set(this.color):this.material.color.copy(this.light.color)}},vb=new R,ug=new ft,hg=new ft,bd=class extends ue{constructor(t,e,n){super(),this.light=t,this.matrix=t.matrixWorld,this.matrixAutoUpdate=!1,this.color=n,this.type="HemisphereLightHelper";let i=new Jo(e);i.rotateY(Math.PI*.5),this.material=new zn({wireframe:!0,fog:!1,toneMapped:!1}),this.color===void 0&&(this.material.vertexColors=!0);let s=i.getAttribute("position"),o=new Float32Array(s.count*3);i.setAttribute("color",new Ot(o,3)),this.add(new Me(i,this.material)),this.update()}dispose(){this.children[0].geometry.dispose(),this.children[0].material.dispose()}update(){let t=this.children[0];if(this.color!==void 0)this.material.color.set(this.color);else{let e=t.geometry.getAttribute("color");ug.copy(this.light.color),hg.copy(this.light.groundColor);for(let n=0,i=e.count;n<i;n++){let s=n<i/2?ug:hg;e.setXYZ(n,s.r,s.g,s.b)}e.needsUpdate=!0}this.light.updateWorldMatrix(!0,!1),t.lookAt(vb.setFromMatrixPosition(this.light.matrixWorld).negate())}},Sd=class extends kn{constructor(t=10,e=10,n=4473924,i=8947848){n=new ft(n),i=new ft(i);let s=e/2,o=t/e,a=t/2,c=[],l=[];for(let u=0,d=0,g=-a;u<=e;u++,g+=o){c.push(-a,0,g,a,0,g),c.push(g,0,-a,g,0,a);let x=u===s?n:i;x.toArray(l,d),d+=3,x.toArray(l,d),d+=3,x.toArray(l,d),d+=3,x.toArray(l,d),d+=3}let f=new Ft;f.setAttribute("position",new bt(c,3)),f.setAttribute("color",new bt(l,3));let h=new Qe({vertexColors:!0,toneMapped:!1});super(f,h),this.type="GridHelper"}dispose(){this.geometry.dispose(),this.material.dispose()}},Md=class extends kn{constructor(t=10,e=16,n=8,i=64,s=4473924,o=8947848){s=new ft(s),o=new ft(o);let a=[],c=[];if(e>1)for(let h=0;h<e;h++){let u=h/e*(Math.PI*2),d=Math.sin(u)*t,g=Math.cos(u)*t;a.push(0,0,0),a.push(d,0,g);let x=h&1?s:o;c.push(x.r,x.g,x.b),c.push(x.r,x.g,x.b)}for(let h=0;h<n;h++){let u=h&1?s:o,d=t-t/n*h;for(let g=0;g<i;g++){let x=g/i*(Math.PI*2),p=Math.sin(x)*d,m=Math.cos(x)*d;a.push(p,0,m),c.push(u.r,u.g,u.b),x=(g+1)/i*(Math.PI*2),p=Math.sin(x)*d,m=Math.cos(x)*d,a.push(p,0,m),c.push(u.r,u.g,u.b)}}let l=new Ft;l.setAttribute("position",new bt(a,3)),l.setAttribute("color",new bt(c,3));let f=new Qe({vertexColors:!0,toneMapped:!1});super(l,f),this.type="PolarGridHelper"}dispose(){this.geometry.dispose(),this.material.dispose()}},fg=new R,Mc=new R,dg=new R,Td=class extends ue{constructor(t,e,n){super(),this.light=t,this.matrix=t.matrixWorld,this.matrixAutoUpdate=!1,this.color=n,this.type="DirectionalLightHelper",e===void 0&&(e=1);let i=new Ft;i.setAttribute("position",new bt([-e,e,0,e,e,0,e,-e,0,-e,-e,0,-e,e,0],3));let s=new Qe({fog:!1,toneMapped:!1});this.lightPlane=new ri(i,s),this.add(this.lightPlane),i=new Ft,i.setAttribute("position",new bt([0,0,0,0,0,1],3)),this.targetLine=new ri(i,s),this.add(this.targetLine),this.update()}dispose(){this.lightPlane.geometry.dispose(),this.lightPlane.material.dispose(),this.targetLine.geometry.dispose(),this.targetLine.material.dispose()}update(){this.light.updateWorldMatrix(!0,!1),this.light.target.updateWorldMatrix(!0,!1),fg.setFromMatrixPosition(this.light.matrixWorld),Mc.setFromMatrixPosition(this.light.target.matrixWorld),dg.subVectors(Mc,fg),this.lightPlane.lookAt(Mc),this.color!==void 0?(this.lightPlane.material.color.set(this.color),this.targetLine.material.color.set(this.color)):(this.lightPlane.material.color.copy(this.light.color),this.targetLine.material.color.copy(this.light.color)),this.targetLine.lookAt(Mc),this.targetLine.scale.z=dg.length()}},Tc=new R,De=new Ms,wd=class extends kn{constructor(t){let e=new Ft,n=new Qe({color:16777215,vertexColors:!0,toneMapped:!1}),i=[],s=[],o={};a("n1","n2"),a("n2","n4"),a("n4","n3"),a("n3","n1"),a("f1","f2"),a("f2","f4"),a("f4","f3"),a("f3","f1"),a("n1","f1"),a("n2","f2"),a("n3","f3"),a("n4","f4"),a("p","n1"),a("p","n2"),a("p","n3"),a("p","n4"),a("u1","u2"),a("u2","u3"),a("u3","u1"),a("c","t"),a("p","c"),a("cn1","cn2"),a("cn3","cn4"),a("cf1","cf2"),a("cf3","cf4");function a(g,x){c(g),c(x)}function c(g){i.push(0,0,0),s.push(0,0,0),o[g]===void 0&&(o[g]=[]),o[g].push(i.length/3-1)}e.setAttribute("position",new bt(i,3)),e.setAttribute("color",new bt(s,3)),super(e,n),this.type="CameraHelper",this.camera=t,this.camera.updateProjectionMatrix&&this.camera.updateProjectionMatrix(),this.matrix=t.matrixWorld,this.matrixAutoUpdate=!1,this.pointMap=o,this.update();let l=new ft(16755200),f=new ft(16711680),h=new ft(43775),u=new ft(16777215),d=new ft(3355443);this.setColors(l,f,h,u,d)}setColors(t,e,n,i,s){let a=this.geometry.getAttribute("color");return a.setXYZ(0,t.r,t.g,t.b),a.setXYZ(1,t.r,t.g,t.b),a.setXYZ(2,t.r,t.g,t.b),a.setXYZ(3,t.r,t.g,t.b),a.setXYZ(4,t.r,t.g,t.b),a.setXYZ(5,t.r,t.g,t.b),a.setXYZ(6,t.r,t.g,t.b),a.setXYZ(7,t.r,t.g,t.b),a.setXYZ(8,t.r,t.g,t.b),a.setXYZ(9,t.r,t.g,t.b),a.setXYZ(10,t.r,t.g,t.b),a.setXYZ(11,t.r,t.g,t.b),a.setXYZ(12,t.r,t.g,t.b),a.setXYZ(13,t.r,t.g,t.b),a.setXYZ(14,t.r,t.g,t.b),a.setXYZ(15,t.r,t.g,t.b),a.setXYZ(16,t.r,t.g,t.b),a.setXYZ(17,t.r,t.g,t.b),a.setXYZ(18,t.r,t.g,t.b),a.setXYZ(19,t.r,t.g,t.b),a.setXYZ(20,t.r,t.g,t.b),a.setXYZ(21,t.r,t.g,t.b),a.setXYZ(22,t.r,t.g,t.b),a.setXYZ(23,t.r,t.g,t.b),a.setXYZ(24,e.r,e.g,e.b),a.setXYZ(25,e.r,e.g,e.b),a.setXYZ(26,e.r,e.g,e.b),a.setXYZ(27,e.r,e.g,e.b),a.setXYZ(28,e.r,e.g,e.b),a.setXYZ(29,e.r,e.g,e.b),a.setXYZ(30,e.r,e.g,e.b),a.setXYZ(31,e.r,e.g,e.b),a.setXYZ(32,n.r,n.g,n.b),a.setXYZ(33,n.r,n.g,n.b),a.setXYZ(34,n.r,n.g,n.b),a.setXYZ(35,n.r,n.g,n.b),a.setXYZ(36,n.r,n.g,n.b),a.setXYZ(37,n.r,n.g,n.b),a.setXYZ(38,i.r,i.g,i.b),a.setXYZ(39,i.r,i.g,i.b),a.setXYZ(40,s.r,s.g,s.b),a.setXYZ(41,s.r,s.g,s.b),a.setXYZ(42,s.r,s.g,s.b),a.setXYZ(43,s.r,s.g,s.b),a.setXYZ(44,s.r,s.g,s.b),a.setXYZ(45,s.r,s.g,s.b),a.setXYZ(46,s.r,s.g,s.b),a.setXYZ(47,s.r,s.g,s.b),a.setXYZ(48,s.r,s.g,s.b),a.setXYZ(49,s.r,s.g,s.b),a.needsUpdate=!0,this}update(){let t=this.geometry,e=this.pointMap,n=1,i=1,s,o;if(De.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse),this.camera.reversedDepth===!0)s=1,o=0;else if(this.camera.coordinateSystem===Rn)s=-1,o=1;else if(this.camera.coordinateSystem===vs)s=0,o=1;else throw new Error("THREE.CameraHelper.update(): Invalid coordinate system: "+this.camera.coordinateSystem);Ne("c",e,t,De,0,0,s),Ne("t",e,t,De,0,0,o),Ne("n1",e,t,De,-n,-i,s),Ne("n2",e,t,De,n,-i,s),Ne("n3",e,t,De,-n,i,s),Ne("n4",e,t,De,n,i,s),Ne("f1",e,t,De,-n,-i,o),Ne("f2",e,t,De,n,-i,o),Ne("f3",e,t,De,-n,i,o),Ne("f4",e,t,De,n,i,o),Ne("u1",e,t,De,n*.7,i*1.1,s),Ne("u2",e,t,De,-n*.7,i*1.1,s),Ne("u3",e,t,De,0,i*2,s),Ne("cf1",e,t,De,-n,0,o),Ne("cf2",e,t,De,n,0,o),Ne("cf3",e,t,De,0,-i,o),Ne("cf4",e,t,De,0,i,o),Ne("cn1",e,t,De,-n,0,s),Ne("cn2",e,t,De,n,0,s),Ne("cn3",e,t,De,0,-i,s),Ne("cn4",e,t,De,0,i,s),t.getAttribute("position").needsUpdate=!0}dispose(){this.geometry.dispose(),this.material.dispose()}};function Ne(r,t,e,n,i,s,o){Tc.set(i,s,o).unproject(n);let a=t[r];if(a!==void 0){let c=e.getAttribute("position");for(let l=0,f=a.length;l<f;l++)c.setXYZ(a[l],Tc.x,Tc.y,Tc.z)}}var wc=new se,Ad=class extends kn{constructor(t,e=16776960){let n=new Uint16Array([0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7]),i=new Float32Array(24),s=new Ft;s.setIndex(new Ot(n,1)),s.setAttribute("position",new Ot(i,3)),super(s,new Qe({color:e,toneMapped:!1})),this.object=t,this.type="BoxHelper",this.matrixAutoUpdate=!1,this.update()}update(){if(this.object!==void 0&&wc.setFromObject(this.object),wc.isEmpty())return;let t=wc.min,e=wc.max,n=this.geometry.attributes.position,i=n.array;i[0]=e.x,i[1]=e.y,i[2]=e.z,i[3]=t.x,i[4]=e.y,i[5]=e.z,i[6]=t.x,i[7]=t.y,i[8]=e.z,i[9]=e.x,i[10]=t.y,i[11]=e.z,i[12]=e.x,i[13]=e.y,i[14]=t.z,i[15]=t.x,i[16]=e.y,i[17]=t.z,i[18]=t.x,i[19]=t.y,i[20]=t.z,i[21]=e.x,i[22]=t.y,i[23]=t.z,n.needsUpdate=!0,this.geometry.computeBoundingSphere()}setFromObject(t){return this.object=t,this.update(),this}copy(t,e){return super.copy(t,e),this.object=t.object,this}dispose(){this.geometry.dispose(),this.material.dispose()}},Ed=class extends kn{constructor(t,e=16776960){let n=new Uint16Array([0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7]),i=[1,1,1,-1,1,1,-1,-1,1,1,-1,1,1,1,-1,-1,1,-1,-1,-1,-1,1,-1,-1],s=new Ft;s.setIndex(new Ot(n,1)),s.setAttribute("position",new bt(i,3)),super(s,new Qe({color:e,toneMapped:!1})),this.box=t,this.type="Box3Helper",this.geometry.computeBoundingSphere()}updateMatrixWorld(t){let e=this.box;e.isEmpty()||(e.getCenter(this.position),e.getSize(this.scale),this.scale.multiplyScalar(.5),super.updateMatrixWorld(t))}dispose(){this.geometry.dispose(),this.material.dispose()}},Rd=class extends ri{constructor(t,e=1,n=16776960){let i=n,s=[1,-1,0,-1,1,0,-1,-1,0,1,1,0,-1,1,0,-1,-1,0,1,-1,0,1,1,0],o=new Ft;o.setAttribute("position",new bt(s,3)),o.computeBoundingSphere(),super(o,new Qe({color:i,toneMapped:!1})),this.type="PlaneHelper",this.plane=t,this.size=e;let a=[1,1,0,-1,1,0,-1,-1,0,1,1,0,-1,-1,0,1,-1,0],c=new Ft;c.setAttribute("position",new bt(a,3)),c.computeBoundingSphere(),this.add(new Me(c,new zn({color:i,opacity:.2,transparent:!0,depthWrite:!1,toneMapped:!1})))}updateMatrixWorld(t){this.position.set(0,0,0),this.scale.set(.5*this.size,.5*this.size,1),this.lookAt(this.plane.normal),this.translateZ(-this.plane.constant),super.updateMatrixWorld(t)}dispose(){this.geometry.dispose(),this.material.dispose(),this.children[0].geometry.dispose(),this.children[0].material.dispose()}},pg=new R,Ac,yf,Cd=class extends ue{constructor(t=new R(0,0,1),e=new R(0,0,0),n=1,i=16776960,s=n*.2,o=s*.2){super(),this.type="ArrowHelper",Ac===void 0&&(Ac=new Ft,Ac.setAttribute("position",new bt([0,0,0,0,1,0],3)),yf=new Vo(.5,1,5,1),yf.translate(0,-.5,0)),this.position.copy(e),this.line=new ri(Ac,new Qe({color:i,toneMapped:!1})),this.line.matrixAutoUpdate=!1,this.add(this.line),this.cone=new Me(yf,new zn({color:i,toneMapped:!1})),this.cone.matrixAutoUpdate=!1,this.add(this.cone),this.setDirection(t),this.setLength(n,s,o)}setDirection(t){if(t.y>.99999)this.quaternion.set(0,0,0,1);else if(t.y<-.99999)this.quaternion.set(1,0,0,0);else{pg.set(t.z,0,-t.x).normalize();let e=Math.acos(t.y);this.quaternion.setFromAxisAngle(pg,e)}}setLength(t,e=t*.2,n=e*.2){this.line.scale.set(1,Math.max(1e-4,t-e),1),this.line.updateMatrix(),this.cone.scale.set(n,e,n),this.cone.position.y=t,this.cone.updateMatrix()}setColor(t){this.line.material.color.set(t),this.cone.material.color.set(t)}copy(t){return super.copy(t,!1),this.line.copy(t.line),this.cone.copy(t.cone),this}dispose(){this.line.geometry.dispose(),this.line.material.dispose(),this.cone.geometry.dispose(),this.cone.material.dispose()}},Id=class extends kn{constructor(t=1){let e=[0,0,0,t,0,0,0,0,0,0,t,0,0,0,0,0,0,t],n=[1,0,0,1,.6,0,0,1,0,.6,1,0,0,0,1,0,.6,1],i=new Ft;i.setAttribute("position",new bt(e,3)),i.setAttribute("color",new bt(n,3));let s=new Qe({vertexColors:!0,toneMapped:!1});super(i,s),this.type="AxesHelper"}setColors(t,e,n){let i=new ft,s=this.geometry.attributes.color.array;return i.set(t),i.toArray(s,0),i.toArray(s,3),i.set(e),i.toArray(s,6),i.toArray(s,9),i.set(n),i.toArray(s,12),i.toArray(s,15),this.geometry.attributes.color.needsUpdate=!0,this}dispose(){this.geometry.dispose(),this.material.dispose()}},Pd=class{constructor(){this.type="ShapePath",this.color=new ft,this.subPaths=[],this.currentPath=null}moveTo(t,e){return this.currentPath=new Cs,this.subPaths.push(this.currentPath),this.currentPath.moveTo(t,e),this}lineTo(t,e){return this.currentPath.lineTo(t,e),this}quadraticCurveTo(t,e,n,i){return this.currentPath.quadraticCurveTo(t,e,n,i),this}bezierCurveTo(t,e,n,i,s,o){return this.currentPath.bezierCurveTo(t,e,n,i,s,o),this}splineThru(t){return this.currentPath.splineThru(t),this}toShapes(t){function e(m){let v=[];for(let _=0,y=m.length;_<y;_++){let b=m[_],T=new _i;T.curves=b.curves,v.push(T)}return v}function n(m,v){let _=v.length,y=!1;for(let b=_-1,T=0;T<_;b=T++){let w=v[b],E=v[T],M=E.x-w.x,S=E.y-w.y;if(Math.abs(S)>Number.EPSILON){if(S<0&&(w=v[T],M=-M,E=v[b],S=-S),m.y<w.y||m.y>E.y)continue;if(m.y===w.y){if(m.x===w.x)return!0}else{let I=S*(m.x-w.x)-M*(m.y-w.y);if(I===0)return!0;if(I<0)continue;y=!y}}else{if(m.y!==w.y)continue;if(E.x<=m.x&&m.x<=w.x||w.x<=m.x&&m.x<=E.x)return!0}}return y}let i=qn.isClockWise,s=this.subPaths;if(s.length===0)return[];let o,a,c,l=[];if(s.length===1)return a=s[0],c=new _i,c.curves=a.curves,l.push(c),l;let f=!i(s[0].getPoints());f=t?!f:f;let h=[],u=[],d=[],g=0,x;u[g]=void 0,d[g]=[];for(let m=0,v=s.length;m<v;m++)a=s[m],x=a.getPoints(),o=i(x),o=t?!o:o,o?(!f&&u[g]&&g++,u[g]={s:new _i,p:x},u[g].s.curves=a.curves,f&&g++,d[g]=[]):d[g].push({h:a,p:x[0]});if(!u[0])return e(s);if(u.length>1){let m=!1,v=0;for(let _=0,y=u.length;_<y;_++)h[_]=[];for(let _=0,y=u.length;_<y;_++){let b=d[_];for(let T=0;T<b.length;T++){let w=b[T],E=!0;for(let M=0;M<u.length;M++)n(w.p,u[M].p)&&(_!==M&&v++,E?(E=!1,h[M].push(w)):m=!0);E&&h[_].push(w)}}v>0&&m===!1&&(d=h)}let p;for(let m=0,v=u.length;m<v;m++){c=u[m].s,l.push(c),p=d[m];for(let _=0,y=p.length;_<y;_++)c.holes.push(p[_].h)}return l}},Dd=class extends On{constructor(t,e=null){super(),this.object=t,this.domElement=e,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(t){if(t===void 0){console.warn("THREE.Controls: connect() now requires an element.");return}this.domElement!==null&&this.disconnect(),this.domElement=t}disconnect(){}dispose(){}update(){}};function _b(r,t){let e=r.image&&r.image.width?r.image.width/r.image.height:1;return e>t?(r.repeat.x=1,r.repeat.y=e/t,r.offset.x=0,r.offset.y=(1-r.repeat.y)/2):(r.repeat.x=t/e,r.repeat.y=1,r.offset.x=(1-r.repeat.x)/2,r.offset.y=0),r}function yb(r,t){let e=r.image&&r.image.width?r.image.width/r.image.height:1;return e>t?(r.repeat.x=t/e,r.repeat.y=1,r.offset.x=(1-r.repeat.x)/2,r.offset.y=0):(r.repeat.x=1,r.repeat.y=e/t,r.offset.x=0,r.offset.y=(1-r.repeat.y)/2),r}function bb(r){return r.repeat.x=1,r.repeat.y=1,r.offset.x=0,r.offset.y=0,r}function Tu(r,t,e,n){let i=Sb(n);switch(e){case Hd:return r*t;case Jn:return r*t/i.components*i.byteLength;case Dr:return r*t/i.components*i.byteLength;case Fr:return r*t*2/i.components*i.byteLength;case Wi:return r*t*2/i.components*i.byteLength;case Gd:return r*t*3/i.components*i.byteLength;case Gt:return r*t*4/i.components*i.byteLength;case Xi:return r*t*4/i.components*i.byteLength;case pa:case ma:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*8;case ga:case xa:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*16;case Jl:case Ql:return Math.max(r,16)*Math.max(t,8)/4;case Zl:case Kl:return Math.max(r,8)*Math.max(t,8)/2;case jl:case tu:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*8;case eu:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*16;case nu:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*16;case iu:return Math.floor((r+4)/5)*Math.floor((t+3)/4)*16;case ru:return Math.floor((r+4)/5)*Math.floor((t+4)/5)*16;case su:return Math.floor((r+5)/6)*Math.floor((t+4)/5)*16;case ou:return Math.floor((r+5)/6)*Math.floor((t+5)/6)*16;case au:return Math.floor((r+7)/8)*Math.floor((t+4)/5)*16;case cu:return Math.floor((r+7)/8)*Math.floor((t+5)/6)*16;case lu:return Math.floor((r+7)/8)*Math.floor((t+7)/8)*16;case uu:return Math.floor((r+9)/10)*Math.floor((t+4)/5)*16;case hu:return Math.floor((r+9)/10)*Math.floor((t+5)/6)*16;case fu:return Math.floor((r+9)/10)*Math.floor((t+7)/8)*16;case du:return Math.floor((r+9)/10)*Math.floor((t+9)/10)*16;case pu:return Math.floor((r+11)/12)*Math.floor((t+9)/10)*16;case mu:return Math.floor((r+11)/12)*Math.floor((t+11)/12)*16;case gu:case xu:case vu:return Math.ceil(r/4)*Math.ceil(t/4)*16;case _u:case yu:return Math.ceil(r/4)*Math.ceil(t/4)*8;case bu:case Su:return Math.ceil(r/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function Sb(r){switch(r){case on:case Bs:return{byteLength:1,components:1};case Hi:case da:case Ge:return{byteLength:2,components:1};case Yl:case $l:return{byteLength:2,components:4};case an:case Gi:case $t:return{byteLength:4,components:1};case kd:case Vd:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${r}.`)}var Fd=class{static contain(t,e){return _b(t,e)}static cover(t,e){return yb(t,e)}static fill(t){return bb(t)}static getByteLength(t,e,n,i){return Tu(t,e,n,i)}};typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"180"}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="180");function H0(){let r=null,t=!1,e=null,n=null;function i(s,o){e(s,o),n=r.requestAnimationFrame(i)}return{start:function(){t!==!0&&e!==null&&(n=r.requestAnimationFrame(i),t=!0)},stop:function(){r.cancelAnimationFrame(n),t=!1},setAnimationLoop:function(s){e=s},setContext:function(s){r=s}}}function Mb(r){let t=new WeakMap;function e(a,c){let l=a.array,f=a.usage,h=l.byteLength,u=r.createBuffer();r.bindBuffer(c,u),r.bufferData(c,l,f),a.onUploadCallback();let d;if(l instanceof Float32Array)d=r.FLOAT;else if(typeof Float16Array<"u"&&l instanceof Float16Array)d=r.HALF_FLOAT;else if(l instanceof Uint16Array)a.isFloat16BufferAttribute?d=r.HALF_FLOAT:d=r.UNSIGNED_SHORT;else if(l instanceof Int16Array)d=r.SHORT;else if(l instanceof Uint32Array)d=r.UNSIGNED_INT;else if(l instanceof Int32Array)d=r.INT;else if(l instanceof Int8Array)d=r.BYTE;else if(l instanceof Uint8Array)d=r.UNSIGNED_BYTE;else if(l instanceof Uint8ClampedArray)d=r.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+l);return{buffer:u,type:d,bytesPerElement:l.BYTES_PER_ELEMENT,version:a.version,size:h}}function n(a,c,l){let f=c.array,h=c.updateRanges;if(r.bindBuffer(l,a),h.length===0)r.bufferSubData(l,0,f);else{h.sort((d,g)=>d.start-g.start);let u=0;for(let d=1;d<h.length;d++){let g=h[u],x=h[d];x.start<=g.start+g.count+1?g.count=Math.max(g.count,x.start+x.count-g.start):(++u,h[u]=x)}h.length=u+1;for(let d=0,g=h.length;d<g;d++){let x=h[d];r.bufferSubData(l,x.start*f.BYTES_PER_ELEMENT,f,x.start,x.count)}c.clearUpdateRanges()}c.onUploadCallback()}function i(a){return a.isInterleavedBufferAttribute&&(a=a.data),t.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let c=t.get(a);c&&(r.deleteBuffer(c.buffer),t.delete(a))}function o(a,c){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let f=t.get(a);(!f||f.version<a.version)&&t.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let l=t.get(a);if(l===void 0)t.set(a,e(a,c));else if(l.version<a.version){if(l.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(l.buffer,a,c),l.version=a.version}}return{get:i,remove:s,update:o}}var Tb=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,wb=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Ab=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Eb=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Rb=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Cb=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Ib=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Pb=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Db=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Fb=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Lb=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Nb=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Ub=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Bb=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,Ob=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,zb=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,kb=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Vb=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Hb=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Gb=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,Wb=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,Xb=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,qb=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,Yb=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,$b=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Zb=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,Jb=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Kb=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Qb=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,jb=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,tS="gl_FragColor = linearToOutputTexel( gl_FragColor );",eS=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,nS=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,iS=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,rS=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,sS=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,oS=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,aS=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,cS=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,lS=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,uS=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,hS=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,fS=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,dS=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,pS=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,mS=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,gS=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,xS=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,vS=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,_S=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,yS=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,bS=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,SS=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,MS=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,TS=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,wS=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,AS=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,ES=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,RS=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,CS=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,IS=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,PS=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,DS=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,FS=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,LS=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,NS=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,US=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,BS=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,OS=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,zS=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,kS=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,VS=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,HS=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,GS=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,WS=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,XS=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,qS=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,YS=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,$S=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,ZS=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,JS=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,KS=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,QS=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,jS=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,tM=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,eM=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,nM=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,iM=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,rM=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,sM=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		float depth = unpackRGBAToDepth( texture2D( depths, uv ) );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			return step( depth, compare );
		#else
			return step( compare, depth );
		#endif
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow( sampler2D shadow, vec2 uv, float compare ) {
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			float hard_shadow = step( distribution.x, compare );
		#else
			float hard_shadow = step( compare, distribution.x );
		#endif
		if ( hard_shadow != 1.0 ) {
			float distance = compare - distribution.x;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,oM=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,aM=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,cM=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,lM=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,uM=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,hM=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,fM=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,dM=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,pM=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,mM=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,gM=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,xM=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,vM=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,_M=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,yM=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,bM=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,SM=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,MM=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,TM=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,wM=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,AM=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,EM=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,RM=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,CM=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,IM=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,PM=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,DM=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,FM=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,LM=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,NM=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,UM=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,BM=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,OM=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,zM=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,kM=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,VM=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,HM=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,GM=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,WM=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,XM=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,qM=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,YM=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,$M=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,ZM=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,JM=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,KM=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,QM=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,jM=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,tT=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,eT=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,nT=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,jt={alphahash_fragment:Tb,alphahash_pars_fragment:wb,alphamap_fragment:Ab,alphamap_pars_fragment:Eb,alphatest_fragment:Rb,alphatest_pars_fragment:Cb,aomap_fragment:Ib,aomap_pars_fragment:Pb,batching_pars_vertex:Db,batching_vertex:Fb,begin_vertex:Lb,beginnormal_vertex:Nb,bsdfs:Ub,iridescence_fragment:Bb,bumpmap_pars_fragment:Ob,clipping_planes_fragment:zb,clipping_planes_pars_fragment:kb,clipping_planes_pars_vertex:Vb,clipping_planes_vertex:Hb,color_fragment:Gb,color_pars_fragment:Wb,color_pars_vertex:Xb,color_vertex:qb,common:Yb,cube_uv_reflection_fragment:$b,defaultnormal_vertex:Zb,displacementmap_pars_vertex:Jb,displacementmap_vertex:Kb,emissivemap_fragment:Qb,emissivemap_pars_fragment:jb,colorspace_fragment:tS,colorspace_pars_fragment:eS,envmap_fragment:nS,envmap_common_pars_fragment:iS,envmap_pars_fragment:rS,envmap_pars_vertex:sS,envmap_physical_pars_fragment:gS,envmap_vertex:oS,fog_vertex:aS,fog_pars_vertex:cS,fog_fragment:lS,fog_pars_fragment:uS,gradientmap_pars_fragment:hS,lightmap_pars_fragment:fS,lights_lambert_fragment:dS,lights_lambert_pars_fragment:pS,lights_pars_begin:mS,lights_toon_fragment:xS,lights_toon_pars_fragment:vS,lights_phong_fragment:_S,lights_phong_pars_fragment:yS,lights_physical_fragment:bS,lights_physical_pars_fragment:SS,lights_fragment_begin:MS,lights_fragment_maps:TS,lights_fragment_end:wS,logdepthbuf_fragment:AS,logdepthbuf_pars_fragment:ES,logdepthbuf_pars_vertex:RS,logdepthbuf_vertex:CS,map_fragment:IS,map_pars_fragment:PS,map_particle_fragment:DS,map_particle_pars_fragment:FS,metalnessmap_fragment:LS,metalnessmap_pars_fragment:NS,morphinstance_vertex:US,morphcolor_vertex:BS,morphnormal_vertex:OS,morphtarget_pars_vertex:zS,morphtarget_vertex:kS,normal_fragment_begin:VS,normal_fragment_maps:HS,normal_pars_fragment:GS,normal_pars_vertex:WS,normal_vertex:XS,normalmap_pars_fragment:qS,clearcoat_normal_fragment_begin:YS,clearcoat_normal_fragment_maps:$S,clearcoat_pars_fragment:ZS,iridescence_pars_fragment:JS,opaque_fragment:KS,packing:QS,premultiplied_alpha_fragment:jS,project_vertex:tM,dithering_fragment:eM,dithering_pars_fragment:nM,roughnessmap_fragment:iM,roughnessmap_pars_fragment:rM,shadowmap_pars_fragment:sM,shadowmap_pars_vertex:oM,shadowmap_vertex:aM,shadowmask_pars_fragment:cM,skinbase_vertex:lM,skinning_pars_vertex:uM,skinning_vertex:hM,skinnormal_vertex:fM,specularmap_fragment:dM,specularmap_pars_fragment:pM,tonemapping_fragment:mM,tonemapping_pars_fragment:gM,transmission_fragment:xM,transmission_pars_fragment:vM,uv_pars_fragment:_M,uv_pars_vertex:yM,uv_vertex:bM,worldpos_vertex:SM,background_vert:MM,background_frag:TM,backgroundCube_vert:wM,backgroundCube_frag:AM,cube_vert:EM,cube_frag:RM,depth_vert:CM,depth_frag:IM,distanceRGBA_vert:PM,distanceRGBA_frag:DM,equirect_vert:FM,equirect_frag:LM,linedashed_vert:NM,linedashed_frag:UM,meshbasic_vert:BM,meshbasic_frag:OM,meshlambert_vert:zM,meshlambert_frag:kM,meshmatcap_vert:VM,meshmatcap_frag:HM,meshnormal_vert:GM,meshnormal_frag:WM,meshphong_vert:XM,meshphong_frag:qM,meshphysical_vert:YM,meshphysical_frag:$M,meshtoon_vert:ZM,meshtoon_frag:JM,points_vert:KM,points_frag:QM,shadow_vert:jM,shadow_frag:tT,sprite_vert:eT,sprite_frag:nT},mt={common:{diffuse:{value:new ft(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Xt},alphaMap:{value:null},alphaMapTransform:{value:new Xt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Xt}},envmap:{envMap:{value:null},envMapRotation:{value:new Xt},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Xt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Xt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Xt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Xt},normalScale:{value:new q(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Xt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Xt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Xt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Xt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new ft(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new ft(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Xt},alphaTest:{value:0},uvTransform:{value:new Xt}},sprite:{diffuse:{value:new ft(16777215)},opacity:{value:1},center:{value:new q(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Xt},alphaMap:{value:null},alphaMapTransform:{value:new Xt},alphaTest:{value:0}}},ci={basic:{uniforms:cn([mt.common,mt.specularmap,mt.envmap,mt.aomap,mt.lightmap,mt.fog]),vertexShader:jt.meshbasic_vert,fragmentShader:jt.meshbasic_frag},lambert:{uniforms:cn([mt.common,mt.specularmap,mt.envmap,mt.aomap,mt.lightmap,mt.emissivemap,mt.bumpmap,mt.normalmap,mt.displacementmap,mt.fog,mt.lights,{emissive:{value:new ft(0)}}]),vertexShader:jt.meshlambert_vert,fragmentShader:jt.meshlambert_frag},phong:{uniforms:cn([mt.common,mt.specularmap,mt.envmap,mt.aomap,mt.lightmap,mt.emissivemap,mt.bumpmap,mt.normalmap,mt.displacementmap,mt.fog,mt.lights,{emissive:{value:new ft(0)},specular:{value:new ft(1118481)},shininess:{value:30}}]),vertexShader:jt.meshphong_vert,fragmentShader:jt.meshphong_frag},standard:{uniforms:cn([mt.common,mt.envmap,mt.aomap,mt.lightmap,mt.emissivemap,mt.bumpmap,mt.normalmap,mt.displacementmap,mt.roughnessmap,mt.metalnessmap,mt.fog,mt.lights,{emissive:{value:new ft(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:jt.meshphysical_vert,fragmentShader:jt.meshphysical_frag},toon:{uniforms:cn([mt.common,mt.aomap,mt.lightmap,mt.emissivemap,mt.bumpmap,mt.normalmap,mt.displacementmap,mt.gradientmap,mt.fog,mt.lights,{emissive:{value:new ft(0)}}]),vertexShader:jt.meshtoon_vert,fragmentShader:jt.meshtoon_frag},matcap:{uniforms:cn([mt.common,mt.bumpmap,mt.normalmap,mt.displacementmap,mt.fog,{matcap:{value:null}}]),vertexShader:jt.meshmatcap_vert,fragmentShader:jt.meshmatcap_frag},points:{uniforms:cn([mt.points,mt.fog]),vertexShader:jt.points_vert,fragmentShader:jt.points_frag},dashed:{uniforms:cn([mt.common,mt.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:jt.linedashed_vert,fragmentShader:jt.linedashed_frag},depth:{uniforms:cn([mt.common,mt.displacementmap]),vertexShader:jt.depth_vert,fragmentShader:jt.depth_frag},normal:{uniforms:cn([mt.common,mt.bumpmap,mt.normalmap,mt.displacementmap,{opacity:{value:1}}]),vertexShader:jt.meshnormal_vert,fragmentShader:jt.meshnormal_frag},sprite:{uniforms:cn([mt.sprite,mt.fog]),vertexShader:jt.sprite_vert,fragmentShader:jt.sprite_frag},background:{uniforms:{uvTransform:{value:new Xt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:jt.background_vert,fragmentShader:jt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Xt}},vertexShader:jt.backgroundCube_vert,fragmentShader:jt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:jt.cube_vert,fragmentShader:jt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:jt.equirect_vert,fragmentShader:jt.equirect_frag},distanceRGBA:{uniforms:cn([mt.common,mt.displacementmap,{referencePosition:{value:new R},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:jt.distanceRGBA_vert,fragmentShader:jt.distanceRGBA_frag},shadow:{uniforms:cn([mt.lights,mt.fog,{color:{value:new ft(0)},opacity:{value:1}}]),vertexShader:jt.shadow_vert,fragmentShader:jt.shadow_frag}};ci.physical={uniforms:cn([ci.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Xt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Xt},clearcoatNormalScale:{value:new q(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Xt},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Xt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Xt},sheen:{value:0},sheenColor:{value:new ft(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Xt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Xt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Xt},transmissionSamplerSize:{value:new q},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Xt},attenuationDistance:{value:0},attenuationColor:{value:new ft(0)},specularColor:{value:new ft(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Xt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Xt},anisotropyVector:{value:new q},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Xt}}]),vertexShader:jt.meshphysical_vert,fragmentShader:jt.meshphysical_frag};var wu={r:0,b:0,g:0},Nr=new In,iT=new gt;function rT(r,t,e,n,i,s,o){let a=new ft(0),c=s===!0?0:1,l,f,h=null,u=0,d=null;function g(_){let y=_.isScene===!0?_.background:null;return y&&y.isTexture&&(y=(_.backgroundBlurriness>0?e:t).get(y)),y}function x(_){let y=!1,b=g(_);b===null?m(a,c):b&&b.isColor&&(m(b,1),y=!0);let T=r.xr.getEnvironmentBlendMode();T==="additive"?n.buffers.color.setClear(0,0,0,1,o):T==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(r.autoClear||y)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),r.clear(r.autoClearColor,r.autoClearDepth,r.autoClearStencil))}function p(_,y){let b=g(y);b&&(b.isCubeTexture||b.mapping===Ns)?(f===void 0&&(f=new Me(new Sr(1,1,1),new Ue({name:"BackgroundCubeMaterial",uniforms:Lr(ci.backgroundCube.uniforms),vertexShader:ci.backgroundCube.vertexShader,fragmentShader:ci.backgroundCube.fragmentShader,side:He,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),f.geometry.deleteAttribute("normal"),f.geometry.deleteAttribute("uv"),f.onBeforeRender=function(T,w,E){this.matrixWorld.copyPosition(E.matrixWorld)},Object.defineProperty(f.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(f)),Nr.copy(y.backgroundRotation),Nr.x*=-1,Nr.y*=-1,Nr.z*=-1,b.isCubeTexture&&b.isRenderTargetTexture===!1&&(Nr.y*=-1,Nr.z*=-1),f.material.uniforms.envMap.value=b,f.material.uniforms.flipEnvMap.value=b.isCubeTexture&&b.isRenderTargetTexture===!1?-1:1,f.material.uniforms.backgroundBlurriness.value=y.backgroundBlurriness,f.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,f.material.uniforms.backgroundRotation.value.setFromMatrix4(iT.makeRotationFromEuler(Nr)),f.material.toneMapped=ie.getTransfer(b.colorSpace)!==me,(h!==b||u!==b.version||d!==r.toneMapping)&&(f.material.needsUpdate=!0,h=b,u=b.version,d=r.toneMapping),f.layers.enableAll(),_.unshift(f,f.geometry,f.material,0,0,null)):b&&b.isTexture&&(l===void 0&&(l=new Me(new Ps(2,2),new Ue({name:"BackgroundMaterial",uniforms:Lr(ci.background.uniforms),vertexShader:ci.background.vertexShader,fragmentShader:ci.background.fragmentShader,side:yn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=b,l.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,l.material.toneMapped=ie.getTransfer(b.colorSpace)!==me,b.matrixAutoUpdate===!0&&b.updateMatrix(),l.material.uniforms.uvTransform.value.copy(b.matrix),(h!==b||u!==b.version||d!==r.toneMapping)&&(l.material.needsUpdate=!0,h=b,u=b.version,d=r.toneMapping),l.layers.enableAll(),_.unshift(l,l.geometry,l.material,0,0,null))}function m(_,y){_.getRGB(wu,Zd(r)),n.buffers.color.setClear(wu.r,wu.g,wu.b,y,o)}function v(){f!==void 0&&(f.geometry.dispose(),f.material.dispose(),f=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(_,y=1){a.set(_),c=y,m(a,c)},getClearAlpha:function(){return c},setClearAlpha:function(_){c=_,m(a,c)},render:x,addToRenderList:p,dispose:v}}function sT(r,t){let e=r.getParameter(r.MAX_VERTEX_ATTRIBS),n={},i=u(null),s=i,o=!1;function a(S,I,P,L,N){let z=!1,V=h(L,P,I);s!==V&&(s=V,l(s.object)),z=d(S,L,P,N),z&&g(S,L,P,N),N!==null&&t.update(N,r.ELEMENT_ARRAY_BUFFER),(z||o)&&(o=!1,y(S,I,P,L),N!==null&&r.bindBuffer(r.ELEMENT_ARRAY_BUFFER,t.get(N).buffer))}function c(){return r.createVertexArray()}function l(S){return r.bindVertexArray(S)}function f(S){return r.deleteVertexArray(S)}function h(S,I,P){let L=P.wireframe===!0,N=n[S.id];N===void 0&&(N={},n[S.id]=N);let z=N[I.id];z===void 0&&(z={},N[I.id]=z);let V=z[L];return V===void 0&&(V=u(c()),z[L]=V),V}function u(S){let I=[],P=[],L=[];for(let N=0;N<e;N++)I[N]=0,P[N]=0,L[N]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:I,enabledAttributes:P,attributeDivisors:L,object:S,attributes:{},index:null}}function d(S,I,P,L){let N=s.attributes,z=I.attributes,V=0,j=P.getAttributes();for(let W in j)if(j[W].location>=0){let pt=N[W],_t=z[W];if(_t===void 0&&(W==="instanceMatrix"&&S.instanceMatrix&&(_t=S.instanceMatrix),W==="instanceColor"&&S.instanceColor&&(_t=S.instanceColor)),pt===void 0||pt.attribute!==_t||_t&&pt.data!==_t.data)return!0;V++}return s.attributesNum!==V||s.index!==L}function g(S,I,P,L){let N={},z=I.attributes,V=0,j=P.getAttributes();for(let W in j)if(j[W].location>=0){let pt=z[W];pt===void 0&&(W==="instanceMatrix"&&S.instanceMatrix&&(pt=S.instanceMatrix),W==="instanceColor"&&S.instanceColor&&(pt=S.instanceColor));let _t={};_t.attribute=pt,pt&&pt.data&&(_t.data=pt.data),N[W]=_t,V++}s.attributes=N,s.attributesNum=V,s.index=L}function x(){let S=s.newAttributes;for(let I=0,P=S.length;I<P;I++)S[I]=0}function p(S){m(S,0)}function m(S,I){let P=s.newAttributes,L=s.enabledAttributes,N=s.attributeDivisors;P[S]=1,L[S]===0&&(r.enableVertexAttribArray(S),L[S]=1),N[S]!==I&&(r.vertexAttribDivisor(S,I),N[S]=I)}function v(){let S=s.newAttributes,I=s.enabledAttributes;for(let P=0,L=I.length;P<L;P++)I[P]!==S[P]&&(r.disableVertexAttribArray(P),I[P]=0)}function _(S,I,P,L,N,z,V){V===!0?r.vertexAttribIPointer(S,I,P,N,z):r.vertexAttribPointer(S,I,P,L,N,z)}function y(S,I,P,L){x();let N=L.attributes,z=P.getAttributes(),V=I.defaultAttributeValues;for(let j in z){let W=z[j];if(W.location>=0){let ct=N[j];if(ct===void 0&&(j==="instanceMatrix"&&S.instanceMatrix&&(ct=S.instanceMatrix),j==="instanceColor"&&S.instanceColor&&(ct=S.instanceColor)),ct!==void 0){let pt=ct.normalized,_t=ct.itemSize,Ht=t.get(ct);if(Ht===void 0)continue;let ee=Ht.buffer,he=Ht.type,Qt=Ht.bytesPerElement,$=he===r.INT||he===r.UNSIGNED_INT||ct.gpuType===Gi;if(ct.isInterleavedBufferAttribute){let tt=ct.data,St=tt.stride,Pt=ct.offset;if(tt.isInstancedInterleavedBuffer){for(let wt=0;wt<W.locationSize;wt++)m(W.location+wt,tt.meshPerAttribute);S.isInstancedMesh!==!0&&L._maxInstanceCount===void 0&&(L._maxInstanceCount=tt.meshPerAttribute*tt.count)}else for(let wt=0;wt<W.locationSize;wt++)p(W.location+wt);r.bindBuffer(r.ARRAY_BUFFER,ee);for(let wt=0;wt<W.locationSize;wt++)_(W.location+wt,_t/W.locationSize,he,pt,St*Qt,(Pt+_t/W.locationSize*wt)*Qt,$)}else{if(ct.isInstancedBufferAttribute){for(let tt=0;tt<W.locationSize;tt++)m(W.location+tt,ct.meshPerAttribute);S.isInstancedMesh!==!0&&L._maxInstanceCount===void 0&&(L._maxInstanceCount=ct.meshPerAttribute*ct.count)}else for(let tt=0;tt<W.locationSize;tt++)p(W.location+tt);r.bindBuffer(r.ARRAY_BUFFER,ee);for(let tt=0;tt<W.locationSize;tt++)_(W.location+tt,_t/W.locationSize,he,pt,_t*Qt,_t/W.locationSize*tt*Qt,$)}}else if(V!==void 0){let pt=V[j];if(pt!==void 0)switch(pt.length){case 2:r.vertexAttrib2fv(W.location,pt);break;case 3:r.vertexAttrib3fv(W.location,pt);break;case 4:r.vertexAttrib4fv(W.location,pt);break;default:r.vertexAttrib1fv(W.location,pt)}}}}v()}function b(){E();for(let S in n){let I=n[S];for(let P in I){let L=I[P];for(let N in L)f(L[N].object),delete L[N];delete I[P]}delete n[S]}}function T(S){if(n[S.id]===void 0)return;let I=n[S.id];for(let P in I){let L=I[P];for(let N in L)f(L[N].object),delete L[N];delete I[P]}delete n[S.id]}function w(S){for(let I in n){let P=n[I];if(P[S.id]===void 0)continue;let L=P[S.id];for(let N in L)f(L[N].object),delete L[N];delete P[S.id]}}function E(){M(),o=!0,s!==i&&(s=i,l(s.object))}function M(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:a,reset:E,resetDefaultState:M,dispose:b,releaseStatesOfGeometry:T,releaseStatesOfProgram:w,initAttributes:x,enableAttribute:p,disableUnusedAttributes:v}}function oT(r,t,e){let n;function i(l){n=l}function s(l,f){r.drawArrays(n,l,f),e.update(f,n,1)}function o(l,f,h){h!==0&&(r.drawArraysInstanced(n,l,f,h),e.update(f,n,h))}function a(l,f,h){if(h===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,f,0,h);let d=0;for(let g=0;g<h;g++)d+=f[g];e.update(d,n,1)}function c(l,f,h,u){if(h===0)return;let d=t.get("WEBGL_multi_draw");if(d===null)for(let g=0;g<l.length;g++)o(l[g],f[g],u[g]);else{d.multiDrawArraysInstancedWEBGL(n,l,0,f,0,u,0,h);let g=0;for(let x=0;x<h;x++)g+=f[x]*u[x];e.update(g,n,1)}}this.setMode=i,this.render=s,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=c}function aT(r,t,e,n){let i;function s(){if(i!==void 0)return i;if(t.has("EXT_texture_filter_anisotropic")===!0){let w=t.get("EXT_texture_filter_anisotropic");i=r.getParameter(w.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function o(w){return!(w!==Gt&&n.convert(w)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(w){let E=w===Ge&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(w!==on&&n.convert(w)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_TYPE)&&w!==$t&&!E)}function c(w){if(w==="highp"){if(r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.HIGH_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.HIGH_FLOAT).precision>0)return"highp";w="mediump"}return w==="mediump"&&r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.MEDIUM_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let l=e.precision!==void 0?e.precision:"highp",f=c(l);f!==l&&(console.warn("THREE.WebGLRenderer:",l,"not supported, using",f,"instead."),l=f);let h=e.logarithmicDepthBuffer===!0,u=e.reversedDepthBuffer===!0&&t.has("EXT_clip_control"),d=r.getParameter(r.MAX_TEXTURE_IMAGE_UNITS),g=r.getParameter(r.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=r.getParameter(r.MAX_TEXTURE_SIZE),p=r.getParameter(r.MAX_CUBE_MAP_TEXTURE_SIZE),m=r.getParameter(r.MAX_VERTEX_ATTRIBS),v=r.getParameter(r.MAX_VERTEX_UNIFORM_VECTORS),_=r.getParameter(r.MAX_VARYING_VECTORS),y=r.getParameter(r.MAX_FRAGMENT_UNIFORM_VECTORS),b=g>0,T=r.getParameter(r.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:a,precision:l,logarithmicDepthBuffer:h,reversedDepthBuffer:u,maxTextures:d,maxVertexTextures:g,maxTextureSize:x,maxCubemapSize:p,maxAttributes:m,maxVertexUniforms:v,maxVaryings:_,maxFragmentUniforms:y,vertexTextures:b,maxSamples:T}}function cT(r){let t=this,e=null,n=0,i=!1,s=!1,o=new _n,a=new Xt,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(h,u){let d=h.length!==0||u||n!==0||i;return i=u,n=h.length,d},this.beginShadows=function(){s=!0,f(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(h,u){e=f(h,u,0)},this.setState=function(h,u,d){let g=h.clippingPlanes,x=h.clipIntersection,p=h.clipShadows,m=r.get(h);if(!i||g===null||g.length===0||s&&!p)s?f(null):l();else{let v=s?0:n,_=v*4,y=m.clippingState||null;c.value=y,y=f(g,u,_,d);for(let b=0;b!==_;++b)y[b]=e[b];m.clippingState=y,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=v}};function l(){c.value!==e&&(c.value=e,c.needsUpdate=n>0),t.numPlanes=n,t.numIntersection=0}function f(h,u,d,g){let x=h!==null?h.length:0,p=null;if(x!==0){if(p=c.value,g!==!0||p===null){let m=d+x*4,v=u.matrixWorldInverse;a.getNormalMatrix(v),(p===null||p.length<m)&&(p=new Float32Array(m));for(let _=0,y=d;_!==x;++_,y+=4)o.copy(h[_]).applyMatrix4(v,a),o.normal.toArray(p,y),p[y+3]=o.constant}c.value=p,c.needsUpdate=!0}return t.numPlanes=x,t.numIntersection=0,p}}function lT(r){let t=new WeakMap;function e(o,a){return a===Mi?o.mapping=Si:a===ha&&(o.mapping=Vi),o}function n(o){if(o&&o.isTexture){let a=o.mapping;if(a===Mi||a===ha)if(t.has(o)){let c=t.get(o).texture;return e(c,o.mapping)}else{let c=o.image;if(c&&c.height>0){let l=new Fc(c.height);return l.fromEquirectangularTexture(r,o),t.set(o,l),o.addEventListener("dispose",i),e(l.texture,o.mapping)}else return null}}return o}function i(o){let a=o.target;a.removeEventListener("dispose",i);let c=t.get(a);c!==void 0&&(t.delete(a),c.dispose())}function s(){t=new WeakMap}return{get:n,dispose:s}}var Vs=4,v0=[.125,.215,.35,.446,.526,.582],Or=20,tp=new ki,_0=new ft,ep=null,np=0,ip=0,rp=!1,Br=(1+Math.sqrt(5))/2,ks=1/Br,y0=[new R(-Br,ks,0),new R(Br,ks,0),new R(-ks,0,Br),new R(ks,0,Br),new R(0,Br,-ks),new R(0,Br,ks),new R(-1,1,-1),new R(1,1,-1),new R(-1,1,1),new R(1,1,1)],uT=new R,Ru=class{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(t,e=0,n=.1,i=100,s={}){let{size:o=256,position:a=uT}=s;ep=this._renderer.getRenderTarget(),np=this._renderer.getActiveCubeFace(),ip=this._renderer.getActiveMipmapLevel(),rp=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let c=this._allocateTargets();return c.depthBuffer=!0,this._sceneToCubeUV(t,n,i,c,a),e>0&&this._blur(c,0,0,e),this._applyPMREM(c),this._cleanup(c),c}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=M0(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=S0(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodPlanes.length;t++)this._lodPlanes[t].dispose()}_cleanup(t){this._renderer.setRenderTarget(ep,np,ip),this._renderer.xr.enabled=rp,t.scissorTest=!1,Au(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===Si||t.mapping===Vi?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),ep=this._renderer.getRenderTarget(),np=this._renderer.getActiveCubeFace(),ip=this._renderer.getActiveMipmapLevel(),rp=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=e||this._allocateTargets();return this._textureToCubeUV(t,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,n={magFilter:re,minFilter:re,generateMipmaps:!1,type:Ge,format:Gt,colorSpace:yr,depthBuffer:!1},i=b0(t,e,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=b0(t,e,n);let{_lodMax:s}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=hT(s)),this._blurMaterial=fT(s,t,e)}return i}_compileMaterial(t){let e=new Me(this._lodPlanes[0],t);this._renderer.compile(e,tp)}_sceneToCubeUV(t,e,n,i,s){let c=new Re(90,1,e,n),l=[1,-1,1,1,1,1],f=[1,1,1,-1,-1,-1],h=this._renderer,u=h.autoClear,d=h.toneMapping;h.getClearColor(_0),h.toneMapping=Zn,h.autoClear=!1,h.state.buffers.depth.getReversed()&&(h.setRenderTarget(i),h.clearDepth(),h.setRenderTarget(null));let x=new zn({name:"PMREM.Background",side:He,depthWrite:!1,depthTest:!1}),p=new Me(new Sr,x),m=!1,v=t.background;v?v.isColor&&(x.color.copy(v),t.background=null,m=!0):(x.color.copy(_0),m=!0);for(let _=0;_<6;_++){let y=_%3;y===0?(c.up.set(0,l[_],0),c.position.set(s.x,s.y,s.z),c.lookAt(s.x+f[_],s.y,s.z)):y===1?(c.up.set(0,0,l[_]),c.position.set(s.x,s.y,s.z),c.lookAt(s.x,s.y+f[_],s.z)):(c.up.set(0,l[_],0),c.position.set(s.x,s.y,s.z),c.lookAt(s.x,s.y,s.z+f[_]));let b=this._cubeSize;Au(i,y*b,_>2?b:0,b,b),h.setRenderTarget(i),m&&h.render(p,c),h.render(t,c)}p.geometry.dispose(),p.material.dispose(),h.toneMapping=d,h.autoClear=u,t.background=v}_textureToCubeUV(t,e){let n=this._renderer,i=t.mapping===Si||t.mapping===Vi;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=M0()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=S0());let s=i?this._cubemapMaterial:this._equirectMaterial,o=new Me(this._lodPlanes[0],s),a=s.uniforms;a.envMap.value=t;let c=this._cubeSize;Au(e,0,0,3*c,2*c),n.setRenderTarget(e),n.render(o,tp)}_applyPMREM(t){let e=this._renderer,n=e.autoClear;e.autoClear=!1;let i=this._lodPlanes.length;for(let s=1;s<i;s++){let o=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),a=y0[(i-s-1)%y0.length];this._blur(t,s-1,s,o,a)}e.autoClear=n}_blur(t,e,n,i,s){let o=this._pingPongRenderTarget;this._halfBlur(t,o,e,n,i,"latitudinal",s),this._halfBlur(o,t,n,n,i,"longitudinal",s)}_halfBlur(t,e,n,i,s,o,a){let c=this._renderer,l=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");let f=3,h=new Me(this._lodPlanes[i],l),u=l.uniforms,d=this._sizeLods[n]-1,g=isFinite(s)?Math.PI/(2*d):2*Math.PI/(2*Or-1),x=s/g,p=isFinite(s)?1+Math.floor(f*x):Or;p>Or&&console.warn(`sigmaRadians, ${s}, is too large and will clip, as it requested ${p} samples when the maximum is set to ${Or}`);let m=[],v=0;for(let w=0;w<Or;++w){let E=w/x,M=Math.exp(-E*E/2);m.push(M),w===0?v+=M:w<p&&(v+=2*M)}for(let w=0;w<m.length;w++)m[w]=m[w]/v;u.envMap.value=t.texture,u.samples.value=p,u.weights.value=m,u.latitudinal.value=o==="latitudinal",a&&(u.poleAxis.value=a);let{_lodMax:_}=this;u.dTheta.value=g,u.mipInt.value=_-n;let y=this._sizeLods[i],b=3*y*(i>_-Vs?i-_+Vs:0),T=4*(this._cubeSize-y);Au(e,b,T,3*y,2*y),c.setRenderTarget(e),c.render(h,tp)}};function hT(r){let t=[],e=[],n=[],i=r,s=r-Vs+1+v0.length;for(let o=0;o<s;o++){let a=Math.pow(2,i);e.push(a);let c=1/a;o>r-Vs?c=v0[o-r+Vs-1]:o===0&&(c=0),n.push(c);let l=1/(a-2),f=-l,h=1+l,u=[f,f,h,f,h,h,f,f,h,h,f,h],d=6,g=6,x=3,p=2,m=1,v=new Float32Array(x*g*d),_=new Float32Array(p*g*d),y=new Float32Array(m*g*d);for(let T=0;T<d;T++){let w=T%3*2/3-1,E=T>2?0:-1,M=[w,E,0,w+2/3,E,0,w+2/3,E+1,0,w,E,0,w+2/3,E+1,0,w,E+1,0];v.set(M,x*g*T),_.set(u,p*g*T);let S=[T,T,T,T,T,T];y.set(S,m*g*T)}let b=new Ft;b.setAttribute("position",new Ot(v,x)),b.setAttribute("uv",new Ot(_,p)),b.setAttribute("faceIndex",new Ot(y,m)),t.push(b),i>Vs&&i--}return{lodPlanes:t,sizeLods:e,sigmas:n}}function b0(r,t,e){let n=new ze(r,t,e);return n.texture.mapping=Ns,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Au(r,t,e,n,i){r.viewport.set(t,e,n,i),r.scissor.set(t,e,n,i)}function fT(r,t,e){let n=new Float32Array(Or),i=new R(0,1,0);return new Ue({name:"SphericalGaussianBlur",defines:{n:Or,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${r}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:pp(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:ke,depthTest:!1,depthWrite:!1})}function S0(){return new Ue({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:pp(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:ke,depthTest:!1,depthWrite:!1})}function M0(){return new Ue({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:pp(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:ke,depthTest:!1,depthWrite:!1})}function pp(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function dT(r){let t=new WeakMap,e=null;function n(a){if(a&&a.isTexture){let c=a.mapping,l=c===Mi||c===ha,f=c===Si||c===Vi;if(l||f){let h=t.get(a),u=h!==void 0?h.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==u)return e===null&&(e=new Ru(r)),h=l?e.fromEquirectangular(a,h):e.fromCubemap(a,h),h.texture.pmremVersion=a.pmremVersion,t.set(a,h),h.texture;if(h!==void 0)return h.texture;{let d=a.image;return l&&d&&d.height>0||f&&d&&i(d)?(e===null&&(e=new Ru(r)),h=l?e.fromEquirectangular(a):e.fromCubemap(a),h.texture.pmremVersion=a.pmremVersion,t.set(a,h),a.addEventListener("dispose",s),h.texture):null}}}return a}function i(a){let c=0,l=6;for(let f=0;f<l;f++)a[f]!==void 0&&c++;return c===l}function s(a){let c=a.target;c.removeEventListener("dispose",s);let l=t.get(c);l!==void 0&&(t.delete(c),l.dispose())}function o(){t=new WeakMap,e!==null&&(e.dispose(),e=null)}return{get:n,dispose:o}}function pT(r){let t={};function e(n){if(t[n]!==void 0)return t[n];let i;switch(n){case"WEBGL_depth_texture":i=r.getExtension("WEBGL_depth_texture")||r.getExtension("MOZ_WEBGL_depth_texture")||r.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":i=r.getExtension("EXT_texture_filter_anisotropic")||r.getExtension("MOZ_EXT_texture_filter_anisotropic")||r.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":i=r.getExtension("WEBGL_compressed_texture_s3tc")||r.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||r.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":i=r.getExtension("WEBGL_compressed_texture_pvrtc")||r.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:i=r.getExtension(n)}return t[n]=i,i}return{has:function(n){return e(n)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(n){let i=e(n);return i===null&&ys("THREE.WebGLRenderer: "+n+" extension not supported."),i}}}function mT(r,t,e,n){let i={},s=new WeakMap;function o(h){let u=h.target;u.index!==null&&t.remove(u.index);for(let g in u.attributes)t.remove(u.attributes[g]);u.removeEventListener("dispose",o),delete i[u.id];let d=s.get(u);d&&(t.remove(d),s.delete(u)),n.releaseStatesOfGeometry(u),u.isInstancedBufferGeometry===!0&&delete u._maxInstanceCount,e.memory.geometries--}function a(h,u){return i[u.id]===!0||(u.addEventListener("dispose",o),i[u.id]=!0,e.memory.geometries++),u}function c(h){let u=h.attributes;for(let d in u)t.update(u[d],r.ARRAY_BUFFER)}function l(h){let u=[],d=h.index,g=h.attributes.position,x=0;if(d!==null){let v=d.array;x=d.version;for(let _=0,y=v.length;_<y;_+=3){let b=v[_+0],T=v[_+1],w=v[_+2];u.push(b,T,T,w,w,b)}}else if(g!==void 0){let v=g.array;x=g.version;for(let _=0,y=v.length/3-1;_<y;_+=3){let b=_+0,T=_+1,w=_+2;u.push(b,T,T,w,w,b)}}else return;let p=new($d(u)?Lo:Fo)(u,1);p.version=x;let m=s.get(h);m&&t.remove(m),s.set(h,p)}function f(h){let u=s.get(h);if(u){let d=h.index;d!==null&&u.version<d.version&&l(h)}else l(h);return s.get(h)}return{get:a,update:c,getWireframeAttribute:f}}function gT(r,t,e){let n;function i(u){n=u}let s,o;function a(u){s=u.type,o=u.bytesPerElement}function c(u,d){r.drawElements(n,d,s,u*o),e.update(d,n,1)}function l(u,d,g){g!==0&&(r.drawElementsInstanced(n,d,s,u*o,g),e.update(d,n,g))}function f(u,d,g){if(g===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,d,0,s,u,0,g);let p=0;for(let m=0;m<g;m++)p+=d[m];e.update(p,n,1)}function h(u,d,g,x){if(g===0)return;let p=t.get("WEBGL_multi_draw");if(p===null)for(let m=0;m<u.length;m++)l(u[m]/o,d[m],x[m]);else{p.multiDrawElementsInstancedWEBGL(n,d,0,s,u,0,x,0,g);let m=0;for(let v=0;v<g;v++)m+=d[v]*x[v];e.update(m,n,1)}}this.setMode=i,this.setIndex=a,this.render=c,this.renderInstances=l,this.renderMultiDraw=f,this.renderMultiDrawInstances=h}function xT(r){let t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function n(s,o,a){switch(e.calls++,o){case r.TRIANGLES:e.triangles+=a*(s/3);break;case r.LINES:e.lines+=a*(s/2);break;case r.LINE_STRIP:e.lines+=a*(s-1);break;case r.LINE_LOOP:e.lines+=a*s;break;case r.POINTS:e.points+=a*s;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function i(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:i,update:n}}function vT(r,t,e){let n=new WeakMap,i=new Kt;function s(o,a,c){let l=o.morphTargetInfluences,f=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,h=f!==void 0?f.length:0,u=n.get(a);if(u===void 0||u.count!==h){let M=function(){w.dispose(),n.delete(a),a.removeEventListener("dispose",M)};u!==void 0&&u.texture.dispose();let d=a.morphAttributes.position!==void 0,g=a.morphAttributes.normal!==void 0,x=a.morphAttributes.color!==void 0,p=a.morphAttributes.position||[],m=a.morphAttributes.normal||[],v=a.morphAttributes.color||[],_=0;d===!0&&(_=1),g===!0&&(_=2),x===!0&&(_=3);let y=a.attributes.position.count*_,b=1;y>t.maxTextureSize&&(b=Math.ceil(y/t.maxTextureSize),y=t.maxTextureSize);let T=new Float32Array(y*b*4*h),w=new Ui(T,y,b,h);w.type=$t,w.needsUpdate=!0;let E=_*4;for(let S=0;S<h;S++){let I=p[S],P=m[S],L=v[S],N=y*b*4*S;for(let z=0;z<I.count;z++){let V=z*E;d===!0&&(i.fromBufferAttribute(I,z),T[N+V+0]=i.x,T[N+V+1]=i.y,T[N+V+2]=i.z,T[N+V+3]=0),g===!0&&(i.fromBufferAttribute(P,z),T[N+V+4]=i.x,T[N+V+5]=i.y,T[N+V+6]=i.z,T[N+V+7]=0),x===!0&&(i.fromBufferAttribute(L,z),T[N+V+8]=i.x,T[N+V+9]=i.y,T[N+V+10]=i.z,T[N+V+11]=L.itemSize===4?i.w:1)}}u={count:h,texture:w,size:new q(y,b)},n.set(a,u),a.addEventListener("dispose",M)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)c.getUniforms().setValue(r,"morphTexture",o.morphTexture,e);else{let d=0;for(let x=0;x<l.length;x++)d+=l[x];let g=a.morphTargetsRelative?1:1-d;c.getUniforms().setValue(r,"morphTargetBaseInfluence",g),c.getUniforms().setValue(r,"morphTargetInfluences",l)}c.getUniforms().setValue(r,"morphTargetsTexture",u.texture,e),c.getUniforms().setValue(r,"morphTargetsTextureSize",u.size)}return{update:s}}function _T(r,t,e,n){let i=new WeakMap;function s(c){let l=n.render.frame,f=c.geometry,h=t.get(c,f);if(i.get(h)!==l&&(t.update(h),i.set(h,l)),c.isInstancedMesh&&(c.hasEventListener("dispose",a)===!1&&c.addEventListener("dispose",a),i.get(c)!==l&&(e.update(c.instanceMatrix,r.ARRAY_BUFFER),c.instanceColor!==null&&e.update(c.instanceColor,r.ARRAY_BUFFER),i.set(c,l))),c.isSkinnedMesh){let u=c.skeleton;i.get(u)!==l&&(u.update(),i.set(u,l))}return h}function o(){i=new WeakMap}function a(c){let l=c.target;l.removeEventListener("dispose",a),e.remove(l.instanceMatrix),l.instanceColor!==null&&e.remove(l.instanceColor)}return{update:s,dispose:o}}var G0=new Oe,T0=new Oo(1,1),W0=new Ui,X0=new bs,q0=new Mr,w0=[],A0=[],E0=new Float32Array(16),R0=new Float32Array(9),C0=new Float32Array(4);function Gs(r,t,e){let n=r[0];if(n<=0||n>0)return r;let i=t*e,s=w0[i];if(s===void 0&&(s=new Float32Array(i),w0[i]=s),t!==0){n.toArray(s,0);for(let o=1,a=0;o!==t;++o)a+=e,r[o].toArray(s,a)}return s}function We(r,t){if(r.length!==t.length)return!1;for(let e=0,n=r.length;e<n;e++)if(r[e]!==t[e])return!1;return!0}function Xe(r,t){for(let e=0,n=t.length;e<n;e++)r[e]=t[e]}function Cu(r,t){let e=A0[t];e===void 0&&(e=new Int32Array(t),A0[t]=e);for(let n=0;n!==t;++n)e[n]=r.allocateTextureUnit();return e}function yT(r,t){let e=this.cache;e[0]!==t&&(r.uniform1f(this.addr,t),e[0]=t)}function bT(r,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(r.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(We(e,t))return;r.uniform2fv(this.addr,t),Xe(e,t)}}function ST(r,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(r.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(r.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(We(e,t))return;r.uniform3fv(this.addr,t),Xe(e,t)}}function MT(r,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(r.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(We(e,t))return;r.uniform4fv(this.addr,t),Xe(e,t)}}function TT(r,t){let e=this.cache,n=t.elements;if(n===void 0){if(We(e,t))return;r.uniformMatrix2fv(this.addr,!1,t),Xe(e,t)}else{if(We(e,n))return;C0.set(n),r.uniformMatrix2fv(this.addr,!1,C0),Xe(e,n)}}function wT(r,t){let e=this.cache,n=t.elements;if(n===void 0){if(We(e,t))return;r.uniformMatrix3fv(this.addr,!1,t),Xe(e,t)}else{if(We(e,n))return;R0.set(n),r.uniformMatrix3fv(this.addr,!1,R0),Xe(e,n)}}function AT(r,t){let e=this.cache,n=t.elements;if(n===void 0){if(We(e,t))return;r.uniformMatrix4fv(this.addr,!1,t),Xe(e,t)}else{if(We(e,n))return;E0.set(n),r.uniformMatrix4fv(this.addr,!1,E0),Xe(e,n)}}function ET(r,t){let e=this.cache;e[0]!==t&&(r.uniform1i(this.addr,t),e[0]=t)}function RT(r,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(r.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(We(e,t))return;r.uniform2iv(this.addr,t),Xe(e,t)}}function CT(r,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(r.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(We(e,t))return;r.uniform3iv(this.addr,t),Xe(e,t)}}function IT(r,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(r.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(We(e,t))return;r.uniform4iv(this.addr,t),Xe(e,t)}}function PT(r,t){let e=this.cache;e[0]!==t&&(r.uniform1ui(this.addr,t),e[0]=t)}function DT(r,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(r.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(We(e,t))return;r.uniform2uiv(this.addr,t),Xe(e,t)}}function FT(r,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(r.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(We(e,t))return;r.uniform3uiv(this.addr,t),Xe(e,t)}}function LT(r,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(r.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(We(e,t))return;r.uniform4uiv(this.addr,t),Xe(e,t)}}function NT(r,t,e){let n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i);let s;this.type===r.SAMPLER_2D_SHADOW?(T0.compareFunction=Xd,s=T0):s=G0,e.setTexture2D(t||s,i)}function UT(r,t,e){let n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),e.setTexture3D(t||X0,i)}function BT(r,t,e){let n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),e.setTextureCube(t||q0,i)}function OT(r,t,e){let n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),e.setTexture2DArray(t||W0,i)}function zT(r){switch(r){case 5126:return yT;case 35664:return bT;case 35665:return ST;case 35666:return MT;case 35674:return TT;case 35675:return wT;case 35676:return AT;case 5124:case 35670:return ET;case 35667:case 35671:return RT;case 35668:case 35672:return CT;case 35669:case 35673:return IT;case 5125:return PT;case 36294:return DT;case 36295:return FT;case 36296:return LT;case 35678:case 36198:case 36298:case 36306:case 35682:return NT;case 35679:case 36299:case 36307:return UT;case 35680:case 36300:case 36308:case 36293:return BT;case 36289:case 36303:case 36311:case 36292:return OT}}function kT(r,t){r.uniform1fv(this.addr,t)}function VT(r,t){let e=Gs(t,this.size,2);r.uniform2fv(this.addr,e)}function HT(r,t){let e=Gs(t,this.size,3);r.uniform3fv(this.addr,e)}function GT(r,t){let e=Gs(t,this.size,4);r.uniform4fv(this.addr,e)}function WT(r,t){let e=Gs(t,this.size,4);r.uniformMatrix2fv(this.addr,!1,e)}function XT(r,t){let e=Gs(t,this.size,9);r.uniformMatrix3fv(this.addr,!1,e)}function qT(r,t){let e=Gs(t,this.size,16);r.uniformMatrix4fv(this.addr,!1,e)}function YT(r,t){r.uniform1iv(this.addr,t)}function $T(r,t){r.uniform2iv(this.addr,t)}function ZT(r,t){r.uniform3iv(this.addr,t)}function JT(r,t){r.uniform4iv(this.addr,t)}function KT(r,t){r.uniform1uiv(this.addr,t)}function QT(r,t){r.uniform2uiv(this.addr,t)}function jT(r,t){r.uniform3uiv(this.addr,t)}function tw(r,t){r.uniform4uiv(this.addr,t)}function ew(r,t,e){let n=this.cache,i=t.length,s=Cu(e,i);We(n,s)||(r.uniform1iv(this.addr,s),Xe(n,s));for(let o=0;o!==i;++o)e.setTexture2D(t[o]||G0,s[o])}function nw(r,t,e){let n=this.cache,i=t.length,s=Cu(e,i);We(n,s)||(r.uniform1iv(this.addr,s),Xe(n,s));for(let o=0;o!==i;++o)e.setTexture3D(t[o]||X0,s[o])}function iw(r,t,e){let n=this.cache,i=t.length,s=Cu(e,i);We(n,s)||(r.uniform1iv(this.addr,s),Xe(n,s));for(let o=0;o!==i;++o)e.setTextureCube(t[o]||q0,s[o])}function rw(r,t,e){let n=this.cache,i=t.length,s=Cu(e,i);We(n,s)||(r.uniform1iv(this.addr,s),Xe(n,s));for(let o=0;o!==i;++o)e.setTexture2DArray(t[o]||W0,s[o])}function sw(r){switch(r){case 5126:return kT;case 35664:return VT;case 35665:return HT;case 35666:return GT;case 35674:return WT;case 35675:return XT;case 35676:return qT;case 5124:case 35670:return YT;case 35667:case 35671:return $T;case 35668:case 35672:return ZT;case 35669:case 35673:return JT;case 5125:return KT;case 36294:return QT;case 36295:return jT;case 36296:return tw;case 35678:case 36198:case 36298:case 36306:case 35682:return ew;case 35679:case 36299:case 36307:return nw;case 35680:case 36300:case 36308:case 36293:return iw;case 36289:case 36303:case 36311:case 36292:return rw}}var op=class{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.setValue=zT(e.type)}},ap=class{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=sw(e.type)}},cp=class{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,n){let i=this.seq;for(let s=0,o=i.length;s!==o;++s){let a=i[s];a.setValue(t,e[a.id],n)}}},sp=/(\w+)(\])?(\[|\.)?/g;function I0(r,t){r.seq.push(t),r.map[t.id]=t}function ow(r,t,e){let n=r.name,i=n.length;for(sp.lastIndex=0;;){let s=sp.exec(n),o=sp.lastIndex,a=s[1],c=s[2]==="]",l=s[3];if(c&&(a=a|0),l===void 0||l==="["&&o+2===i){I0(e,l===void 0?new op(a,r,t):new ap(a,r,t));break}else{let h=e.map[a];h===void 0&&(h=new cp(a),I0(e,h)),e=h}}}var Hs=class{constructor(t,e){this.seq=[],this.map={};let n=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let i=0;i<n;++i){let s=t.getActiveUniform(e,i),o=t.getUniformLocation(e,s.name);ow(s,o,this)}}setValue(t,e,n,i){let s=this.map[e];s!==void 0&&s.setValue(t,n,i)}setOptional(t,e,n){let i=e[n];i!==void 0&&this.setValue(t,n,i)}static upload(t,e,n,i){for(let s=0,o=e.length;s!==o;++s){let a=e[s],c=n[a.id];c.needsUpdate!==!1&&a.setValue(t,c.value,i)}}static seqWithValue(t,e){let n=[];for(let i=0,s=t.length;i!==s;++i){let o=t[i];o.id in e&&n.push(o)}return n}};function P0(r,t,e){let n=r.createShader(t);return r.shaderSource(n,e),r.compileShader(n),n}var aw=37297,cw=0;function lw(r,t){let e=r.split(`
`),n=[],i=Math.max(t-6,0),s=Math.min(t+6,e.length);for(let o=i;o<s;o++){let a=o+1;n.push(`${a===t?">":" "} ${a}: ${e[o]}`)}return n.join(`
`)}var D0=new Xt;function uw(r){ie._getMatrix(D0,ie.workingColorSpace,r);let t=`mat3( ${D0.elements.map(e=>e.toFixed(4))} )`;switch(ie.getTransfer(r)){case Co:return[t,"LinearTransferOETF"];case me:return[t,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",r),[t,"LinearTransferOETF"]}}function F0(r,t,e){let n=r.getShaderParameter(t,r.COMPILE_STATUS),s=(r.getShaderInfoLog(t)||"").trim();if(n&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return e.toUpperCase()+`

`+s+`

`+lw(r.getShaderSource(t),a)}else return s}function hw(r,t){let e=uw(t);return[`vec4 ${r}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}function fw(r,t){let e;switch(t){case Og:e="Linear";break;case zg:e="Reinhard";break;case kg:e="Cineon";break;case Vg:e="ACESFilmic";break;case Gg:e="AgX";break;case Wg:e="Neutral";break;case Hg:e="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",t),e="Linear"}return"vec3 "+r+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}var Eu=new R;function dw(){ie.getLuminanceCoefficients(Eu);let r=Eu.x.toFixed(4),t=Eu.y.toFixed(4),e=Eu.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${r}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function pw(r){return[r.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",r.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(va).join(`
`)}function mw(r){let t=[];for(let e in r){let n=r[e];n!==!1&&t.push("#define "+e+" "+n)}return t.join(`
`)}function gw(r,t){let e={},n=r.getProgramParameter(t,r.ACTIVE_ATTRIBUTES);for(let i=0;i<n;i++){let s=r.getActiveAttrib(t,i),o=s.name,a=1;s.type===r.FLOAT_MAT2&&(a=2),s.type===r.FLOAT_MAT3&&(a=3),s.type===r.FLOAT_MAT4&&(a=4),e[o]={type:s.type,location:r.getAttribLocation(t,o),locationSize:a}}return e}function va(r){return r!==""}function L0(r,t){let e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return r.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function N0(r,t){return r.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var xw=/^[ \t]*#include +<([\w\d./]+)>/gm;function lp(r){return r.replace(xw,_w)}var vw=new Map;function _w(r,t){let e=jt[t];if(e===void 0){let n=vw.get(t);if(n!==void 0)e=jt[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,n);else throw new Error("Can not resolve #include <"+t+">")}return lp(e)}var yw=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function U0(r){return r.replace(yw,bw)}function bw(r,t,e,n){let i="";for(let s=parseInt(t);s<parseInt(e);s++)i+=n.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return i}function B0(r){let t=`precision ${r.precision} float;
	precision ${r.precision} int;
	precision ${r.precision} sampler2D;
	precision ${r.precision} samplerCube;
	precision ${r.precision} sampler3D;
	precision ${r.precision} sampler2DArray;
	precision ${r.precision} sampler2DShadow;
	precision ${r.precision} samplerCubeShadow;
	precision ${r.precision} sampler2DArrayShadow;
	precision ${r.precision} isampler2D;
	precision ${r.precision} isampler3D;
	precision ${r.precision} isamplerCube;
	precision ${r.precision} isampler2DArray;
	precision ${r.precision} usampler2D;
	precision ${r.precision} usampler3D;
	precision ${r.precision} usamplerCube;
	precision ${r.precision} usampler2DArray;
	`;return r.precision==="highp"?t+=`
#define HIGH_PRECISION`:r.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:r.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}function Sw(r){let t="SHADOWMAP_TYPE_BASIC";return r.shadowMapType===Nd?t="SHADOWMAP_TYPE_PCF":r.shadowMapType===xg?t="SHADOWMAP_TYPE_PCF_SOFT":r.shadowMapType===oi&&(t="SHADOWMAP_TYPE_VSM"),t}function Mw(r){let t="ENVMAP_TYPE_CUBE";if(r.envMap)switch(r.envMapMode){case Si:case Vi:t="ENVMAP_TYPE_CUBE";break;case Ns:t="ENVMAP_TYPE_CUBE_UV";break}return t}function Tw(r){let t="ENVMAP_MODE_REFLECTION";if(r.envMap)switch(r.envMapMode){case Vi:t="ENVMAP_MODE_REFRACTION";break}return t}function ww(r){let t="ENVMAP_BLENDING_NONE";if(r.envMap)switch(r.combine){case ua:t="ENVMAP_BLENDING_MULTIPLY";break;case Ug:t="ENVMAP_BLENDING_MIX";break;case Bg:t="ENVMAP_BLENDING_ADD";break}return t}function Aw(r){let t=r.envMapCubeUVHeight;if(t===null)return null;let e=Math.log2(t)-2,n=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),112)),texelHeight:n,maxMip:e}}function Ew(r,t,e,n){let i=r.getContext(),s=e.defines,o=e.vertexShader,a=e.fragmentShader,c=Sw(e),l=Mw(e),f=Tw(e),h=ww(e),u=Aw(e),d=pw(e),g=mw(s),x=i.createProgram(),p,m,v=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(p=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(va).join(`
`),p.length>0&&(p+=`
`),m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(va).join(`
`),m.length>0&&(m+=`
`)):(p=[B0(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+f:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+c:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(va).join(`
`),m=[B0(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+l:"",e.envMap?"#define "+f:"",e.envMap?"#define "+h:"",u?"#define CUBEUV_TEXEL_WIDTH "+u.texelWidth:"",u?"#define CUBEUV_TEXEL_HEIGHT "+u.texelHeight:"",u?"#define CUBEUV_MAX_MIP "+u.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor||e.batchingColor?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+c:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==Zn?"#define TONE_MAPPING":"",e.toneMapping!==Zn?jt.tonemapping_pars_fragment:"",e.toneMapping!==Zn?fw("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",jt.colorspace_pars_fragment,hw("linearToOutputTexel",e.outputColorSpace),dw(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(va).join(`
`)),o=lp(o),o=L0(o,e),o=N0(o,e),a=lp(a),a=L0(a,e),a=N0(a,e),o=U0(o),a=U0(a),e.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,p=[d,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+p,m=["#define varying in",e.glslVersion===qd?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===qd?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+m);let _=v+p+o,y=v+m+a,b=P0(i,i.VERTEX_SHADER,_),T=P0(i,i.FRAGMENT_SHADER,y);i.attachShader(x,b),i.attachShader(x,T),e.index0AttributeName!==void 0?i.bindAttribLocation(x,0,e.index0AttributeName):e.morphTargets===!0&&i.bindAttribLocation(x,0,"position"),i.linkProgram(x);function w(I){if(r.debug.checkShaderErrors){let P=i.getProgramInfoLog(x)||"",L=i.getShaderInfoLog(b)||"",N=i.getShaderInfoLog(T)||"",z=P.trim(),V=L.trim(),j=N.trim(),W=!0,ct=!0;if(i.getProgramParameter(x,i.LINK_STATUS)===!1)if(W=!1,typeof r.debug.onShaderError=="function")r.debug.onShaderError(i,x,b,T);else{let pt=F0(i,b,"vertex"),_t=F0(i,T,"fragment");console.error("THREE.WebGLProgram: Shader Error "+i.getError()+" - VALIDATE_STATUS "+i.getProgramParameter(x,i.VALIDATE_STATUS)+`

Material Name: `+I.name+`
Material Type: `+I.type+`

Program Info Log: `+z+`
`+pt+`
`+_t)}else z!==""?console.warn("THREE.WebGLProgram: Program Info Log:",z):(V===""||j==="")&&(ct=!1);ct&&(I.diagnostics={runnable:W,programLog:z,vertexShader:{log:V,prefix:p},fragmentShader:{log:j,prefix:m}})}i.deleteShader(b),i.deleteShader(T),E=new Hs(i,x),M=gw(i,x)}let E;this.getUniforms=function(){return E===void 0&&w(this),E};let M;this.getAttributes=function(){return M===void 0&&w(this),M};let S=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return S===!1&&(S=i.getProgramParameter(x,aw)),S},this.destroy=function(){n.releaseStatesOfProgram(this),i.deleteProgram(x),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=cw++,this.cacheKey=t,this.usedTimes=1,this.program=x,this.vertexShader=b,this.fragmentShader=T,this}var Rw=0,up=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t){let e=t.vertexShader,n=t.fragmentShader,i=this._getShaderStage(e),s=this._getShaderStage(n),o=this._getShaderCacheForMaterial(t);return o.has(i)===!1&&(o.add(i),i.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(t){let e=this.materialCache.get(t);for(let n of e)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(t),this}getVertexShaderID(t){return this._getShaderStage(t.vertexShader).id}getFragmentShaderID(t){return this._getShaderStage(t.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){let e=this.materialCache,n=e.get(t);return n===void 0&&(n=new Set,e.set(t,n)),n}_getShaderStage(t){let e=this.shaderCache,n=e.get(t);return n===void 0&&(n=new hp(t),e.set(t,n)),n}},hp=class{constructor(t){this.id=Rw++,this.code=t,this.usedTimes=0}};function Cw(r,t,e,n,i,s,o){let a=new Ss,c=new up,l=new Set,f=[],h=i.logarithmicDepthBuffer,u=i.vertexTextures,d=i.precision,g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function x(M){return l.add(M),M===0?"uv":`uv${M}`}function p(M,S,I,P,L){let N=P.fog,z=L.geometry,V=M.isMeshStandardMaterial?P.environment:null,j=(M.isMeshStandardMaterial?e:t).get(M.envMap||V),W=j&&j.mapping===Ns?j.image.height:null,ct=g[M.type];M.precision!==null&&(d=i.getMaxPrecision(M.precision),d!==M.precision&&console.warn("THREE.WebGLProgram.getParameters:",M.precision,"not supported, using",d,"instead."));let pt=z.morphAttributes.position||z.morphAttributes.normal||z.morphAttributes.color,_t=pt!==void 0?pt.length:0,Ht=0;z.morphAttributes.position!==void 0&&(Ht=1),z.morphAttributes.normal!==void 0&&(Ht=2),z.morphAttributes.color!==void 0&&(Ht=3);let ee,he,Qt,$;if(ct){let de=ci[ct];ee=de.vertexShader,he=de.fragmentShader}else ee=M.vertexShader,he=M.fragmentShader,c.update(M),Qt=c.getVertexShaderID(M),$=c.getFragmentShaderID(M);let tt=r.getRenderTarget(),St=r.state.buffers.depth.getReversed(),Pt=L.isInstancedMesh===!0,wt=L.isBatchedMesh===!0,te=!!M.map,fe=!!M.matcap,F=!!j,nt=!!M.aoMap,K=!!M.lightMap,J=!!M.bumpMap,Z=!!M.normalMap,ut=!!M.displacementMap,it=!!M.emissiveMap,ht=!!M.metalnessMap,qt=!!M.roughnessMap,Wt=M.anisotropy>0,D=M.clearcoat>0,A=M.dispersion>0,k=M.iridescence>0,X=M.sheen>0,et=M.transmission>0,Y=Wt&&!!M.anisotropyMap,It=D&&!!M.clearcoatMap,lt=D&&!!M.clearcoatNormalMap,Et=D&&!!M.clearcoatRoughnessMap,Rt=k&&!!M.iridescenceMap,rt=k&&!!M.iridescenceThicknessMap,yt=X&&!!M.sheenColorMap,zt=X&&!!M.sheenRoughnessMap,Dt=!!M.specularMap,xt=!!M.specularColorMap,Jt=!!M.specularIntensityMap,U=et&&!!M.transmissionMap,at=et&&!!M.thicknessMap,dt=!!M.gradientMap,Tt=!!M.alphaMap,st=M.alphaTest>0,Q=!!M.alphaHash,Ct=!!M.extensions,Yt=Zn;M.toneMapped&&(tt===null||tt.isXRRenderTarget===!0)&&(Yt=r.toneMapping);let Se={shaderID:ct,shaderType:M.type,shaderName:M.name,vertexShader:ee,fragmentShader:he,defines:M.defines,customVertexShaderID:Qt,customFragmentShaderID:$,isRawShaderMaterial:M.isRawShaderMaterial===!0,glslVersion:M.glslVersion,precision:d,batching:wt,batchingColor:wt&&L._colorsTexture!==null,instancing:Pt,instancingColor:Pt&&L.instanceColor!==null,instancingMorph:Pt&&L.morphTexture!==null,supportsVertexTextures:u,outputColorSpace:tt===null?r.outputColorSpace:tt.isXRRenderTarget===!0?tt.texture.colorSpace:yr,alphaToCoverage:!!M.alphaToCoverage,map:te,matcap:fe,envMap:F,envMapMode:F&&j.mapping,envMapCubeUVHeight:W,aoMap:nt,lightMap:K,bumpMap:J,normalMap:Z,displacementMap:u&&ut,emissiveMap:it,normalMapObjectSpace:Z&&M.normalMapType===Kg,normalMapTangentSpace:Z&&M.normalMapType===qi,metalnessMap:ht,roughnessMap:qt,anisotropy:Wt,anisotropyMap:Y,clearcoat:D,clearcoatMap:It,clearcoatNormalMap:lt,clearcoatRoughnessMap:Et,dispersion:A,iridescence:k,iridescenceMap:Rt,iridescenceThicknessMap:rt,sheen:X,sheenColorMap:yt,sheenRoughnessMap:zt,specularMap:Dt,specularColorMap:xt,specularIntensityMap:Jt,transmission:et,transmissionMap:U,thicknessMap:at,gradientMap:dt,opaque:M.transparent===!1&&M.blending===Yn&&M.alphaToCoverage===!1,alphaMap:Tt,alphaTest:st,alphaHash:Q,combine:M.combine,mapUv:te&&x(M.map.channel),aoMapUv:nt&&x(M.aoMap.channel),lightMapUv:K&&x(M.lightMap.channel),bumpMapUv:J&&x(M.bumpMap.channel),normalMapUv:Z&&x(M.normalMap.channel),displacementMapUv:ut&&x(M.displacementMap.channel),emissiveMapUv:it&&x(M.emissiveMap.channel),metalnessMapUv:ht&&x(M.metalnessMap.channel),roughnessMapUv:qt&&x(M.roughnessMap.channel),anisotropyMapUv:Y&&x(M.anisotropyMap.channel),clearcoatMapUv:It&&x(M.clearcoatMap.channel),clearcoatNormalMapUv:lt&&x(M.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Et&&x(M.clearcoatRoughnessMap.channel),iridescenceMapUv:Rt&&x(M.iridescenceMap.channel),iridescenceThicknessMapUv:rt&&x(M.iridescenceThicknessMap.channel),sheenColorMapUv:yt&&x(M.sheenColorMap.channel),sheenRoughnessMapUv:zt&&x(M.sheenRoughnessMap.channel),specularMapUv:Dt&&x(M.specularMap.channel),specularColorMapUv:xt&&x(M.specularColorMap.channel),specularIntensityMapUv:Jt&&x(M.specularIntensityMap.channel),transmissionMapUv:U&&x(M.transmissionMap.channel),thicknessMapUv:at&&x(M.thicknessMap.channel),alphaMapUv:Tt&&x(M.alphaMap.channel),vertexTangents:!!z.attributes.tangent&&(Z||Wt),vertexColors:M.vertexColors,vertexAlphas:M.vertexColors===!0&&!!z.attributes.color&&z.attributes.color.itemSize===4,pointsUvs:L.isPoints===!0&&!!z.attributes.uv&&(te||Tt),fog:!!N,useFog:M.fog===!0,fogExp2:!!N&&N.isFogExp2,flatShading:M.flatShading===!0&&M.wireframe===!1,sizeAttenuation:M.sizeAttenuation===!0,logarithmicDepthBuffer:h,reversedDepthBuffer:St,skinning:L.isSkinnedMesh===!0,morphTargets:z.morphAttributes.position!==void 0,morphNormals:z.morphAttributes.normal!==void 0,morphColors:z.morphAttributes.color!==void 0,morphTargetsCount:_t,morphTextureStride:Ht,numDirLights:S.directional.length,numPointLights:S.point.length,numSpotLights:S.spot.length,numSpotLightMaps:S.spotLightMap.length,numRectAreaLights:S.rectArea.length,numHemiLights:S.hemi.length,numDirLightShadows:S.directionalShadowMap.length,numPointLightShadows:S.pointShadowMap.length,numSpotLightShadows:S.spotShadowMap.length,numSpotLightShadowsWithMaps:S.numSpotLightShadowsWithMaps,numLightProbes:S.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:M.dithering,shadowMapEnabled:r.shadowMap.enabled&&I.length>0,shadowMapType:r.shadowMap.type,toneMapping:Yt,decodeVideoTexture:te&&M.map.isVideoTexture===!0&&ie.getTransfer(M.map.colorSpace)===me,decodeVideoTextureEmissive:it&&M.emissiveMap.isVideoTexture===!0&&ie.getTransfer(M.emissiveMap.colorSpace)===me,premultipliedAlpha:M.premultipliedAlpha,doubleSided:M.side===Sn,flipSided:M.side===He,useDepthPacking:M.depthPacking>=0,depthPacking:M.depthPacking||0,index0AttributeName:M.index0AttributeName,extensionClipCullDistance:Ct&&M.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Ct&&M.extensions.multiDraw===!0||wt)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:M.customProgramCacheKey()};return Se.vertexUv1s=l.has(1),Se.vertexUv2s=l.has(2),Se.vertexUv3s=l.has(3),l.clear(),Se}function m(M){let S=[];if(M.shaderID?S.push(M.shaderID):(S.push(M.customVertexShaderID),S.push(M.customFragmentShaderID)),M.defines!==void 0)for(let I in M.defines)S.push(I),S.push(M.defines[I]);return M.isRawShaderMaterial===!1&&(v(S,M),_(S,M),S.push(r.outputColorSpace)),S.push(M.customProgramCacheKey),S.join()}function v(M,S){M.push(S.precision),M.push(S.outputColorSpace),M.push(S.envMapMode),M.push(S.envMapCubeUVHeight),M.push(S.mapUv),M.push(S.alphaMapUv),M.push(S.lightMapUv),M.push(S.aoMapUv),M.push(S.bumpMapUv),M.push(S.normalMapUv),M.push(S.displacementMapUv),M.push(S.emissiveMapUv),M.push(S.metalnessMapUv),M.push(S.roughnessMapUv),M.push(S.anisotropyMapUv),M.push(S.clearcoatMapUv),M.push(S.clearcoatNormalMapUv),M.push(S.clearcoatRoughnessMapUv),M.push(S.iridescenceMapUv),M.push(S.iridescenceThicknessMapUv),M.push(S.sheenColorMapUv),M.push(S.sheenRoughnessMapUv),M.push(S.specularMapUv),M.push(S.specularColorMapUv),M.push(S.specularIntensityMapUv),M.push(S.transmissionMapUv),M.push(S.thicknessMapUv),M.push(S.combine),M.push(S.fogExp2),M.push(S.sizeAttenuation),M.push(S.morphTargetsCount),M.push(S.morphAttributeCount),M.push(S.numDirLights),M.push(S.numPointLights),M.push(S.numSpotLights),M.push(S.numSpotLightMaps),M.push(S.numHemiLights),M.push(S.numRectAreaLights),M.push(S.numDirLightShadows),M.push(S.numPointLightShadows),M.push(S.numSpotLightShadows),M.push(S.numSpotLightShadowsWithMaps),M.push(S.numLightProbes),M.push(S.shadowMapType),M.push(S.toneMapping),M.push(S.numClippingPlanes),M.push(S.numClipIntersection),M.push(S.depthPacking)}function _(M,S){a.disableAll(),S.supportsVertexTextures&&a.enable(0),S.instancing&&a.enable(1),S.instancingColor&&a.enable(2),S.instancingMorph&&a.enable(3),S.matcap&&a.enable(4),S.envMap&&a.enable(5),S.normalMapObjectSpace&&a.enable(6),S.normalMapTangentSpace&&a.enable(7),S.clearcoat&&a.enable(8),S.iridescence&&a.enable(9),S.alphaTest&&a.enable(10),S.vertexColors&&a.enable(11),S.vertexAlphas&&a.enable(12),S.vertexUv1s&&a.enable(13),S.vertexUv2s&&a.enable(14),S.vertexUv3s&&a.enable(15),S.vertexTangents&&a.enable(16),S.anisotropy&&a.enable(17),S.alphaHash&&a.enable(18),S.batching&&a.enable(19),S.dispersion&&a.enable(20),S.batchingColor&&a.enable(21),S.gradientMap&&a.enable(22),M.push(a.mask),a.disableAll(),S.fog&&a.enable(0),S.useFog&&a.enable(1),S.flatShading&&a.enable(2),S.logarithmicDepthBuffer&&a.enable(3),S.reversedDepthBuffer&&a.enable(4),S.skinning&&a.enable(5),S.morphTargets&&a.enable(6),S.morphNormals&&a.enable(7),S.morphColors&&a.enable(8),S.premultipliedAlpha&&a.enable(9),S.shadowMapEnabled&&a.enable(10),S.doubleSided&&a.enable(11),S.flipSided&&a.enable(12),S.useDepthPacking&&a.enable(13),S.dithering&&a.enable(14),S.transmission&&a.enable(15),S.sheen&&a.enable(16),S.opaque&&a.enable(17),S.pointsUvs&&a.enable(18),S.decodeVideoTexture&&a.enable(19),S.decodeVideoTextureEmissive&&a.enable(20),S.alphaToCoverage&&a.enable(21),M.push(a.mask)}function y(M){let S=g[M.type],I;if(S){let P=ci[S];I=c0.clone(P.uniforms)}else I=M.uniforms;return I}function b(M,S){let I;for(let P=0,L=f.length;P<L;P++){let N=f[P];if(N.cacheKey===S){I=N,++I.usedTimes;break}}return I===void 0&&(I=new Ew(r,S,M,s),f.push(I)),I}function T(M){if(--M.usedTimes===0){let S=f.indexOf(M);f[S]=f[f.length-1],f.pop(),M.destroy()}}function w(M){c.remove(M)}function E(){c.dispose()}return{getParameters:p,getProgramCacheKey:m,getUniforms:y,acquireProgram:b,releaseProgram:T,releaseShaderCache:w,programs:f,dispose:E}}function Iw(){let r=new WeakMap;function t(o){return r.has(o)}function e(o){let a=r.get(o);return a===void 0&&(a={},r.set(o,a)),a}function n(o){r.delete(o)}function i(o,a,c){r.get(o)[a]=c}function s(){r=new WeakMap}return{has:t,get:e,remove:n,update:i,dispose:s}}function Pw(r,t){return r.groupOrder!==t.groupOrder?r.groupOrder-t.groupOrder:r.renderOrder!==t.renderOrder?r.renderOrder-t.renderOrder:r.material.id!==t.material.id?r.material.id-t.material.id:r.z!==t.z?r.z-t.z:r.id-t.id}function O0(r,t){return r.groupOrder!==t.groupOrder?r.groupOrder-t.groupOrder:r.renderOrder!==t.renderOrder?r.renderOrder-t.renderOrder:r.z!==t.z?t.z-r.z:r.id-t.id}function z0(){let r=[],t=0,e=[],n=[],i=[];function s(){t=0,e.length=0,n.length=0,i.length=0}function o(h,u,d,g,x,p){let m=r[t];return m===void 0?(m={id:h.id,object:h,geometry:u,material:d,groupOrder:g,renderOrder:h.renderOrder,z:x,group:p},r[t]=m):(m.id=h.id,m.object=h,m.geometry=u,m.material=d,m.groupOrder=g,m.renderOrder=h.renderOrder,m.z=x,m.group=p),t++,m}function a(h,u,d,g,x,p){let m=o(h,u,d,g,x,p);d.transmission>0?n.push(m):d.transparent===!0?i.push(m):e.push(m)}function c(h,u,d,g,x,p){let m=o(h,u,d,g,x,p);d.transmission>0?n.unshift(m):d.transparent===!0?i.unshift(m):e.unshift(m)}function l(h,u){e.length>1&&e.sort(h||Pw),n.length>1&&n.sort(u||O0),i.length>1&&i.sort(u||O0)}function f(){for(let h=t,u=r.length;h<u;h++){let d=r[h];if(d.id===null)break;d.id=null,d.object=null,d.geometry=null,d.material=null,d.group=null}}return{opaque:e,transmissive:n,transparent:i,init:s,push:a,unshift:c,finish:f,sort:l}}function Dw(){let r=new WeakMap;function t(n,i){let s=r.get(n),o;return s===void 0?(o=new z0,r.set(n,[o])):i>=s.length?(o=new z0,s.push(o)):o=s[i],o}function e(){r=new WeakMap}return{get:t,dispose:e}}function Fw(){let r={};return{get:function(t){if(r[t.id]!==void 0)return r[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new R,color:new ft};break;case"SpotLight":e={position:new R,direction:new R,color:new ft,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new R,color:new ft,distance:0,decay:0};break;case"HemisphereLight":e={direction:new R,skyColor:new ft,groundColor:new ft};break;case"RectAreaLight":e={color:new ft,position:new R,halfWidth:new R,halfHeight:new R};break}return r[t.id]=e,e}}}function Lw(){let r={};return{get:function(t){if(r[t.id]!==void 0)return r[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new q};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new q};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new q,shadowCameraNear:1,shadowCameraFar:1e3};break}return r[t.id]=e,e}}}var Nw=0;function Uw(r,t){return(t.castShadow?2:0)-(r.castShadow?2:0)+(t.map?1:0)-(r.map?1:0)}function Bw(r){let t=new Fw,e=Lw(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let l=0;l<9;l++)n.probe.push(new R);let i=new R,s=new gt,o=new gt;function a(l){let f=0,h=0,u=0;for(let M=0;M<9;M++)n.probe[M].set(0,0,0);let d=0,g=0,x=0,p=0,m=0,v=0,_=0,y=0,b=0,T=0,w=0;l.sort(Uw);for(let M=0,S=l.length;M<S;M++){let I=l[M],P=I.color,L=I.intensity,N=I.distance,z=I.shadow&&I.shadow.map?I.shadow.map.texture:null;if(I.isAmbientLight)f+=P.r*L,h+=P.g*L,u+=P.b*L;else if(I.isLightProbe){for(let V=0;V<9;V++)n.probe[V].addScaledVector(I.sh.coefficients[V],L);w++}else if(I.isDirectionalLight){let V=t.get(I);if(V.color.copy(I.color).multiplyScalar(I.intensity),I.castShadow){let j=I.shadow,W=e.get(I);W.shadowIntensity=j.intensity,W.shadowBias=j.bias,W.shadowNormalBias=j.normalBias,W.shadowRadius=j.radius,W.shadowMapSize=j.mapSize,n.directionalShadow[d]=W,n.directionalShadowMap[d]=z,n.directionalShadowMatrix[d]=I.shadow.matrix,v++}n.directional[d]=V,d++}else if(I.isSpotLight){let V=t.get(I);V.position.setFromMatrixPosition(I.matrixWorld),V.color.copy(P).multiplyScalar(L),V.distance=N,V.coneCos=Math.cos(I.angle),V.penumbraCos=Math.cos(I.angle*(1-I.penumbra)),V.decay=I.decay,n.spot[x]=V;let j=I.shadow;if(I.map&&(n.spotLightMap[b]=I.map,b++,j.updateMatrices(I),I.castShadow&&T++),n.spotLightMatrix[x]=j.matrix,I.castShadow){let W=e.get(I);W.shadowIntensity=j.intensity,W.shadowBias=j.bias,W.shadowNormalBias=j.normalBias,W.shadowRadius=j.radius,W.shadowMapSize=j.mapSize,n.spotShadow[x]=W,n.spotShadowMap[x]=z,y++}x++}else if(I.isRectAreaLight){let V=t.get(I);V.color.copy(P).multiplyScalar(L),V.halfWidth.set(I.width*.5,0,0),V.halfHeight.set(0,I.height*.5,0),n.rectArea[p]=V,p++}else if(I.isPointLight){let V=t.get(I);if(V.color.copy(I.color).multiplyScalar(I.intensity),V.distance=I.distance,V.decay=I.decay,I.castShadow){let j=I.shadow,W=e.get(I);W.shadowIntensity=j.intensity,W.shadowBias=j.bias,W.shadowNormalBias=j.normalBias,W.shadowRadius=j.radius,W.shadowMapSize=j.mapSize,W.shadowCameraNear=j.camera.near,W.shadowCameraFar=j.camera.far,n.pointShadow[g]=W,n.pointShadowMap[g]=z,n.pointShadowMatrix[g]=I.shadow.matrix,_++}n.point[g]=V,g++}else if(I.isHemisphereLight){let V=t.get(I);V.skyColor.copy(I.color).multiplyScalar(L),V.groundColor.copy(I.groundColor).multiplyScalar(L),n.hemi[m]=V,m++}}p>0&&(r.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=mt.LTC_FLOAT_1,n.rectAreaLTC2=mt.LTC_FLOAT_2):(n.rectAreaLTC1=mt.LTC_HALF_1,n.rectAreaLTC2=mt.LTC_HALF_2)),n.ambient[0]=f,n.ambient[1]=h,n.ambient[2]=u;let E=n.hash;(E.directionalLength!==d||E.pointLength!==g||E.spotLength!==x||E.rectAreaLength!==p||E.hemiLength!==m||E.numDirectionalShadows!==v||E.numPointShadows!==_||E.numSpotShadows!==y||E.numSpotMaps!==b||E.numLightProbes!==w)&&(n.directional.length=d,n.spot.length=x,n.rectArea.length=p,n.point.length=g,n.hemi.length=m,n.directionalShadow.length=v,n.directionalShadowMap.length=v,n.pointShadow.length=_,n.pointShadowMap.length=_,n.spotShadow.length=y,n.spotShadowMap.length=y,n.directionalShadowMatrix.length=v,n.pointShadowMatrix.length=_,n.spotLightMatrix.length=y+b-T,n.spotLightMap.length=b,n.numSpotLightShadowsWithMaps=T,n.numLightProbes=w,E.directionalLength=d,E.pointLength=g,E.spotLength=x,E.rectAreaLength=p,E.hemiLength=m,E.numDirectionalShadows=v,E.numPointShadows=_,E.numSpotShadows=y,E.numSpotMaps=b,E.numLightProbes=w,n.version=Nw++)}function c(l,f){let h=0,u=0,d=0,g=0,x=0,p=f.matrixWorldInverse;for(let m=0,v=l.length;m<v;m++){let _=l[m];if(_.isDirectionalLight){let y=n.directional[h];y.direction.setFromMatrixPosition(_.matrixWorld),i.setFromMatrixPosition(_.target.matrixWorld),y.direction.sub(i),y.direction.transformDirection(p),h++}else if(_.isSpotLight){let y=n.spot[d];y.position.setFromMatrixPosition(_.matrixWorld),y.position.applyMatrix4(p),y.direction.setFromMatrixPosition(_.matrixWorld),i.setFromMatrixPosition(_.target.matrixWorld),y.direction.sub(i),y.direction.transformDirection(p),d++}else if(_.isRectAreaLight){let y=n.rectArea[g];y.position.setFromMatrixPosition(_.matrixWorld),y.position.applyMatrix4(p),o.identity(),s.copy(_.matrixWorld),s.premultiply(p),o.extractRotation(s),y.halfWidth.set(_.width*.5,0,0),y.halfHeight.set(0,_.height*.5,0),y.halfWidth.applyMatrix4(o),y.halfHeight.applyMatrix4(o),g++}else if(_.isPointLight){let y=n.point[u];y.position.setFromMatrixPosition(_.matrixWorld),y.position.applyMatrix4(p),u++}else if(_.isHemisphereLight){let y=n.hemi[x];y.direction.setFromMatrixPosition(_.matrixWorld),y.direction.transformDirection(p),x++}}}return{setup:a,setupView:c,state:n}}function k0(r){let t=new Bw(r),e=[],n=[];function i(f){l.camera=f,e.length=0,n.length=0}function s(f){e.push(f)}function o(f){n.push(f)}function a(){t.setup(e)}function c(f){t.setupView(e,f)}let l={lightsArray:e,shadowsArray:n,camera:null,lights:t,transmissionRenderTarget:{}};return{init:i,state:l,setupLights:a,setupLightsView:c,pushLight:s,pushShadow:o}}function Ow(r){let t=new WeakMap;function e(i,s=0){let o=t.get(i),a;return o===void 0?(a=new k0(r),t.set(i,[a])):s>=o.length?(a=new k0(r),o.push(a)):a=o[s],a}function n(){t=new WeakMap}return{get:e,dispose:n}}var zw=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,kw=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function Vw(r,t,e){let n=new Oi,i=new q,s=new q,o=new Kt,a=new jo({depthPacking:Jg}),c=new ta,l={},f=e.maxTextureSize,h={[yn]:He,[He]:yn,[Sn]:Sn},u=new Ue({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new q},radius:{value:4}},vertexShader:zw,fragmentShader:kw}),d=u.clone();d.defines.HORIZONTAL_PASS=1;let g=new Ft;g.setAttribute("position",new Ot(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let x=new Me(g,u),p=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Nd;let m=this.type;this.render=function(T,w,E){if(p.enabled===!1||p.autoUpdate===!1&&p.needsUpdate===!1||T.length===0)return;let M=r.getRenderTarget(),S=r.getActiveCubeFace(),I=r.getActiveMipmapLevel(),P=r.state;P.setBlending(ke),P.buffers.depth.getReversed()===!0?P.buffers.color.setClear(0,0,0,0):P.buffers.color.setClear(1,1,1,1),P.buffers.depth.setTest(!0),P.setScissorTest(!1);let L=m!==oi&&this.type===oi,N=m===oi&&this.type!==oi;for(let z=0,V=T.length;z<V;z++){let j=T[z],W=j.shadow;if(W===void 0){console.warn("THREE.WebGLShadowMap:",j,"has no shadow.");continue}if(W.autoUpdate===!1&&W.needsUpdate===!1)continue;i.copy(W.mapSize);let ct=W.getFrameExtents();if(i.multiply(ct),s.copy(W.mapSize),(i.x>f||i.y>f)&&(i.x>f&&(s.x=Math.floor(f/ct.x),i.x=s.x*ct.x,W.mapSize.x=s.x),i.y>f&&(s.y=Math.floor(f/ct.y),i.y=s.y*ct.y,W.mapSize.y=s.y)),W.map===null||L===!0||N===!0){let _t=this.type!==oi?{minFilter:Vt,magFilter:Vt}:{};W.map!==null&&W.map.dispose(),W.map=new ze(i.x,i.y,_t),W.map.texture.name=j.name+".shadowMap",W.camera.updateProjectionMatrix()}r.setRenderTarget(W.map),r.clear();let pt=W.getViewportCount();for(let _t=0;_t<pt;_t++){let Ht=W.getViewport(_t);o.set(s.x*Ht.x,s.y*Ht.y,s.x*Ht.z,s.y*Ht.w),P.viewport(o),W.updateMatrices(j,_t),n=W.getFrustum(),y(w,E,W.camera,j,this.type)}W.isPointLightShadow!==!0&&this.type===oi&&v(W,E),W.needsUpdate=!1}m=this.type,p.needsUpdate=!1,r.setRenderTarget(M,S,I)};function v(T,w){let E=t.update(x);u.defines.VSM_SAMPLES!==T.blurSamples&&(u.defines.VSM_SAMPLES=T.blurSamples,d.defines.VSM_SAMPLES=T.blurSamples,u.needsUpdate=!0,d.needsUpdate=!0),T.mapPass===null&&(T.mapPass=new ze(i.x,i.y)),u.uniforms.shadow_pass.value=T.map.texture,u.uniforms.resolution.value=T.mapSize,u.uniforms.radius.value=T.radius,r.setRenderTarget(T.mapPass),r.clear(),r.renderBufferDirect(w,null,E,u,x,null),d.uniforms.shadow_pass.value=T.mapPass.texture,d.uniforms.resolution.value=T.mapSize,d.uniforms.radius.value=T.radius,r.setRenderTarget(T.map),r.clear(),r.renderBufferDirect(w,null,E,d,x,null)}function _(T,w,E,M){let S=null,I=E.isPointLight===!0?T.customDistanceMaterial:T.customDepthMaterial;if(I!==void 0)S=I;else if(S=E.isPointLight===!0?c:a,r.localClippingEnabled&&w.clipShadows===!0&&Array.isArray(w.clippingPlanes)&&w.clippingPlanes.length!==0||w.displacementMap&&w.displacementScale!==0||w.alphaMap&&w.alphaTest>0||w.map&&w.alphaTest>0||w.alphaToCoverage===!0){let P=S.uuid,L=w.uuid,N=l[P];N===void 0&&(N={},l[P]=N);let z=N[L];z===void 0&&(z=S.clone(),N[L]=z,w.addEventListener("dispose",b)),S=z}if(S.visible=w.visible,S.wireframe=w.wireframe,M===oi?S.side=w.shadowSide!==null?w.shadowSide:w.side:S.side=w.shadowSide!==null?w.shadowSide:h[w.side],S.alphaMap=w.alphaMap,S.alphaTest=w.alphaToCoverage===!0?.5:w.alphaTest,S.map=w.map,S.clipShadows=w.clipShadows,S.clippingPlanes=w.clippingPlanes,S.clipIntersection=w.clipIntersection,S.displacementMap=w.displacementMap,S.displacementScale=w.displacementScale,S.displacementBias=w.displacementBias,S.wireframeLinewidth=w.wireframeLinewidth,S.linewidth=w.linewidth,E.isPointLight===!0&&S.isMeshDistanceMaterial===!0){let P=r.properties.get(S);P.light=E}return S}function y(T,w,E,M,S){if(T.visible===!1)return;if(T.layers.test(w.layers)&&(T.isMesh||T.isLine||T.isPoints)&&(T.castShadow||T.receiveShadow&&S===oi)&&(!T.frustumCulled||n.intersectsObject(T))){T.modelViewMatrix.multiplyMatrices(E.matrixWorldInverse,T.matrixWorld);let L=t.update(T),N=T.material;if(Array.isArray(N)){let z=L.groups;for(let V=0,j=z.length;V<j;V++){let W=z[V],ct=N[W.materialIndex];if(ct&&ct.visible){let pt=_(T,ct,M,S);T.onBeforeShadow(r,T,w,E,L,pt,W),r.renderBufferDirect(E,null,L,pt,T,W),T.onAfterShadow(r,T,w,E,L,pt,W)}}}else if(N.visible){let z=_(T,N,M,S);T.onBeforeShadow(r,T,w,E,L,z,null),r.renderBufferDirect(E,null,L,z,T,null),T.onAfterShadow(r,T,w,E,L,z,null)}}let P=T.children;for(let L=0,N=P.length;L<N;L++)y(P[L],w,E,M,S)}function b(T){T.target.removeEventListener("dispose",b);for(let E in l){let M=l[E],S=T.target.uuid;S in M&&(M[S].dispose(),delete M[S])}}}var Hw={[zl]:kl,[Vl]:Wl,[Hl]:Xl,[_r]:Gl,[kl]:zl,[Wl]:Vl,[Xl]:Hl,[Gl]:_r};function Gw(r,t){function e(){let U=!1,at=new Kt,dt=null,Tt=new Kt(0,0,0,0);return{setMask:function(st){dt!==st&&!U&&(r.colorMask(st,st,st,st),dt=st)},setLocked:function(st){U=st},setClear:function(st,Q,Ct,Yt,Se){Se===!0&&(st*=Yt,Q*=Yt,Ct*=Yt),at.set(st,Q,Ct,Yt),Tt.equals(at)===!1&&(r.clearColor(st,Q,Ct,Yt),Tt.copy(at))},reset:function(){U=!1,dt=null,Tt.set(-1,0,0,0)}}}function n(){let U=!1,at=!1,dt=null,Tt=null,st=null;return{setReversed:function(Q){if(at!==Q){let Ct=t.get("EXT_clip_control");Q?Ct.clipControlEXT(Ct.LOWER_LEFT_EXT,Ct.ZERO_TO_ONE_EXT):Ct.clipControlEXT(Ct.LOWER_LEFT_EXT,Ct.NEGATIVE_ONE_TO_ONE_EXT),at=Q;let Yt=st;st=null,this.setClear(Yt)}},getReversed:function(){return at},setTest:function(Q){Q?tt(r.DEPTH_TEST):St(r.DEPTH_TEST)},setMask:function(Q){dt!==Q&&!U&&(r.depthMask(Q),dt=Q)},setFunc:function(Q){if(at&&(Q=Hw[Q]),Tt!==Q){switch(Q){case zl:r.depthFunc(r.NEVER);break;case kl:r.depthFunc(r.ALWAYS);break;case Vl:r.depthFunc(r.LESS);break;case _r:r.depthFunc(r.LEQUAL);break;case Hl:r.depthFunc(r.EQUAL);break;case Gl:r.depthFunc(r.GEQUAL);break;case Wl:r.depthFunc(r.GREATER);break;case Xl:r.depthFunc(r.NOTEQUAL);break;default:r.depthFunc(r.LEQUAL)}Tt=Q}},setLocked:function(Q){U=Q},setClear:function(Q){st!==Q&&(at&&(Q=1-Q),r.clearDepth(Q),st=Q)},reset:function(){U=!1,dt=null,Tt=null,st=null,at=!1}}}function i(){let U=!1,at=null,dt=null,Tt=null,st=null,Q=null,Ct=null,Yt=null,Se=null;return{setTest:function(de){U||(de?tt(r.STENCIL_TEST):St(r.STENCIL_TEST))},setMask:function(de){at!==de&&!U&&(r.stencilMask(de),at=de)},setFunc:function(de,ui,jn){(dt!==de||Tt!==ui||st!==jn)&&(r.stencilFunc(de,ui,jn),dt=de,Tt=ui,st=jn)},setOp:function(de,ui,jn){(Q!==de||Ct!==ui||Yt!==jn)&&(r.stencilOp(de,ui,jn),Q=de,Ct=ui,Yt=jn)},setLocked:function(de){U=de},setClear:function(de){Se!==de&&(r.clearStencil(de),Se=de)},reset:function(){U=!1,at=null,dt=null,Tt=null,st=null,Q=null,Ct=null,Yt=null,Se=null}}}let s=new e,o=new n,a=new i,c=new WeakMap,l=new WeakMap,f={},h={},u=new WeakMap,d=[],g=null,x=!1,p=null,m=null,v=null,_=null,y=null,b=null,T=null,w=new ft(0,0,0),E=0,M=!1,S=null,I=null,P=null,L=null,N=null,z=r.getParameter(r.MAX_COMBINED_TEXTURE_IMAGE_UNITS),V=!1,j=0,W=r.getParameter(r.VERSION);W.indexOf("WebGL")!==-1?(j=parseFloat(/^WebGL (\d)/.exec(W)[1]),V=j>=1):W.indexOf("OpenGL ES")!==-1&&(j=parseFloat(/^OpenGL ES (\d)/.exec(W)[1]),V=j>=2);let ct=null,pt={},_t=r.getParameter(r.SCISSOR_BOX),Ht=r.getParameter(r.VIEWPORT),ee=new Kt().fromArray(_t),he=new Kt().fromArray(Ht);function Qt(U,at,dt,Tt){let st=new Uint8Array(4),Q=r.createTexture();r.bindTexture(U,Q),r.texParameteri(U,r.TEXTURE_MIN_FILTER,r.NEAREST),r.texParameteri(U,r.TEXTURE_MAG_FILTER,r.NEAREST);for(let Ct=0;Ct<dt;Ct++)U===r.TEXTURE_3D||U===r.TEXTURE_2D_ARRAY?r.texImage3D(at,0,r.RGBA,1,1,Tt,0,r.RGBA,r.UNSIGNED_BYTE,st):r.texImage2D(at+Ct,0,r.RGBA,1,1,0,r.RGBA,r.UNSIGNED_BYTE,st);return Q}let $={};$[r.TEXTURE_2D]=Qt(r.TEXTURE_2D,r.TEXTURE_2D,1),$[r.TEXTURE_CUBE_MAP]=Qt(r.TEXTURE_CUBE_MAP,r.TEXTURE_CUBE_MAP_POSITIVE_X,6),$[r.TEXTURE_2D_ARRAY]=Qt(r.TEXTURE_2D_ARRAY,r.TEXTURE_2D_ARRAY,1,1),$[r.TEXTURE_3D]=Qt(r.TEXTURE_3D,r.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),tt(r.DEPTH_TEST),o.setFunc(_r),J(!1),Z(Ld),tt(r.CULL_FACE),nt(ke);function tt(U){f[U]!==!0&&(r.enable(U),f[U]=!0)}function St(U){f[U]!==!1&&(r.disable(U),f[U]=!1)}function Pt(U,at){return h[U]!==at?(r.bindFramebuffer(U,at),h[U]=at,U===r.DRAW_FRAMEBUFFER&&(h[r.FRAMEBUFFER]=at),U===r.FRAMEBUFFER&&(h[r.DRAW_FRAMEBUFFER]=at),!0):!1}function wt(U,at){let dt=d,Tt=!1;if(U){dt=u.get(at),dt===void 0&&(dt=[],u.set(at,dt));let st=U.textures;if(dt.length!==st.length||dt[0]!==r.COLOR_ATTACHMENT0){for(let Q=0,Ct=st.length;Q<Ct;Q++)dt[Q]=r.COLOR_ATTACHMENT0+Q;dt.length=st.length,Tt=!0}}else dt[0]!==r.BACK&&(dt[0]=r.BACK,Tt=!0);Tt&&r.drawBuffers(dt)}function te(U){return g!==U?(r.useProgram(U),g=U,!0):!1}let fe={[Ni]:r.FUNC_ADD,[_g]:r.FUNC_SUBTRACT,[yg]:r.FUNC_REVERSE_SUBTRACT};fe[bg]=r.MIN,fe[Sg]=r.MAX;let F={[Mg]:r.ZERO,[Tg]:r.ONE,[wg]:r.SRC_COLOR,[Rc]:r.SRC_ALPHA,[Pg]:r.SRC_ALPHA_SATURATE,[Cg]:r.DST_COLOR,[Eg]:r.DST_ALPHA,[Ag]:r.ONE_MINUS_SRC_COLOR,[Cc]:r.ONE_MINUS_SRC_ALPHA,[Ig]:r.ONE_MINUS_DST_COLOR,[Rg]:r.ONE_MINUS_DST_ALPHA,[Dg]:r.CONSTANT_COLOR,[Fg]:r.ONE_MINUS_CONSTANT_COLOR,[Lg]:r.CONSTANT_ALPHA,[Ng]:r.ONE_MINUS_CONSTANT_ALPHA};function nt(U,at,dt,Tt,st,Q,Ct,Yt,Se,de){if(U===ke){x===!0&&(St(r.BLEND),x=!1);return}if(x===!1&&(tt(r.BLEND),x=!0),U!==vg){if(U!==p||de!==M){if((m!==Ni||y!==Ni)&&(r.blendEquation(r.FUNC_ADD),m=Ni,y=Ni),de)switch(U){case Yn:r.blendFuncSeparate(r.ONE,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case la:r.blendFunc(r.ONE,r.ONE);break;case Ud:r.blendFuncSeparate(r.ZERO,r.ONE_MINUS_SRC_COLOR,r.ZERO,r.ONE);break;case Bd:r.blendFuncSeparate(r.DST_COLOR,r.ONE_MINUS_SRC_ALPHA,r.ZERO,r.ONE);break;default:console.error("THREE.WebGLState: Invalid blending: ",U);break}else switch(U){case Yn:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case la:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE,r.ONE,r.ONE);break;case Ud:console.error("THREE.WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Bd:console.error("THREE.WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:console.error("THREE.WebGLState: Invalid blending: ",U);break}v=null,_=null,b=null,T=null,w.set(0,0,0),E=0,p=U,M=de}return}st=st||at,Q=Q||dt,Ct=Ct||Tt,(at!==m||st!==y)&&(r.blendEquationSeparate(fe[at],fe[st]),m=at,y=st),(dt!==v||Tt!==_||Q!==b||Ct!==T)&&(r.blendFuncSeparate(F[dt],F[Tt],F[Q],F[Ct]),v=dt,_=Tt,b=Q,T=Ct),(Yt.equals(w)===!1||Se!==E)&&(r.blendColor(Yt.r,Yt.g,Yt.b,Se),w.copy(Yt),E=Se),p=U,M=!1}function K(U,at){U.side===Sn?St(r.CULL_FACE):tt(r.CULL_FACE);let dt=U.side===He;at&&(dt=!dt),J(dt),U.blending===Yn&&U.transparent===!1?nt(ke):nt(U.blending,U.blendEquation,U.blendSrc,U.blendDst,U.blendEquationAlpha,U.blendSrcAlpha,U.blendDstAlpha,U.blendColor,U.blendAlpha,U.premultipliedAlpha),o.setFunc(U.depthFunc),o.setTest(U.depthTest),o.setMask(U.depthWrite),s.setMask(U.colorWrite);let Tt=U.stencilWrite;a.setTest(Tt),Tt&&(a.setMask(U.stencilWriteMask),a.setFunc(U.stencilFunc,U.stencilRef,U.stencilFuncMask),a.setOp(U.stencilFail,U.stencilZFail,U.stencilZPass)),it(U.polygonOffset,U.polygonOffsetFactor,U.polygonOffsetUnits),U.alphaToCoverage===!0?tt(r.SAMPLE_ALPHA_TO_COVERAGE):St(r.SAMPLE_ALPHA_TO_COVERAGE)}function J(U){S!==U&&(U?r.frontFace(r.CW):r.frontFace(r.CCW),S=U)}function Z(U){U!==mg?(tt(r.CULL_FACE),U!==I&&(U===Ld?r.cullFace(r.BACK):U===gg?r.cullFace(r.FRONT):r.cullFace(r.FRONT_AND_BACK))):St(r.CULL_FACE),I=U}function ut(U){U!==P&&(V&&r.lineWidth(U),P=U)}function it(U,at,dt){U?(tt(r.POLYGON_OFFSET_FILL),(L!==at||N!==dt)&&(r.polygonOffset(at,dt),L=at,N=dt)):St(r.POLYGON_OFFSET_FILL)}function ht(U){U?tt(r.SCISSOR_TEST):St(r.SCISSOR_TEST)}function qt(U){U===void 0&&(U=r.TEXTURE0+z-1),ct!==U&&(r.activeTexture(U),ct=U)}function Wt(U,at,dt){dt===void 0&&(ct===null?dt=r.TEXTURE0+z-1:dt=ct);let Tt=pt[dt];Tt===void 0&&(Tt={type:void 0,texture:void 0},pt[dt]=Tt),(Tt.type!==U||Tt.texture!==at)&&(ct!==dt&&(r.activeTexture(dt),ct=dt),r.bindTexture(U,at||$[U]),Tt.type=U,Tt.texture=at)}function D(){let U=pt[ct];U!==void 0&&U.type!==void 0&&(r.bindTexture(U.type,null),U.type=void 0,U.texture=void 0)}function A(){try{r.compressedTexImage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function k(){try{r.compressedTexImage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function X(){try{r.texSubImage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function et(){try{r.texSubImage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Y(){try{r.compressedTexSubImage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function It(){try{r.compressedTexSubImage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function lt(){try{r.texStorage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Et(){try{r.texStorage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Rt(){try{r.texImage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function rt(){try{r.texImage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function yt(U){ee.equals(U)===!1&&(r.scissor(U.x,U.y,U.z,U.w),ee.copy(U))}function zt(U){he.equals(U)===!1&&(r.viewport(U.x,U.y,U.z,U.w),he.copy(U))}function Dt(U,at){let dt=l.get(at);dt===void 0&&(dt=new WeakMap,l.set(at,dt));let Tt=dt.get(U);Tt===void 0&&(Tt=r.getUniformBlockIndex(at,U.name),dt.set(U,Tt))}function xt(U,at){let Tt=l.get(at).get(U);c.get(at)!==Tt&&(r.uniformBlockBinding(at,Tt,U.__bindingPointIndex),c.set(at,Tt))}function Jt(){r.disable(r.BLEND),r.disable(r.CULL_FACE),r.disable(r.DEPTH_TEST),r.disable(r.POLYGON_OFFSET_FILL),r.disable(r.SCISSOR_TEST),r.disable(r.STENCIL_TEST),r.disable(r.SAMPLE_ALPHA_TO_COVERAGE),r.blendEquation(r.FUNC_ADD),r.blendFunc(r.ONE,r.ZERO),r.blendFuncSeparate(r.ONE,r.ZERO,r.ONE,r.ZERO),r.blendColor(0,0,0,0),r.colorMask(!0,!0,!0,!0),r.clearColor(0,0,0,0),r.depthMask(!0),r.depthFunc(r.LESS),o.setReversed(!1),r.clearDepth(1),r.stencilMask(4294967295),r.stencilFunc(r.ALWAYS,0,4294967295),r.stencilOp(r.KEEP,r.KEEP,r.KEEP),r.clearStencil(0),r.cullFace(r.BACK),r.frontFace(r.CCW),r.polygonOffset(0,0),r.activeTexture(r.TEXTURE0),r.bindFramebuffer(r.FRAMEBUFFER,null),r.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),r.bindFramebuffer(r.READ_FRAMEBUFFER,null),r.useProgram(null),r.lineWidth(1),r.scissor(0,0,r.canvas.width,r.canvas.height),r.viewport(0,0,r.canvas.width,r.canvas.height),f={},ct=null,pt={},h={},u=new WeakMap,d=[],g=null,x=!1,p=null,m=null,v=null,_=null,y=null,b=null,T=null,w=new ft(0,0,0),E=0,M=!1,S=null,I=null,P=null,L=null,N=null,ee.set(0,0,r.canvas.width,r.canvas.height),he.set(0,0,r.canvas.width,r.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:tt,disable:St,bindFramebuffer:Pt,drawBuffers:wt,useProgram:te,setBlending:nt,setMaterial:K,setFlipSided:J,setCullFace:Z,setLineWidth:ut,setPolygonOffset:it,setScissorTest:ht,activeTexture:qt,bindTexture:Wt,unbindTexture:D,compressedTexImage2D:A,compressedTexImage3D:k,texImage2D:Rt,texImage3D:rt,updateUBOMapping:Dt,uniformBlockBinding:xt,texStorage2D:lt,texStorage3D:Et,texSubImage2D:X,texSubImage3D:et,compressedTexSubImage2D:Y,compressedTexSubImage3D:It,scissor:yt,viewport:zt,reset:Jt}}function Ww(r,t,e,n,i,s,o){let a=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),l=new q,f=new WeakMap,h,u=new WeakMap,d=!1;try{d=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(D,A){return d?new OffscreenCanvas(D,A):_s("canvas")}function x(D,A,k){let X=1,et=Wt(D);if((et.width>k||et.height>k)&&(X=k/Math.max(et.width,et.height)),X<1)if(typeof HTMLImageElement<"u"&&D instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&D instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&D instanceof ImageBitmap||typeof VideoFrame<"u"&&D instanceof VideoFrame){let Y=Math.floor(X*et.width),It=Math.floor(X*et.height);h===void 0&&(h=g(Y,It));let lt=A?g(Y,It):h;return lt.width=Y,lt.height=It,lt.getContext("2d").drawImage(D,0,0,Y,It),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+et.width+"x"+et.height+") to ("+Y+"x"+It+")."),lt}else return"data"in D&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+et.width+"x"+et.height+")."),D;return D}function p(D){return D.generateMipmaps}function m(D){r.generateMipmap(D)}function v(D){return D.isWebGLCubeRenderTarget?r.TEXTURE_CUBE_MAP:D.isWebGL3DRenderTarget?r.TEXTURE_3D:D.isWebGLArrayRenderTarget||D.isCompressedArrayTexture?r.TEXTURE_2D_ARRAY:r.TEXTURE_2D}function _(D,A,k,X,et=!1){if(D!==null){if(r[D]!==void 0)return r[D];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+D+"'")}let Y=A;if(A===r.RED&&(k===r.FLOAT&&(Y=r.R32F),k===r.HALF_FLOAT&&(Y=r.R16F),k===r.UNSIGNED_BYTE&&(Y=r.R8)),A===r.RED_INTEGER&&(k===r.UNSIGNED_BYTE&&(Y=r.R8UI),k===r.UNSIGNED_SHORT&&(Y=r.R16UI),k===r.UNSIGNED_INT&&(Y=r.R32UI),k===r.BYTE&&(Y=r.R8I),k===r.SHORT&&(Y=r.R16I),k===r.INT&&(Y=r.R32I)),A===r.RG&&(k===r.FLOAT&&(Y=r.RG32F),k===r.HALF_FLOAT&&(Y=r.RG16F),k===r.UNSIGNED_BYTE&&(Y=r.RG8)),A===r.RG_INTEGER&&(k===r.UNSIGNED_BYTE&&(Y=r.RG8UI),k===r.UNSIGNED_SHORT&&(Y=r.RG16UI),k===r.UNSIGNED_INT&&(Y=r.RG32UI),k===r.BYTE&&(Y=r.RG8I),k===r.SHORT&&(Y=r.RG16I),k===r.INT&&(Y=r.RG32I)),A===r.RGB_INTEGER&&(k===r.UNSIGNED_BYTE&&(Y=r.RGB8UI),k===r.UNSIGNED_SHORT&&(Y=r.RGB16UI),k===r.UNSIGNED_INT&&(Y=r.RGB32UI),k===r.BYTE&&(Y=r.RGB8I),k===r.SHORT&&(Y=r.RGB16I),k===r.INT&&(Y=r.RGB32I)),A===r.RGBA_INTEGER&&(k===r.UNSIGNED_BYTE&&(Y=r.RGBA8UI),k===r.UNSIGNED_SHORT&&(Y=r.RGBA16UI),k===r.UNSIGNED_INT&&(Y=r.RGBA32UI),k===r.BYTE&&(Y=r.RGBA8I),k===r.SHORT&&(Y=r.RGBA16I),k===r.INT&&(Y=r.RGBA32I)),A===r.RGB&&(k===r.UNSIGNED_INT_5_9_9_9_REV&&(Y=r.RGB9_E5),k===r.UNSIGNED_INT_10F_11F_11F_REV&&(Y=r.R11F_G11F_B10F)),A===r.RGBA){let It=et?Co:ie.getTransfer(X);k===r.FLOAT&&(Y=r.RGBA32F),k===r.HALF_FLOAT&&(Y=r.RGBA16F),k===r.UNSIGNED_BYTE&&(Y=It===me?r.SRGB8_ALPHA8:r.RGBA8),k===r.UNSIGNED_SHORT_4_4_4_4&&(Y=r.RGBA4),k===r.UNSIGNED_SHORT_5_5_5_1&&(Y=r.RGB5_A1)}return(Y===r.R16F||Y===r.R32F||Y===r.RG16F||Y===r.RG32F||Y===r.RGBA16F||Y===r.RGBA32F)&&t.get("EXT_color_buffer_float"),Y}function y(D,A){let k;return D?A===null||A===an||A===Os?k=r.DEPTH24_STENCIL8:A===$t?k=r.DEPTH32F_STENCIL8:A===Hi&&(k=r.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):A===null||A===an||A===Os?k=r.DEPTH_COMPONENT24:A===$t?k=r.DEPTH_COMPONENT32F:A===Hi&&(k=r.DEPTH_COMPONENT16),k}function b(D,A){return p(D)===!0||D.isFramebufferTexture&&D.minFilter!==Vt&&D.minFilter!==re?Math.log2(Math.max(A.width,A.height))+1:D.mipmaps!==void 0&&D.mipmaps.length>0?D.mipmaps.length:D.isCompressedTexture&&Array.isArray(D.image)?A.mipmaps.length:1}function T(D){let A=D.target;A.removeEventListener("dispose",T),E(A),A.isVideoTexture&&f.delete(A)}function w(D){let A=D.target;A.removeEventListener("dispose",w),S(A)}function E(D){let A=n.get(D);if(A.__webglInit===void 0)return;let k=D.source,X=u.get(k);if(X){let et=X[A.__cacheKey];et.usedTimes--,et.usedTimes===0&&M(D),Object.keys(X).length===0&&u.delete(k)}n.remove(D)}function M(D){let A=n.get(D);r.deleteTexture(A.__webglTexture);let k=D.source,X=u.get(k);delete X[A.__cacheKey],o.memory.textures--}function S(D){let A=n.get(D);if(D.depthTexture&&(D.depthTexture.dispose(),n.remove(D.depthTexture)),D.isWebGLCubeRenderTarget)for(let X=0;X<6;X++){if(Array.isArray(A.__webglFramebuffer[X]))for(let et=0;et<A.__webglFramebuffer[X].length;et++)r.deleteFramebuffer(A.__webglFramebuffer[X][et]);else r.deleteFramebuffer(A.__webglFramebuffer[X]);A.__webglDepthbuffer&&r.deleteRenderbuffer(A.__webglDepthbuffer[X])}else{if(Array.isArray(A.__webglFramebuffer))for(let X=0;X<A.__webglFramebuffer.length;X++)r.deleteFramebuffer(A.__webglFramebuffer[X]);else r.deleteFramebuffer(A.__webglFramebuffer);if(A.__webglDepthbuffer&&r.deleteRenderbuffer(A.__webglDepthbuffer),A.__webglMultisampledFramebuffer&&r.deleteFramebuffer(A.__webglMultisampledFramebuffer),A.__webglColorRenderbuffer)for(let X=0;X<A.__webglColorRenderbuffer.length;X++)A.__webglColorRenderbuffer[X]&&r.deleteRenderbuffer(A.__webglColorRenderbuffer[X]);A.__webglDepthRenderbuffer&&r.deleteRenderbuffer(A.__webglDepthRenderbuffer)}let k=D.textures;for(let X=0,et=k.length;X<et;X++){let Y=n.get(k[X]);Y.__webglTexture&&(r.deleteTexture(Y.__webglTexture),o.memory.textures--),n.remove(k[X])}n.remove(D)}let I=0;function P(){I=0}function L(){let D=I;return D>=i.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+D+" texture units while this GPU supports only "+i.maxTextures),I+=1,D}function N(D){let A=[];return A.push(D.wrapS),A.push(D.wrapT),A.push(D.wrapR||0),A.push(D.magFilter),A.push(D.minFilter),A.push(D.anisotropy),A.push(D.internalFormat),A.push(D.format),A.push(D.type),A.push(D.generateMipmaps),A.push(D.premultiplyAlpha),A.push(D.flipY),A.push(D.unpackAlignment),A.push(D.colorSpace),A.join()}function z(D,A){let k=n.get(D);if(D.isVideoTexture&&ht(D),D.isRenderTargetTexture===!1&&D.isExternalTexture!==!0&&D.version>0&&k.__version!==D.version){let X=D.image;if(X===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(X.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{$(k,D,A);return}}else D.isExternalTexture&&(k.__webglTexture=D.sourceTexture?D.sourceTexture:null);e.bindTexture(r.TEXTURE_2D,k.__webglTexture,r.TEXTURE0+A)}function V(D,A){let k=n.get(D);if(D.isRenderTargetTexture===!1&&D.version>0&&k.__version!==D.version){$(k,D,A);return}e.bindTexture(r.TEXTURE_2D_ARRAY,k.__webglTexture,r.TEXTURE0+A)}function j(D,A){let k=n.get(D);if(D.isRenderTargetTexture===!1&&D.version>0&&k.__version!==D.version){$(k,D,A);return}e.bindTexture(r.TEXTURE_3D,k.__webglTexture,r.TEXTURE0+A)}function W(D,A){let k=n.get(D);if(D.version>0&&k.__version!==D.version){tt(k,D,A);return}e.bindTexture(r.TEXTURE_CUBE_MAP,k.__webglTexture,r.TEXTURE0+A)}let ct={[Ke]:r.REPEAT,[we]:r.CLAMP_TO_EDGE,[Ao]:r.MIRRORED_REPEAT},pt={[Vt]:r.NEAREST,[Od]:r.NEAREST_MIPMAP_NEAREST,[Us]:r.NEAREST_MIPMAP_LINEAR,[re]:r.LINEAR,[fa]:r.LINEAR_MIPMAP_NEAREST,[ai]:r.LINEAR_MIPMAP_LINEAR},_t={[Qg]:r.NEVER,[r0]:r.ALWAYS,[jg]:r.LESS,[Xd]:r.LEQUAL,[t0]:r.EQUAL,[i0]:r.GEQUAL,[e0]:r.GREATER,[n0]:r.NOTEQUAL};function Ht(D,A){if(A.type===$t&&t.has("OES_texture_float_linear")===!1&&(A.magFilter===re||A.magFilter===fa||A.magFilter===Us||A.magFilter===ai||A.minFilter===re||A.minFilter===fa||A.minFilter===Us||A.minFilter===ai)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),r.texParameteri(D,r.TEXTURE_WRAP_S,ct[A.wrapS]),r.texParameteri(D,r.TEXTURE_WRAP_T,ct[A.wrapT]),(D===r.TEXTURE_3D||D===r.TEXTURE_2D_ARRAY)&&r.texParameteri(D,r.TEXTURE_WRAP_R,ct[A.wrapR]),r.texParameteri(D,r.TEXTURE_MAG_FILTER,pt[A.magFilter]),r.texParameteri(D,r.TEXTURE_MIN_FILTER,pt[A.minFilter]),A.compareFunction&&(r.texParameteri(D,r.TEXTURE_COMPARE_MODE,r.COMPARE_REF_TO_TEXTURE),r.texParameteri(D,r.TEXTURE_COMPARE_FUNC,_t[A.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(A.magFilter===Vt||A.minFilter!==Us&&A.minFilter!==ai||A.type===$t&&t.has("OES_texture_float_linear")===!1)return;if(A.anisotropy>1||n.get(A).__currentAnisotropy){let k=t.get("EXT_texture_filter_anisotropic");r.texParameterf(D,k.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(A.anisotropy,i.getMaxAnisotropy())),n.get(A).__currentAnisotropy=A.anisotropy}}}function ee(D,A){let k=!1;D.__webglInit===void 0&&(D.__webglInit=!0,A.addEventListener("dispose",T));let X=A.source,et=u.get(X);et===void 0&&(et={},u.set(X,et));let Y=N(A);if(Y!==D.__cacheKey){et[Y]===void 0&&(et[Y]={texture:r.createTexture(),usedTimes:0},o.memory.textures++,k=!0),et[Y].usedTimes++;let It=et[D.__cacheKey];It!==void 0&&(et[D.__cacheKey].usedTimes--,It.usedTimes===0&&M(A)),D.__cacheKey=Y,D.__webglTexture=et[Y].texture}return k}function he(D,A,k){return Math.floor(Math.floor(D/k)/A)}function Qt(D,A,k,X){let Y=D.updateRanges;if(Y.length===0)e.texSubImage2D(r.TEXTURE_2D,0,0,0,A.width,A.height,k,X,A.data);else{Y.sort((rt,yt)=>rt.start-yt.start);let It=0;for(let rt=1;rt<Y.length;rt++){let yt=Y[It],zt=Y[rt],Dt=yt.start+yt.count,xt=he(zt.start,A.width,4),Jt=he(yt.start,A.width,4);zt.start<=Dt+1&&xt===Jt&&he(zt.start+zt.count-1,A.width,4)===xt?yt.count=Math.max(yt.count,zt.start+zt.count-yt.start):(++It,Y[It]=zt)}Y.length=It+1;let lt=r.getParameter(r.UNPACK_ROW_LENGTH),Et=r.getParameter(r.UNPACK_SKIP_PIXELS),Rt=r.getParameter(r.UNPACK_SKIP_ROWS);r.pixelStorei(r.UNPACK_ROW_LENGTH,A.width);for(let rt=0,yt=Y.length;rt<yt;rt++){let zt=Y[rt],Dt=Math.floor(zt.start/4),xt=Math.ceil(zt.count/4),Jt=Dt%A.width,U=Math.floor(Dt/A.width),at=xt,dt=1;r.pixelStorei(r.UNPACK_SKIP_PIXELS,Jt),r.pixelStorei(r.UNPACK_SKIP_ROWS,U),e.texSubImage2D(r.TEXTURE_2D,0,Jt,U,at,dt,k,X,A.data)}D.clearUpdateRanges(),r.pixelStorei(r.UNPACK_ROW_LENGTH,lt),r.pixelStorei(r.UNPACK_SKIP_PIXELS,Et),r.pixelStorei(r.UNPACK_SKIP_ROWS,Rt)}}function $(D,A,k){let X=r.TEXTURE_2D;(A.isDataArrayTexture||A.isCompressedArrayTexture)&&(X=r.TEXTURE_2D_ARRAY),A.isData3DTexture&&(X=r.TEXTURE_3D);let et=ee(D,A),Y=A.source;e.bindTexture(X,D.__webglTexture,r.TEXTURE0+k);let It=n.get(Y);if(Y.version!==It.__version||et===!0){e.activeTexture(r.TEXTURE0+k);let lt=ie.getPrimaries(ie.workingColorSpace),Et=A.colorSpace===Ti?null:ie.getPrimaries(A.colorSpace),Rt=A.colorSpace===Ti||lt===Et?r.NONE:r.BROWSER_DEFAULT_WEBGL;r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,A.flipY),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,A.premultiplyAlpha),r.pixelStorei(r.UNPACK_ALIGNMENT,A.unpackAlignment),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,Rt);let rt=x(A.image,!1,i.maxTextureSize);rt=qt(A,rt);let yt=s.convert(A.format,A.colorSpace),zt=s.convert(A.type),Dt=_(A.internalFormat,yt,zt,A.colorSpace,A.isVideoTexture);Ht(X,A);let xt,Jt=A.mipmaps,U=A.isVideoTexture!==!0,at=It.__version===void 0||et===!0,dt=Y.dataReady,Tt=b(A,rt);if(A.isDepthTexture)Dt=y(A.format===zs,A.type),at&&(U?e.texStorage2D(r.TEXTURE_2D,1,Dt,rt.width,rt.height):e.texImage2D(r.TEXTURE_2D,0,Dt,rt.width,rt.height,0,yt,zt,null));else if(A.isDataTexture)if(Jt.length>0){U&&at&&e.texStorage2D(r.TEXTURE_2D,Tt,Dt,Jt[0].width,Jt[0].height);for(let st=0,Q=Jt.length;st<Q;st++)xt=Jt[st],U?dt&&e.texSubImage2D(r.TEXTURE_2D,st,0,0,xt.width,xt.height,yt,zt,xt.data):e.texImage2D(r.TEXTURE_2D,st,Dt,xt.width,xt.height,0,yt,zt,xt.data);A.generateMipmaps=!1}else U?(at&&e.texStorage2D(r.TEXTURE_2D,Tt,Dt,rt.width,rt.height),dt&&Qt(A,rt,yt,zt)):e.texImage2D(r.TEXTURE_2D,0,Dt,rt.width,rt.height,0,yt,zt,rt.data);else if(A.isCompressedTexture)if(A.isCompressedArrayTexture){U&&at&&e.texStorage3D(r.TEXTURE_2D_ARRAY,Tt,Dt,Jt[0].width,Jt[0].height,rt.depth);for(let st=0,Q=Jt.length;st<Q;st++)if(xt=Jt[st],A.format!==Gt)if(yt!==null)if(U){if(dt)if(A.layerUpdates.size>0){let Ct=Tu(xt.width,xt.height,A.format,A.type);for(let Yt of A.layerUpdates){let Se=xt.data.subarray(Yt*Ct/xt.data.BYTES_PER_ELEMENT,(Yt+1)*Ct/xt.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,st,0,0,Yt,xt.width,xt.height,1,yt,Se)}A.clearLayerUpdates()}else e.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,st,0,0,0,xt.width,xt.height,rt.depth,yt,xt.data)}else e.compressedTexImage3D(r.TEXTURE_2D_ARRAY,st,Dt,xt.width,xt.height,rt.depth,0,xt.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else U?dt&&e.texSubImage3D(r.TEXTURE_2D_ARRAY,st,0,0,0,xt.width,xt.height,rt.depth,yt,zt,xt.data):e.texImage3D(r.TEXTURE_2D_ARRAY,st,Dt,xt.width,xt.height,rt.depth,0,yt,zt,xt.data)}else{U&&at&&e.texStorage2D(r.TEXTURE_2D,Tt,Dt,Jt[0].width,Jt[0].height);for(let st=0,Q=Jt.length;st<Q;st++)xt=Jt[st],A.format!==Gt?yt!==null?U?dt&&e.compressedTexSubImage2D(r.TEXTURE_2D,st,0,0,xt.width,xt.height,yt,xt.data):e.compressedTexImage2D(r.TEXTURE_2D,st,Dt,xt.width,xt.height,0,xt.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):U?dt&&e.texSubImage2D(r.TEXTURE_2D,st,0,0,xt.width,xt.height,yt,zt,xt.data):e.texImage2D(r.TEXTURE_2D,st,Dt,xt.width,xt.height,0,yt,zt,xt.data)}else if(A.isDataArrayTexture)if(U){if(at&&e.texStorage3D(r.TEXTURE_2D_ARRAY,Tt,Dt,rt.width,rt.height,rt.depth),dt)if(A.layerUpdates.size>0){let st=Tu(rt.width,rt.height,A.format,A.type);for(let Q of A.layerUpdates){let Ct=rt.data.subarray(Q*st/rt.data.BYTES_PER_ELEMENT,(Q+1)*st/rt.data.BYTES_PER_ELEMENT);e.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,Q,rt.width,rt.height,1,yt,zt,Ct)}A.clearLayerUpdates()}else e.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,0,rt.width,rt.height,rt.depth,yt,zt,rt.data)}else e.texImage3D(r.TEXTURE_2D_ARRAY,0,Dt,rt.width,rt.height,rt.depth,0,yt,zt,rt.data);else if(A.isData3DTexture)U?(at&&e.texStorage3D(r.TEXTURE_3D,Tt,Dt,rt.width,rt.height,rt.depth),dt&&e.texSubImage3D(r.TEXTURE_3D,0,0,0,0,rt.width,rt.height,rt.depth,yt,zt,rt.data)):e.texImage3D(r.TEXTURE_3D,0,Dt,rt.width,rt.height,rt.depth,0,yt,zt,rt.data);else if(A.isFramebufferTexture){if(at)if(U)e.texStorage2D(r.TEXTURE_2D,Tt,Dt,rt.width,rt.height);else{let st=rt.width,Q=rt.height;for(let Ct=0;Ct<Tt;Ct++)e.texImage2D(r.TEXTURE_2D,Ct,Dt,st,Q,0,yt,zt,null),st>>=1,Q>>=1}}else if(Jt.length>0){if(U&&at){let st=Wt(Jt[0]);e.texStorage2D(r.TEXTURE_2D,Tt,Dt,st.width,st.height)}for(let st=0,Q=Jt.length;st<Q;st++)xt=Jt[st],U?dt&&e.texSubImage2D(r.TEXTURE_2D,st,0,0,yt,zt,xt):e.texImage2D(r.TEXTURE_2D,st,Dt,yt,zt,xt);A.generateMipmaps=!1}else if(U){if(at){let st=Wt(rt);e.texStorage2D(r.TEXTURE_2D,Tt,Dt,st.width,st.height)}dt&&e.texSubImage2D(r.TEXTURE_2D,0,0,0,yt,zt,rt)}else e.texImage2D(r.TEXTURE_2D,0,Dt,yt,zt,rt);p(A)&&m(X),It.__version=Y.version,A.onUpdate&&A.onUpdate(A)}D.__version=A.version}function tt(D,A,k){if(A.image.length!==6)return;let X=ee(D,A),et=A.source;e.bindTexture(r.TEXTURE_CUBE_MAP,D.__webglTexture,r.TEXTURE0+k);let Y=n.get(et);if(et.version!==Y.__version||X===!0){e.activeTexture(r.TEXTURE0+k);let It=ie.getPrimaries(ie.workingColorSpace),lt=A.colorSpace===Ti?null:ie.getPrimaries(A.colorSpace),Et=A.colorSpace===Ti||It===lt?r.NONE:r.BROWSER_DEFAULT_WEBGL;r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,A.flipY),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,A.premultiplyAlpha),r.pixelStorei(r.UNPACK_ALIGNMENT,A.unpackAlignment),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,Et);let Rt=A.isCompressedTexture||A.image[0].isCompressedTexture,rt=A.image[0]&&A.image[0].isDataTexture,yt=[];for(let Q=0;Q<6;Q++)!Rt&&!rt?yt[Q]=x(A.image[Q],!0,i.maxCubemapSize):yt[Q]=rt?A.image[Q].image:A.image[Q],yt[Q]=qt(A,yt[Q]);let zt=yt[0],Dt=s.convert(A.format,A.colorSpace),xt=s.convert(A.type),Jt=_(A.internalFormat,Dt,xt,A.colorSpace),U=A.isVideoTexture!==!0,at=Y.__version===void 0||X===!0,dt=et.dataReady,Tt=b(A,zt);Ht(r.TEXTURE_CUBE_MAP,A);let st;if(Rt){U&&at&&e.texStorage2D(r.TEXTURE_CUBE_MAP,Tt,Jt,zt.width,zt.height);for(let Q=0;Q<6;Q++){st=yt[Q].mipmaps;for(let Ct=0;Ct<st.length;Ct++){let Yt=st[Ct];A.format!==Gt?Dt!==null?U?dt&&e.compressedTexSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ct,0,0,Yt.width,Yt.height,Dt,Yt.data):e.compressedTexImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ct,Jt,Yt.width,Yt.height,0,Yt.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):U?dt&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ct,0,0,Yt.width,Yt.height,Dt,xt,Yt.data):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ct,Jt,Yt.width,Yt.height,0,Dt,xt,Yt.data)}}}else{if(st=A.mipmaps,U&&at){st.length>0&&Tt++;let Q=Wt(yt[0]);e.texStorage2D(r.TEXTURE_CUBE_MAP,Tt,Jt,Q.width,Q.height)}for(let Q=0;Q<6;Q++)if(rt){U?dt&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,yt[Q].width,yt[Q].height,Dt,xt,yt[Q].data):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,Jt,yt[Q].width,yt[Q].height,0,Dt,xt,yt[Q].data);for(let Ct=0;Ct<st.length;Ct++){let Se=st[Ct].image[Q].image;U?dt&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ct+1,0,0,Se.width,Se.height,Dt,xt,Se.data):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ct+1,Jt,Se.width,Se.height,0,Dt,xt,Se.data)}}else{U?dt&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,Dt,xt,yt[Q]):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,Jt,Dt,xt,yt[Q]);for(let Ct=0;Ct<st.length;Ct++){let Yt=st[Ct];U?dt&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ct+1,0,0,Dt,xt,Yt.image[Q]):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ct+1,Jt,Dt,xt,Yt.image[Q])}}}p(A)&&m(r.TEXTURE_CUBE_MAP),Y.__version=et.version,A.onUpdate&&A.onUpdate(A)}D.__version=A.version}function St(D,A,k,X,et,Y){let It=s.convert(k.format,k.colorSpace),lt=s.convert(k.type),Et=_(k.internalFormat,It,lt,k.colorSpace),Rt=n.get(A),rt=n.get(k);if(rt.__renderTarget=A,!Rt.__hasExternalTextures){let yt=Math.max(1,A.width>>Y),zt=Math.max(1,A.height>>Y);et===r.TEXTURE_3D||et===r.TEXTURE_2D_ARRAY?e.texImage3D(et,Y,Et,yt,zt,A.depth,0,It,lt,null):e.texImage2D(et,Y,Et,yt,zt,0,It,lt,null)}e.bindFramebuffer(r.FRAMEBUFFER,D),it(A)?a.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,X,et,rt.__webglTexture,0,ut(A)):(et===r.TEXTURE_2D||et>=r.TEXTURE_CUBE_MAP_POSITIVE_X&&et<=r.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&r.framebufferTexture2D(r.FRAMEBUFFER,X,et,rt.__webglTexture,Y),e.bindFramebuffer(r.FRAMEBUFFER,null)}function Pt(D,A,k){if(r.bindRenderbuffer(r.RENDERBUFFER,D),A.depthBuffer){let X=A.depthTexture,et=X&&X.isDepthTexture?X.type:null,Y=y(A.stencilBuffer,et),It=A.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,lt=ut(A);it(A)?a.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,lt,Y,A.width,A.height):k?r.renderbufferStorageMultisample(r.RENDERBUFFER,lt,Y,A.width,A.height):r.renderbufferStorage(r.RENDERBUFFER,Y,A.width,A.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,It,r.RENDERBUFFER,D)}else{let X=A.textures;for(let et=0;et<X.length;et++){let Y=X[et],It=s.convert(Y.format,Y.colorSpace),lt=s.convert(Y.type),Et=_(Y.internalFormat,It,lt,Y.colorSpace),Rt=ut(A);k&&it(A)===!1?r.renderbufferStorageMultisample(r.RENDERBUFFER,Rt,Et,A.width,A.height):it(A)?a.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,Rt,Et,A.width,A.height):r.renderbufferStorage(r.RENDERBUFFER,Et,A.width,A.height)}}r.bindRenderbuffer(r.RENDERBUFFER,null)}function wt(D,A){if(A&&A.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(e.bindFramebuffer(r.FRAMEBUFFER,D),!(A.depthTexture&&A.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let X=n.get(A.depthTexture);X.__renderTarget=A,(!X.__webglTexture||A.depthTexture.image.width!==A.width||A.depthTexture.image.height!==A.height)&&(A.depthTexture.image.width=A.width,A.depthTexture.image.height=A.height,A.depthTexture.needsUpdate=!0),z(A.depthTexture,0);let et=X.__webglTexture,Y=ut(A);if(A.depthTexture.format===xs)it(A)?a.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,r.DEPTH_ATTACHMENT,r.TEXTURE_2D,et,0,Y):r.framebufferTexture2D(r.FRAMEBUFFER,r.DEPTH_ATTACHMENT,r.TEXTURE_2D,et,0);else if(A.depthTexture.format===zs)it(A)?a.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,r.DEPTH_STENCIL_ATTACHMENT,r.TEXTURE_2D,et,0,Y):r.framebufferTexture2D(r.FRAMEBUFFER,r.DEPTH_STENCIL_ATTACHMENT,r.TEXTURE_2D,et,0);else throw new Error("Unknown depthTexture format")}function te(D){let A=n.get(D),k=D.isWebGLCubeRenderTarget===!0;if(A.__boundDepthTexture!==D.depthTexture){let X=D.depthTexture;if(A.__depthDisposeCallback&&A.__depthDisposeCallback(),X){let et=()=>{delete A.__boundDepthTexture,delete A.__depthDisposeCallback,X.removeEventListener("dispose",et)};X.addEventListener("dispose",et),A.__depthDisposeCallback=et}A.__boundDepthTexture=X}if(D.depthTexture&&!A.__autoAllocateDepthBuffer){if(k)throw new Error("target.depthTexture not supported in Cube render targets");let X=D.texture.mipmaps;X&&X.length>0?wt(A.__webglFramebuffer[0],D):wt(A.__webglFramebuffer,D)}else if(k){A.__webglDepthbuffer=[];for(let X=0;X<6;X++)if(e.bindFramebuffer(r.FRAMEBUFFER,A.__webglFramebuffer[X]),A.__webglDepthbuffer[X]===void 0)A.__webglDepthbuffer[X]=r.createRenderbuffer(),Pt(A.__webglDepthbuffer[X],D,!1);else{let et=D.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,Y=A.__webglDepthbuffer[X];r.bindRenderbuffer(r.RENDERBUFFER,Y),r.framebufferRenderbuffer(r.FRAMEBUFFER,et,r.RENDERBUFFER,Y)}}else{let X=D.texture.mipmaps;if(X&&X.length>0?e.bindFramebuffer(r.FRAMEBUFFER,A.__webglFramebuffer[0]):e.bindFramebuffer(r.FRAMEBUFFER,A.__webglFramebuffer),A.__webglDepthbuffer===void 0)A.__webglDepthbuffer=r.createRenderbuffer(),Pt(A.__webglDepthbuffer,D,!1);else{let et=D.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,Y=A.__webglDepthbuffer;r.bindRenderbuffer(r.RENDERBUFFER,Y),r.framebufferRenderbuffer(r.FRAMEBUFFER,et,r.RENDERBUFFER,Y)}}e.bindFramebuffer(r.FRAMEBUFFER,null)}function fe(D,A,k){let X=n.get(D);A!==void 0&&St(X.__webglFramebuffer,D,D.texture,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,0),k!==void 0&&te(D)}function F(D){let A=D.texture,k=n.get(D),X=n.get(A);D.addEventListener("dispose",w);let et=D.textures,Y=D.isWebGLCubeRenderTarget===!0,It=et.length>1;if(It||(X.__webglTexture===void 0&&(X.__webglTexture=r.createTexture()),X.__version=A.version,o.memory.textures++),Y){k.__webglFramebuffer=[];for(let lt=0;lt<6;lt++)if(A.mipmaps&&A.mipmaps.length>0){k.__webglFramebuffer[lt]=[];for(let Et=0;Et<A.mipmaps.length;Et++)k.__webglFramebuffer[lt][Et]=r.createFramebuffer()}else k.__webglFramebuffer[lt]=r.createFramebuffer()}else{if(A.mipmaps&&A.mipmaps.length>0){k.__webglFramebuffer=[];for(let lt=0;lt<A.mipmaps.length;lt++)k.__webglFramebuffer[lt]=r.createFramebuffer()}else k.__webglFramebuffer=r.createFramebuffer();if(It)for(let lt=0,Et=et.length;lt<Et;lt++){let Rt=n.get(et[lt]);Rt.__webglTexture===void 0&&(Rt.__webglTexture=r.createTexture(),o.memory.textures++)}if(D.samples>0&&it(D)===!1){k.__webglMultisampledFramebuffer=r.createFramebuffer(),k.__webglColorRenderbuffer=[],e.bindFramebuffer(r.FRAMEBUFFER,k.__webglMultisampledFramebuffer);for(let lt=0;lt<et.length;lt++){let Et=et[lt];k.__webglColorRenderbuffer[lt]=r.createRenderbuffer(),r.bindRenderbuffer(r.RENDERBUFFER,k.__webglColorRenderbuffer[lt]);let Rt=s.convert(Et.format,Et.colorSpace),rt=s.convert(Et.type),yt=_(Et.internalFormat,Rt,rt,Et.colorSpace,D.isXRRenderTarget===!0),zt=ut(D);r.renderbufferStorageMultisample(r.RENDERBUFFER,zt,yt,D.width,D.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+lt,r.RENDERBUFFER,k.__webglColorRenderbuffer[lt])}r.bindRenderbuffer(r.RENDERBUFFER,null),D.depthBuffer&&(k.__webglDepthRenderbuffer=r.createRenderbuffer(),Pt(k.__webglDepthRenderbuffer,D,!0)),e.bindFramebuffer(r.FRAMEBUFFER,null)}}if(Y){e.bindTexture(r.TEXTURE_CUBE_MAP,X.__webglTexture),Ht(r.TEXTURE_CUBE_MAP,A);for(let lt=0;lt<6;lt++)if(A.mipmaps&&A.mipmaps.length>0)for(let Et=0;Et<A.mipmaps.length;Et++)St(k.__webglFramebuffer[lt][Et],D,A,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+lt,Et);else St(k.__webglFramebuffer[lt],D,A,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+lt,0);p(A)&&m(r.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(It){for(let lt=0,Et=et.length;lt<Et;lt++){let Rt=et[lt],rt=n.get(Rt),yt=r.TEXTURE_2D;(D.isWebGL3DRenderTarget||D.isWebGLArrayRenderTarget)&&(yt=D.isWebGL3DRenderTarget?r.TEXTURE_3D:r.TEXTURE_2D_ARRAY),e.bindTexture(yt,rt.__webglTexture),Ht(yt,Rt),St(k.__webglFramebuffer,D,Rt,r.COLOR_ATTACHMENT0+lt,yt,0),p(Rt)&&m(yt)}e.unbindTexture()}else{let lt=r.TEXTURE_2D;if((D.isWebGL3DRenderTarget||D.isWebGLArrayRenderTarget)&&(lt=D.isWebGL3DRenderTarget?r.TEXTURE_3D:r.TEXTURE_2D_ARRAY),e.bindTexture(lt,X.__webglTexture),Ht(lt,A),A.mipmaps&&A.mipmaps.length>0)for(let Et=0;Et<A.mipmaps.length;Et++)St(k.__webglFramebuffer[Et],D,A,r.COLOR_ATTACHMENT0,lt,Et);else St(k.__webglFramebuffer,D,A,r.COLOR_ATTACHMENT0,lt,0);p(A)&&m(lt),e.unbindTexture()}D.depthBuffer&&te(D)}function nt(D){let A=D.textures;for(let k=0,X=A.length;k<X;k++){let et=A[k];if(p(et)){let Y=v(D),It=n.get(et).__webglTexture;e.bindTexture(Y,It),m(Y),e.unbindTexture()}}}let K=[],J=[];function Z(D){if(D.samples>0){if(it(D)===!1){let A=D.textures,k=D.width,X=D.height,et=r.COLOR_BUFFER_BIT,Y=D.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,It=n.get(D),lt=A.length>1;if(lt)for(let Rt=0;Rt<A.length;Rt++)e.bindFramebuffer(r.FRAMEBUFFER,It.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+Rt,r.RENDERBUFFER,null),e.bindFramebuffer(r.FRAMEBUFFER,It.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+Rt,r.TEXTURE_2D,null,0);e.bindFramebuffer(r.READ_FRAMEBUFFER,It.__webglMultisampledFramebuffer);let Et=D.texture.mipmaps;Et&&Et.length>0?e.bindFramebuffer(r.DRAW_FRAMEBUFFER,It.__webglFramebuffer[0]):e.bindFramebuffer(r.DRAW_FRAMEBUFFER,It.__webglFramebuffer);for(let Rt=0;Rt<A.length;Rt++){if(D.resolveDepthBuffer&&(D.depthBuffer&&(et|=r.DEPTH_BUFFER_BIT),D.stencilBuffer&&D.resolveStencilBuffer&&(et|=r.STENCIL_BUFFER_BIT)),lt){r.framebufferRenderbuffer(r.READ_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.RENDERBUFFER,It.__webglColorRenderbuffer[Rt]);let rt=n.get(A[Rt]).__webglTexture;r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,rt,0)}r.blitFramebuffer(0,0,k,X,0,0,k,X,et,r.NEAREST),c===!0&&(K.length=0,J.length=0,K.push(r.COLOR_ATTACHMENT0+Rt),D.depthBuffer&&D.resolveDepthBuffer===!1&&(K.push(Y),J.push(Y),r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,J)),r.invalidateFramebuffer(r.READ_FRAMEBUFFER,K))}if(e.bindFramebuffer(r.READ_FRAMEBUFFER,null),e.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),lt)for(let Rt=0;Rt<A.length;Rt++){e.bindFramebuffer(r.FRAMEBUFFER,It.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+Rt,r.RENDERBUFFER,It.__webglColorRenderbuffer[Rt]);let rt=n.get(A[Rt]).__webglTexture;e.bindFramebuffer(r.FRAMEBUFFER,It.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+Rt,r.TEXTURE_2D,rt,0)}e.bindFramebuffer(r.DRAW_FRAMEBUFFER,It.__webglMultisampledFramebuffer)}else if(D.depthBuffer&&D.resolveDepthBuffer===!1&&c){let A=D.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,[A])}}}function ut(D){return Math.min(i.maxSamples,D.samples)}function it(D){let A=n.get(D);return D.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&A.__useRenderToTexture!==!1}function ht(D){let A=o.render.frame;f.get(D)!==A&&(f.set(D,A),D.update())}function qt(D,A){let k=D.colorSpace,X=D.format,et=D.type;return D.isCompressedTexture===!0||D.isVideoTexture===!0||k!==yr&&k!==Ti&&(ie.getTransfer(k)===me?(X!==Gt||et!==on)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",k)),A}function Wt(D){return typeof HTMLImageElement<"u"&&D instanceof HTMLImageElement?(l.width=D.naturalWidth||D.width,l.height=D.naturalHeight||D.height):typeof VideoFrame<"u"&&D instanceof VideoFrame?(l.width=D.displayWidth,l.height=D.displayHeight):(l.width=D.width,l.height=D.height),l}this.allocateTextureUnit=L,this.resetTextureUnits=P,this.setTexture2D=z,this.setTexture2DArray=V,this.setTexture3D=j,this.setTextureCube=W,this.rebindTextures=fe,this.setupRenderTarget=F,this.updateRenderTargetMipmap=nt,this.updateMultisampleRenderTarget=Z,this.setupDepthRenderbuffer=te,this.setupFrameBufferTexture=St,this.useMultisampledRTT=it}function Xw(r,t){function e(n,i=Ti){let s,o=ie.getTransfer(i);if(n===on)return r.UNSIGNED_BYTE;if(n===Yl)return r.UNSIGNED_SHORT_4_4_4_4;if(n===$l)return r.UNSIGNED_SHORT_5_5_5_1;if(n===kd)return r.UNSIGNED_INT_5_9_9_9_REV;if(n===Vd)return r.UNSIGNED_INT_10F_11F_11F_REV;if(n===Bs)return r.BYTE;if(n===da)return r.SHORT;if(n===Hi)return r.UNSIGNED_SHORT;if(n===Gi)return r.INT;if(n===an)return r.UNSIGNED_INT;if(n===$t)return r.FLOAT;if(n===Ge)return r.HALF_FLOAT;if(n===Hd)return r.ALPHA;if(n===Gd)return r.RGB;if(n===Gt)return r.RGBA;if(n===xs)return r.DEPTH_COMPONENT;if(n===zs)return r.DEPTH_STENCIL;if(n===Jn)return r.RED;if(n===Dr)return r.RED_INTEGER;if(n===Fr)return r.RG;if(n===Wi)return r.RG_INTEGER;if(n===Xi)return r.RGBA_INTEGER;if(n===pa||n===ma||n===ga||n===xa)if(o===me)if(s=t.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(n===pa)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===ma)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===ga)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===xa)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=t.get("WEBGL_compressed_texture_s3tc"),s!==null){if(n===pa)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===ma)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===ga)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===xa)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===Zl||n===Jl||n===Kl||n===Ql)if(s=t.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(n===Zl)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===Jl)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===Kl)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===Ql)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===jl||n===tu||n===eu)if(s=t.get("WEBGL_compressed_texture_etc"),s!==null){if(n===jl||n===tu)return o===me?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(n===eu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===nu||n===iu||n===ru||n===su||n===ou||n===au||n===cu||n===lu||n===uu||n===hu||n===fu||n===du||n===pu||n===mu)if(s=t.get("WEBGL_compressed_texture_astc"),s!==null){if(n===nu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===iu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===ru)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===su)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===ou)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===au)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===cu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===lu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===uu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===hu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===fu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===du)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===pu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===mu)return o===me?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===gu||n===xu||n===vu)if(s=t.get("EXT_texture_compression_bptc"),s!==null){if(n===gu)return o===me?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===xu)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===vu)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===_u||n===yu||n===bu||n===Su)if(s=t.get("EXT_texture_compression_rgtc"),s!==null){if(n===_u)return s.COMPRESSED_RED_RGTC1_EXT;if(n===yu)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===bu)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Su)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Os?r.UNSIGNED_INT_24_8:r[n]!==void 0?r[n]:null}return{convert:e}}var qw=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Yw=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,fp=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e){if(this.texture===null){let n=new zo(t.texture);(t.depthNear!==e.depthNear||t.depthFar!==e.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=n}}getMesh(t){if(this.texture!==null&&this.mesh===null){let e=t.cameras[0].viewport,n=new Ue({vertexShader:qw,fragmentShader:Yw,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new Me(new Ps(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},dp=class extends On{constructor(t,e){super();let n=this,i=null,s=1,o=null,a="local-floor",c=1,l=null,f=null,h=null,u=null,d=null,g=null,x=typeof XRWebGLBinding<"u",p=new fp,m={},v=e.getContextAttributes(),_=null,y=null,b=[],T=[],w=new q,E=null,M=new Re;M.viewport=new Kt;let S=new Re;S.viewport=new Kt;let I=[M,S],P=new Nl,L=null,N=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function($){let tt=b[$];return tt===void 0&&(tt=new Ts,b[$]=tt),tt.getTargetRaySpace()},this.getControllerGrip=function($){let tt=b[$];return tt===void 0&&(tt=new Ts,b[$]=tt),tt.getGripSpace()},this.getHand=function($){let tt=b[$];return tt===void 0&&(tt=new Ts,b[$]=tt),tt.getHandSpace()};function z($){let tt=T.indexOf($.inputSource);if(tt===-1)return;let St=b[tt];St!==void 0&&(St.update($.inputSource,$.frame,l||o),St.dispatchEvent({type:$.type,data:$.inputSource}))}function V(){i.removeEventListener("select",z),i.removeEventListener("selectstart",z),i.removeEventListener("selectend",z),i.removeEventListener("squeeze",z),i.removeEventListener("squeezestart",z),i.removeEventListener("squeezeend",z),i.removeEventListener("end",V),i.removeEventListener("inputsourceschange",j);for(let $=0;$<b.length;$++){let tt=T[$];tt!==null&&(T[$]=null,b[$].disconnect(tt))}L=null,N=null,p.reset();for(let $ in m)delete m[$];t.setRenderTarget(_),d=null,u=null,h=null,i=null,y=null,Qt.stop(),n.isPresenting=!1,t.setPixelRatio(E),t.setSize(w.width,w.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function($){s=$,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function($){a=$,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return l||o},this.setReferenceSpace=function($){l=$},this.getBaseLayer=function(){return u!==null?u:d},this.getBinding=function(){return h===null&&x&&(h=new XRWebGLBinding(i,e)),h},this.getFrame=function(){return g},this.getSession=function(){return i},this.setSession=async function($){if(i=$,i!==null){if(_=t.getRenderTarget(),i.addEventListener("select",z),i.addEventListener("selectstart",z),i.addEventListener("selectend",z),i.addEventListener("squeeze",z),i.addEventListener("squeezestart",z),i.addEventListener("squeezeend",z),i.addEventListener("end",V),i.addEventListener("inputsourceschange",j),v.xrCompatible!==!0&&await e.makeXRCompatible(),E=t.getPixelRatio(),t.getSize(w),x&&"createProjectionLayer"in XRWebGLBinding.prototype){let St=null,Pt=null,wt=null;v.depth&&(wt=v.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,St=v.stencil?zs:xs,Pt=v.stencil?Os:an);let te={colorFormat:e.RGBA8,depthFormat:wt,scaleFactor:s};h=this.getBinding(),u=h.createProjectionLayer(te),i.updateRenderState({layers:[u]}),t.setPixelRatio(1),t.setSize(u.textureWidth,u.textureHeight,!1),y=new ze(u.textureWidth,u.textureHeight,{format:Gt,type:on,depthTexture:new Oo(u.textureWidth,u.textureHeight,Pt,void 0,void 0,void 0,void 0,void 0,void 0,St),stencilBuffer:v.stencil,colorSpace:t.outputColorSpace,samples:v.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1,resolveStencilBuffer:u.ignoreDepthValues===!1})}else{let St={antialias:v.antialias,alpha:!0,depth:v.depth,stencil:v.stencil,framebufferScaleFactor:s};d=new XRWebGLLayer(i,e,St),i.updateRenderState({baseLayer:d}),t.setPixelRatio(1),t.setSize(d.framebufferWidth,d.framebufferHeight,!1),y=new ze(d.framebufferWidth,d.framebufferHeight,{format:Gt,type:on,colorSpace:t.outputColorSpace,stencilBuffer:v.stencil,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(c),l=null,o=await i.requestReferenceSpace(a),Qt.setContext(i),Qt.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return p.getDepthTexture()};function j($){for(let tt=0;tt<$.removed.length;tt++){let St=$.removed[tt],Pt=T.indexOf(St);Pt>=0&&(T[Pt]=null,b[Pt].disconnect(St))}for(let tt=0;tt<$.added.length;tt++){let St=$.added[tt],Pt=T.indexOf(St);if(Pt===-1){for(let te=0;te<b.length;te++)if(te>=T.length){T.push(St),Pt=te;break}else if(T[te]===null){T[te]=St,Pt=te;break}if(Pt===-1)break}let wt=b[Pt];wt&&wt.connect(St)}}let W=new R,ct=new R;function pt($,tt,St){W.setFromMatrixPosition(tt.matrixWorld),ct.setFromMatrixPosition(St.matrixWorld);let Pt=W.distanceTo(ct),wt=tt.projectionMatrix.elements,te=St.projectionMatrix.elements,fe=wt[14]/(wt[10]-1),F=wt[14]/(wt[10]+1),nt=(wt[9]+1)/wt[5],K=(wt[9]-1)/wt[5],J=(wt[8]-1)/wt[0],Z=(te[8]+1)/te[0],ut=fe*J,it=fe*Z,ht=Pt/(-J+Z),qt=ht*-J;if(tt.matrixWorld.decompose($.position,$.quaternion,$.scale),$.translateX(qt),$.translateZ(ht),$.matrixWorld.compose($.position,$.quaternion,$.scale),$.matrixWorldInverse.copy($.matrixWorld).invert(),wt[10]===-1)$.projectionMatrix.copy(tt.projectionMatrix),$.projectionMatrixInverse.copy(tt.projectionMatrixInverse);else{let Wt=fe+ht,D=F+ht,A=ut-qt,k=it+(Pt-qt),X=nt*F/D*Wt,et=K*F/D*Wt;$.projectionMatrix.makePerspective(A,k,X,et,Wt,D),$.projectionMatrixInverse.copy($.projectionMatrix).invert()}}function _t($,tt){tt===null?$.matrixWorld.copy($.matrix):$.matrixWorld.multiplyMatrices(tt.matrixWorld,$.matrix),$.matrixWorldInverse.copy($.matrixWorld).invert()}this.updateCamera=function($){if(i===null)return;let tt=$.near,St=$.far;p.texture!==null&&(p.depthNear>0&&(tt=p.depthNear),p.depthFar>0&&(St=p.depthFar)),P.near=S.near=M.near=tt,P.far=S.far=M.far=St,(L!==P.near||N!==P.far)&&(i.updateRenderState({depthNear:P.near,depthFar:P.far}),L=P.near,N=P.far),P.layers.mask=$.layers.mask|6,M.layers.mask=P.layers.mask&3,S.layers.mask=P.layers.mask&5;let Pt=$.parent,wt=P.cameras;_t(P,Pt);for(let te=0;te<wt.length;te++)_t(wt[te],Pt);wt.length===2?pt(P,M,S):P.projectionMatrix.copy(M.projectionMatrix),Ht($,P,Pt)};function Ht($,tt,St){St===null?$.matrix.copy(tt.matrixWorld):($.matrix.copy(St.matrixWorld),$.matrix.invert(),$.matrix.multiply(tt.matrixWorld)),$.matrix.decompose($.position,$.quaternion,$.scale),$.updateMatrixWorld(!0),$.projectionMatrix.copy(tt.projectionMatrix),$.projectionMatrixInverse.copy(tt.projectionMatrixInverse),$.isPerspectiveCamera&&($.fov=br*2*Math.atan(1/$.projectionMatrix.elements[5]),$.zoom=1)}this.getCamera=function(){return P},this.getFoveation=function(){if(!(u===null&&d===null))return c},this.setFoveation=function($){c=$,u!==null&&(u.fixedFoveation=$),d!==null&&d.fixedFoveation!==void 0&&(d.fixedFoveation=$)},this.hasDepthSensing=function(){return p.texture!==null},this.getDepthSensingMesh=function(){return p.getMesh(P)},this.getCameraTexture=function($){return m[$]};let ee=null;function he($,tt){if(f=tt.getViewerPose(l||o),g=tt,f!==null){let St=f.views;d!==null&&(t.setRenderTargetFramebuffer(y,d.framebuffer),t.setRenderTarget(y));let Pt=!1;St.length!==P.cameras.length&&(P.cameras.length=0,Pt=!0);for(let F=0;F<St.length;F++){let nt=St[F],K=null;if(d!==null)K=d.getViewport(nt);else{let Z=h.getViewSubImage(u,nt);K=Z.viewport,F===0&&(t.setRenderTargetTextures(y,Z.colorTexture,Z.depthStencilTexture),t.setRenderTarget(y))}let J=I[F];J===void 0&&(J=new Re,J.layers.enable(F),J.viewport=new Kt,I[F]=J),J.matrix.fromArray(nt.transform.matrix),J.matrix.decompose(J.position,J.quaternion,J.scale),J.projectionMatrix.fromArray(nt.projectionMatrix),J.projectionMatrixInverse.copy(J.projectionMatrix).invert(),J.viewport.set(K.x,K.y,K.width,K.height),F===0&&(P.matrix.copy(J.matrix),P.matrix.decompose(P.position,P.quaternion,P.scale)),Pt===!0&&P.cameras.push(J)}let wt=i.enabledFeatures;if(wt&&wt.includes("depth-sensing")&&i.depthUsage=="gpu-optimized"&&x){h=n.getBinding();let F=h.getDepthInformation(St[0]);F&&F.isValid&&F.texture&&p.init(F,i.renderState)}if(wt&&wt.includes("camera-access")&&x){t.state.unbindTexture(),h=n.getBinding();for(let F=0;F<St.length;F++){let nt=St[F].camera;if(nt){let K=m[nt];K||(K=new zo,m[nt]=K);let J=h.getCameraImage(nt);K.sourceTexture=J}}}}for(let St=0;St<b.length;St++){let Pt=T[St],wt=b[St];Pt!==null&&wt!==void 0&&wt.update(Pt,tt,l||o)}ee&&ee($,tt),tt.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:tt}),g=null}let Qt=new H0;Qt.setAnimationLoop(he),this.setAnimationLoop=function($){ee=$},this.dispose=function(){}}},Ur=new In,$w=new gt;function Zw(r,t){function e(p,m){p.matrixAutoUpdate===!0&&p.updateMatrix(),m.value.copy(p.matrix)}function n(p,m){m.color.getRGB(p.fogColor.value,Zd(r)),m.isFog?(p.fogNear.value=m.near,p.fogFar.value=m.far):m.isFogExp2&&(p.fogDensity.value=m.density)}function i(p,m,v,_,y){m.isMeshBasicMaterial||m.isMeshLambertMaterial?s(p,m):m.isMeshToonMaterial?(s(p,m),h(p,m)):m.isMeshPhongMaterial?(s(p,m),f(p,m)):m.isMeshStandardMaterial?(s(p,m),u(p,m),m.isMeshPhysicalMaterial&&d(p,m,y)):m.isMeshMatcapMaterial?(s(p,m),g(p,m)):m.isMeshDepthMaterial?s(p,m):m.isMeshDistanceMaterial?(s(p,m),x(p,m)):m.isMeshNormalMaterial?s(p,m):m.isLineBasicMaterial?(o(p,m),m.isLineDashedMaterial&&a(p,m)):m.isPointsMaterial?c(p,m,v,_):m.isSpriteMaterial?l(p,m):m.isShadowMaterial?(p.color.value.copy(m.color),p.opacity.value=m.opacity):m.isShaderMaterial&&(m.uniformsNeedUpdate=!1)}function s(p,m){p.opacity.value=m.opacity,m.color&&p.diffuse.value.copy(m.color),m.emissive&&p.emissive.value.copy(m.emissive).multiplyScalar(m.emissiveIntensity),m.map&&(p.map.value=m.map,e(m.map,p.mapTransform)),m.alphaMap&&(p.alphaMap.value=m.alphaMap,e(m.alphaMap,p.alphaMapTransform)),m.bumpMap&&(p.bumpMap.value=m.bumpMap,e(m.bumpMap,p.bumpMapTransform),p.bumpScale.value=m.bumpScale,m.side===He&&(p.bumpScale.value*=-1)),m.normalMap&&(p.normalMap.value=m.normalMap,e(m.normalMap,p.normalMapTransform),p.normalScale.value.copy(m.normalScale),m.side===He&&p.normalScale.value.negate()),m.displacementMap&&(p.displacementMap.value=m.displacementMap,e(m.displacementMap,p.displacementMapTransform),p.displacementScale.value=m.displacementScale,p.displacementBias.value=m.displacementBias),m.emissiveMap&&(p.emissiveMap.value=m.emissiveMap,e(m.emissiveMap,p.emissiveMapTransform)),m.specularMap&&(p.specularMap.value=m.specularMap,e(m.specularMap,p.specularMapTransform)),m.alphaTest>0&&(p.alphaTest.value=m.alphaTest);let v=t.get(m),_=v.envMap,y=v.envMapRotation;_&&(p.envMap.value=_,Ur.copy(y),Ur.x*=-1,Ur.y*=-1,Ur.z*=-1,_.isCubeTexture&&_.isRenderTargetTexture===!1&&(Ur.y*=-1,Ur.z*=-1),p.envMapRotation.value.setFromMatrix4($w.makeRotationFromEuler(Ur)),p.flipEnvMap.value=_.isCubeTexture&&_.isRenderTargetTexture===!1?-1:1,p.reflectivity.value=m.reflectivity,p.ior.value=m.ior,p.refractionRatio.value=m.refractionRatio),m.lightMap&&(p.lightMap.value=m.lightMap,p.lightMapIntensity.value=m.lightMapIntensity,e(m.lightMap,p.lightMapTransform)),m.aoMap&&(p.aoMap.value=m.aoMap,p.aoMapIntensity.value=m.aoMapIntensity,e(m.aoMap,p.aoMapTransform))}function o(p,m){p.diffuse.value.copy(m.color),p.opacity.value=m.opacity,m.map&&(p.map.value=m.map,e(m.map,p.mapTransform))}function a(p,m){p.dashSize.value=m.dashSize,p.totalSize.value=m.dashSize+m.gapSize,p.scale.value=m.scale}function c(p,m,v,_){p.diffuse.value.copy(m.color),p.opacity.value=m.opacity,p.size.value=m.size*v,p.scale.value=_*.5,m.map&&(p.map.value=m.map,e(m.map,p.uvTransform)),m.alphaMap&&(p.alphaMap.value=m.alphaMap,e(m.alphaMap,p.alphaMapTransform)),m.alphaTest>0&&(p.alphaTest.value=m.alphaTest)}function l(p,m){p.diffuse.value.copy(m.color),p.opacity.value=m.opacity,p.rotation.value=m.rotation,m.map&&(p.map.value=m.map,e(m.map,p.mapTransform)),m.alphaMap&&(p.alphaMap.value=m.alphaMap,e(m.alphaMap,p.alphaMapTransform)),m.alphaTest>0&&(p.alphaTest.value=m.alphaTest)}function f(p,m){p.specular.value.copy(m.specular),p.shininess.value=Math.max(m.shininess,1e-4)}function h(p,m){m.gradientMap&&(p.gradientMap.value=m.gradientMap)}function u(p,m){p.metalness.value=m.metalness,m.metalnessMap&&(p.metalnessMap.value=m.metalnessMap,e(m.metalnessMap,p.metalnessMapTransform)),p.roughness.value=m.roughness,m.roughnessMap&&(p.roughnessMap.value=m.roughnessMap,e(m.roughnessMap,p.roughnessMapTransform)),m.envMap&&(p.envMapIntensity.value=m.envMapIntensity)}function d(p,m,v){p.ior.value=m.ior,m.sheen>0&&(p.sheenColor.value.copy(m.sheenColor).multiplyScalar(m.sheen),p.sheenRoughness.value=m.sheenRoughness,m.sheenColorMap&&(p.sheenColorMap.value=m.sheenColorMap,e(m.sheenColorMap,p.sheenColorMapTransform)),m.sheenRoughnessMap&&(p.sheenRoughnessMap.value=m.sheenRoughnessMap,e(m.sheenRoughnessMap,p.sheenRoughnessMapTransform))),m.clearcoat>0&&(p.clearcoat.value=m.clearcoat,p.clearcoatRoughness.value=m.clearcoatRoughness,m.clearcoatMap&&(p.clearcoatMap.value=m.clearcoatMap,e(m.clearcoatMap,p.clearcoatMapTransform)),m.clearcoatRoughnessMap&&(p.clearcoatRoughnessMap.value=m.clearcoatRoughnessMap,e(m.clearcoatRoughnessMap,p.clearcoatRoughnessMapTransform)),m.clearcoatNormalMap&&(p.clearcoatNormalMap.value=m.clearcoatNormalMap,e(m.clearcoatNormalMap,p.clearcoatNormalMapTransform),p.clearcoatNormalScale.value.copy(m.clearcoatNormalScale),m.side===He&&p.clearcoatNormalScale.value.negate())),m.dispersion>0&&(p.dispersion.value=m.dispersion),m.iridescence>0&&(p.iridescence.value=m.iridescence,p.iridescenceIOR.value=m.iridescenceIOR,p.iridescenceThicknessMinimum.value=m.iridescenceThicknessRange[0],p.iridescenceThicknessMaximum.value=m.iridescenceThicknessRange[1],m.iridescenceMap&&(p.iridescenceMap.value=m.iridescenceMap,e(m.iridescenceMap,p.iridescenceMapTransform)),m.iridescenceThicknessMap&&(p.iridescenceThicknessMap.value=m.iridescenceThicknessMap,e(m.iridescenceThicknessMap,p.iridescenceThicknessMapTransform))),m.transmission>0&&(p.transmission.value=m.transmission,p.transmissionSamplerMap.value=v.texture,p.transmissionSamplerSize.value.set(v.width,v.height),m.transmissionMap&&(p.transmissionMap.value=m.transmissionMap,e(m.transmissionMap,p.transmissionMapTransform)),p.thickness.value=m.thickness,m.thicknessMap&&(p.thicknessMap.value=m.thicknessMap,e(m.thicknessMap,p.thicknessMapTransform)),p.attenuationDistance.value=m.attenuationDistance,p.attenuationColor.value.copy(m.attenuationColor)),m.anisotropy>0&&(p.anisotropyVector.value.set(m.anisotropy*Math.cos(m.anisotropyRotation),m.anisotropy*Math.sin(m.anisotropyRotation)),m.anisotropyMap&&(p.anisotropyMap.value=m.anisotropyMap,e(m.anisotropyMap,p.anisotropyMapTransform))),p.specularIntensity.value=m.specularIntensity,p.specularColor.value.copy(m.specularColor),m.specularColorMap&&(p.specularColorMap.value=m.specularColorMap,e(m.specularColorMap,p.specularColorMapTransform)),m.specularIntensityMap&&(p.specularIntensityMap.value=m.specularIntensityMap,e(m.specularIntensityMap,p.specularIntensityMapTransform))}function g(p,m){m.matcap&&(p.matcap.value=m.matcap)}function x(p,m){let v=t.get(m).light;p.referencePosition.value.setFromMatrixPosition(v.matrixWorld),p.nearDistance.value=v.shadow.camera.near,p.farDistance.value=v.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:i}}function Jw(r,t,e,n){let i={},s={},o=[],a=r.getParameter(r.MAX_UNIFORM_BUFFER_BINDINGS);function c(v,_){let y=_.program;n.uniformBlockBinding(v,y)}function l(v,_){let y=i[v.id];y===void 0&&(g(v),y=f(v),i[v.id]=y,v.addEventListener("dispose",p));let b=_.program;n.updateUBOMapping(v,b);let T=t.render.frame;s[v.id]!==T&&(u(v),s[v.id]=T)}function f(v){let _=h();v.__bindingPointIndex=_;let y=r.createBuffer(),b=v.__size,T=v.usage;return r.bindBuffer(r.UNIFORM_BUFFER,y),r.bufferData(r.UNIFORM_BUFFER,b,T),r.bindBuffer(r.UNIFORM_BUFFER,null),r.bindBufferBase(r.UNIFORM_BUFFER,_,y),y}function h(){for(let v=0;v<a;v++)if(o.indexOf(v)===-1)return o.push(v),v;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function u(v){let _=i[v.id],y=v.uniforms,b=v.__cache;r.bindBuffer(r.UNIFORM_BUFFER,_);for(let T=0,w=y.length;T<w;T++){let E=Array.isArray(y[T])?y[T]:[y[T]];for(let M=0,S=E.length;M<S;M++){let I=E[M];if(d(I,T,M,b)===!0){let P=I.__offset,L=Array.isArray(I.value)?I.value:[I.value],N=0;for(let z=0;z<L.length;z++){let V=L[z],j=x(V);typeof V=="number"||typeof V=="boolean"?(I.__data[0]=V,r.bufferSubData(r.UNIFORM_BUFFER,P+N,I.__data)):V.isMatrix3?(I.__data[0]=V.elements[0],I.__data[1]=V.elements[1],I.__data[2]=V.elements[2],I.__data[3]=0,I.__data[4]=V.elements[3],I.__data[5]=V.elements[4],I.__data[6]=V.elements[5],I.__data[7]=0,I.__data[8]=V.elements[6],I.__data[9]=V.elements[7],I.__data[10]=V.elements[8],I.__data[11]=0):(V.toArray(I.__data,N),N+=j.storage/Float32Array.BYTES_PER_ELEMENT)}r.bufferSubData(r.UNIFORM_BUFFER,P,I.__data)}}}r.bindBuffer(r.UNIFORM_BUFFER,null)}function d(v,_,y,b){let T=v.value,w=_+"_"+y;if(b[w]===void 0)return typeof T=="number"||typeof T=="boolean"?b[w]=T:b[w]=T.clone(),!0;{let E=b[w];if(typeof T=="number"||typeof T=="boolean"){if(E!==T)return b[w]=T,!0}else if(E.equals(T)===!1)return E.copy(T),!0}return!1}function g(v){let _=v.uniforms,y=0,b=16;for(let w=0,E=_.length;w<E;w++){let M=Array.isArray(_[w])?_[w]:[_[w]];for(let S=0,I=M.length;S<I;S++){let P=M[S],L=Array.isArray(P.value)?P.value:[P.value];for(let N=0,z=L.length;N<z;N++){let V=L[N],j=x(V),W=y%b,ct=W%j.boundary,pt=W+ct;y+=ct,pt!==0&&b-pt<j.storage&&(y+=b-pt),P.__data=new Float32Array(j.storage/Float32Array.BYTES_PER_ELEMENT),P.__offset=y,y+=j.storage}}}let T=y%b;return T>0&&(y+=b-T),v.__size=y,v.__cache={},this}function x(v){let _={boundary:0,storage:0};return typeof v=="number"||typeof v=="boolean"?(_.boundary=4,_.storage=4):v.isVector2?(_.boundary=8,_.storage=8):v.isVector3||v.isColor?(_.boundary=16,_.storage=12):v.isVector4?(_.boundary=16,_.storage=16):v.isMatrix3?(_.boundary=48,_.storage=48):v.isMatrix4?(_.boundary=64,_.storage=64):v.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",v),_}function p(v){let _=v.target;_.removeEventListener("dispose",p);let y=o.indexOf(_.__bindingPointIndex);o.splice(y,1),r.deleteBuffer(i[_.id]),delete i[_.id],delete s[_.id]}function m(){for(let v in i)r.deleteBuffer(i[v]);o=[],i={},s={}}return{bind:c,update:l,dispose:m}}var V0=class{constructor(t={}){let{canvas:e=s0(),context:n=null,depth:i=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:c=!0,preserveDrawingBuffer:l=!1,powerPreference:f="default",failIfMajorPerformanceCaveat:h=!1,reversedDepthBuffer:u=!1}=t;this.isWebGLRenderer=!0;let d;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");d=n.getContextAttributes().alpha}else d=o;let g=new Uint32Array(4),x=new Int32Array(4),p=null,m=null,v=[],_=[];this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Zn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let y=this,b=!1;this._outputColorSpace=vn;let T=0,w=0,E=null,M=-1,S=null,I=new Kt,P=new Kt,L=null,N=new ft(0),z=0,V=e.width,j=e.height,W=1,ct=null,pt=null,_t=new Kt(0,0,V,j),Ht=new Kt(0,0,V,j),ee=!1,he=new Oi,Qt=!1,$=!1,tt=new gt,St=new R,Pt=new Kt,wt={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},te=!1;function fe(){return E===null?W:1}let F=n;function nt(C,B){return e.getContext(C,B)}try{let C={alpha:!0,depth:i,stencil:s,antialias:a,premultipliedAlpha:c,preserveDrawingBuffer:l,powerPreference:f,failIfMajorPerformanceCaveat:h};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${"180"}`),e.addEventListener("webglcontextlost",dt,!1),e.addEventListener("webglcontextrestored",Tt,!1),e.addEventListener("webglcontextcreationerror",st,!1),F===null){let B="webgl2";if(F=nt(B,C),F===null)throw nt(B)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(C){throw console.error("THREE.WebGLRenderer: "+C.message),C}let K,J,Z,ut,it,ht,qt,Wt,D,A,k,X,et,Y,It,lt,Et,Rt,rt,yt,zt,Dt,xt,Jt;function U(){K=new pT(F),K.init(),Dt=new Xw(F,K),J=new aT(F,K,t,Dt),Z=new Gw(F,K),J.reversedDepthBuffer&&u&&Z.buffers.depth.setReversed(!0),ut=new xT(F),it=new Iw,ht=new Ww(F,K,Z,it,J,Dt,ut),qt=new lT(y),Wt=new dT(y),D=new Mb(F),xt=new sT(F,D),A=new mT(F,D,ut,xt),k=new _T(F,A,D,ut),rt=new vT(F,J,ht),lt=new cT(it),X=new Cw(y,qt,Wt,K,J,xt,lt),et=new Zw(y,it),Y=new Dw,It=new Ow(K),Rt=new rT(y,qt,Wt,Z,k,d,c),Et=new Vw(y,k,J),Jt=new Jw(F,ut,J,Z),yt=new oT(F,K,ut),zt=new gT(F,K,ut),ut.programs=X.programs,y.capabilities=J,y.extensions=K,y.properties=it,y.renderLists=Y,y.shadowMap=Et,y.state=Z,y.info=ut}U();let at=new dp(y,F);this.xr=at,this.getContext=function(){return F},this.getContextAttributes=function(){return F.getContextAttributes()},this.forceContextLoss=function(){let C=K.get("WEBGL_lose_context");C&&C.loseContext()},this.forceContextRestore=function(){let C=K.get("WEBGL_lose_context");C&&C.restoreContext()},this.getPixelRatio=function(){return W},this.setPixelRatio=function(C){C!==void 0&&(W=C,this.setSize(V,j,!1))},this.getSize=function(C){return C.set(V,j)},this.setSize=function(C,B,H=!0){if(at.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}V=C,j=B,e.width=Math.floor(C*W),e.height=Math.floor(B*W),H===!0&&(e.style.width=C+"px",e.style.height=B+"px"),this.setViewport(0,0,C,B)},this.getDrawingBufferSize=function(C){return C.set(V*W,j*W).floor()},this.setDrawingBufferSize=function(C,B,H){V=C,j=B,W=H,e.width=Math.floor(C*H),e.height=Math.floor(B*H),this.setViewport(0,0,C,B)},this.getCurrentViewport=function(C){return C.copy(I)},this.getViewport=function(C){return C.copy(_t)},this.setViewport=function(C,B,H,G){C.isVector4?_t.set(C.x,C.y,C.z,C.w):_t.set(C,B,H,G),Z.viewport(I.copy(_t).multiplyScalar(W).round())},this.getScissor=function(C){return C.copy(Ht)},this.setScissor=function(C,B,H,G){C.isVector4?Ht.set(C.x,C.y,C.z,C.w):Ht.set(C,B,H,G),Z.scissor(P.copy(Ht).multiplyScalar(W).round())},this.getScissorTest=function(){return ee},this.setScissorTest=function(C){Z.setScissorTest(ee=C)},this.setOpaqueSort=function(C){ct=C},this.setTransparentSort=function(C){pt=C},this.getClearColor=function(C){return C.copy(Rt.getClearColor())},this.setClearColor=function(){Rt.setClearColor(...arguments)},this.getClearAlpha=function(){return Rt.getClearAlpha()},this.setClearAlpha=function(){Rt.setClearAlpha(...arguments)},this.clear=function(C=!0,B=!0,H=!0){let G=0;if(C){let O=!1;if(E!==null){let ot=E.texture.format;O=ot===Xi||ot===Wi||ot===Dr}if(O){let ot=E.texture.type,vt=ot===on||ot===an||ot===Hi||ot===Os||ot===Yl||ot===$l,At=Rt.getClearColor(),Mt=Rt.getClearAlpha(),Ut=At.r,kt=At.g,Lt=At.b;vt?(g[0]=Ut,g[1]=kt,g[2]=Lt,g[3]=Mt,F.clearBufferuiv(F.COLOR,0,g)):(x[0]=Ut,x[1]=kt,x[2]=Lt,x[3]=Mt,F.clearBufferiv(F.COLOR,0,x))}else G|=F.COLOR_BUFFER_BIT}B&&(G|=F.DEPTH_BUFFER_BIT),H&&(G|=F.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),F.clear(G)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){e.removeEventListener("webglcontextlost",dt,!1),e.removeEventListener("webglcontextrestored",Tt,!1),e.removeEventListener("webglcontextcreationerror",st,!1),Rt.dispose(),Y.dispose(),It.dispose(),it.dispose(),qt.dispose(),Wt.dispose(),k.dispose(),xt.dispose(),Jt.dispose(),X.dispose(),at.dispose(),at.removeEventListener("sessionstart",jn),at.removeEventListener("sessionend",nm),tr.stop()};function dt(C){C.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),b=!0}function Tt(){console.log("THREE.WebGLRenderer: Context Restored."),b=!1;let C=ut.autoReset,B=Et.enabled,H=Et.autoUpdate,G=Et.needsUpdate,O=Et.type;U(),ut.autoReset=C,Et.enabled=B,Et.autoUpdate=H,Et.needsUpdate=G,Et.type=O}function st(C){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",C.statusMessage)}function Q(C){let B=C.target;B.removeEventListener("dispose",Q),Ct(B)}function Ct(C){Yt(C),it.remove(C)}function Yt(C){let B=it.get(C).programs;B!==void 0&&(B.forEach(function(H){X.releaseProgram(H)}),C.isShaderMaterial&&X.releaseShaderCache(C))}this.renderBufferDirect=function(C,B,H,G,O,ot){B===null&&(B=wt);let vt=O.isMesh&&O.matrixWorld.determinant()<0,At=Bv(C,B,H,G,O);Z.setMaterial(G,vt);let Mt=H.index,Ut=1;if(G.wireframe===!0){if(Mt=A.getWireframeAttribute(H),Mt===void 0)return;Ut=2}let kt=H.drawRange,Lt=H.attributes.position,ne=kt.start*Ut,ge=(kt.start+kt.count)*Ut;ot!==null&&(ne=Math.max(ne,ot.start*Ut),ge=Math.min(ge,(ot.start+ot.count)*Ut)),Mt!==null?(ne=Math.max(ne,0),ge=Math.min(ge,Mt.count)):Lt!=null&&(ne=Math.max(ne,0),ge=Math.min(ge,Lt.count));let Pe=ge-ne;if(Pe<0||Pe===1/0)return;xt.setup(O,G,At,H,Mt);let Te,_e=yt;if(Mt!==null&&(Te=D.get(Mt),_e=zt,_e.setIndex(Te)),O.isMesh)G.wireframe===!0?(Z.setLineWidth(G.wireframeLinewidth*fe()),_e.setMode(F.LINES)):_e.setMode(F.TRIANGLES);else if(O.isLine){let Nt=G.linewidth;Nt===void 0&&(Nt=1),Z.setLineWidth(Nt*fe()),O.isLineSegments?_e.setMode(F.LINES):O.isLineLoop?_e.setMode(F.LINE_LOOP):_e.setMode(F.LINE_STRIP)}else O.isPoints?_e.setMode(F.POINTS):O.isSprite&&_e.setMode(F.TRIANGLES);if(O.isBatchedMesh)if(O._multiDrawInstances!==null)ys("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),_e.renderMultiDrawInstances(O._multiDrawStarts,O._multiDrawCounts,O._multiDrawCount,O._multiDrawInstances);else if(K.get("WEBGL_multi_draw"))_e.renderMultiDraw(O._multiDrawStarts,O._multiDrawCounts,O._multiDrawCount);else{let Nt=O._multiDrawStarts,Ae=O._multiDrawCounts,ce=O._multiDrawCount,Tn=Mt?D.get(Mt).bytesPerElement:1,$r=it.get(G).currentProgram.getUniforms();for(let wn=0;wn<ce;wn++)$r.setValue(F,"_gl_DrawID",wn),_e.render(Nt[wn]/Tn,Ae[wn])}else if(O.isInstancedMesh)_e.renderInstances(ne,Pe,O.count);else if(H.isInstancedBufferGeometry){let Nt=H._maxInstanceCount!==void 0?H._maxInstanceCount:1/0,Ae=Math.min(H.instanceCount,Nt);_e.renderInstances(ne,Pe,Ae)}else _e.render(ne,Pe)};function Se(C,B,H){C.transparent===!0&&C.side===Sn&&C.forceSinglePass===!1?(C.side=He,C.needsUpdate=!0,Oa(C,B,H),C.side=yn,C.needsUpdate=!0,Oa(C,B,H),C.side=Sn):Oa(C,B,H)}this.compile=function(C,B,H=null){H===null&&(H=C),m=It.get(H),m.init(B),_.push(m),H.traverseVisible(function(O){O.isLight&&O.layers.test(B.layers)&&(m.pushLight(O),O.castShadow&&m.pushShadow(O))}),C!==H&&C.traverseVisible(function(O){O.isLight&&O.layers.test(B.layers)&&(m.pushLight(O),O.castShadow&&m.pushShadow(O))}),m.setupLights();let G=new Set;return C.traverse(function(O){if(!(O.isMesh||O.isPoints||O.isLine||O.isSprite))return;let ot=O.material;if(ot)if(Array.isArray(ot))for(let vt=0;vt<ot.length;vt++){let At=ot[vt];Se(At,H,O),G.add(At)}else Se(ot,H,O),G.add(ot)}),m=_.pop(),G},this.compileAsync=function(C,B,H=null){let G=this.compile(C,B,H);return new Promise(O=>{function ot(){if(G.forEach(function(vt){it.get(vt).currentProgram.isReady()&&G.delete(vt)}),G.size===0){O(C);return}setTimeout(ot,10)}K.get("KHR_parallel_shader_compile")!==null?ot():setTimeout(ot,10)})};let de=null;function ui(C){de&&de(C)}function jn(){tr.stop()}function nm(){tr.start()}let tr=new H0;tr.setAnimationLoop(ui),typeof self<"u"&&tr.setContext(self),this.setAnimationLoop=function(C){de=C,at.setAnimationLoop(C),C===null?tr.stop():tr.start()},at.addEventListener("sessionstart",jn),at.addEventListener("sessionend",nm),this.render=function(C,B){if(B!==void 0&&B.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(b===!0)return;if(C.matrixWorldAutoUpdate===!0&&C.updateMatrixWorld(),B.parent===null&&B.matrixWorldAutoUpdate===!0&&B.updateMatrixWorld(),at.enabled===!0&&at.isPresenting===!0&&(at.cameraAutoUpdate===!0&&at.updateCamera(B),B=at.getCamera()),C.isScene===!0&&C.onBeforeRender(y,C,B,E),m=It.get(C,_.length),m.init(B),_.push(m),tt.multiplyMatrices(B.projectionMatrix,B.matrixWorldInverse),he.setFromProjectionMatrix(tt,Rn,B.reversedDepth),$=this.localClippingEnabled,Qt=lt.init(this.clippingPlanes,$),p=Y.get(C,v.length),p.init(),v.push(p),at.enabled===!0&&at.isPresenting===!0){let ot=y.xr.getDepthSensingMesh();ot!==null&&Lh(ot,B,-1/0,y.sortObjects)}Lh(C,B,0,y.sortObjects),p.finish(),y.sortObjects===!0&&p.sort(ct,pt),te=at.enabled===!1||at.isPresenting===!1||at.hasDepthSensing()===!1,te&&Rt.addToRenderList(p,C),this.info.render.frame++,Qt===!0&&lt.beginShadows();let H=m.state.shadowsArray;Et.render(H,C,B),Qt===!0&&lt.endShadows(),this.info.autoReset===!0&&this.info.reset();let G=p.opaque,O=p.transmissive;if(m.setupLights(),B.isArrayCamera){let ot=B.cameras;if(O.length>0)for(let vt=0,At=ot.length;vt<At;vt++){let Mt=ot[vt];rm(G,O,C,Mt)}te&&Rt.render(C);for(let vt=0,At=ot.length;vt<At;vt++){let Mt=ot[vt];im(p,C,Mt,Mt.viewport)}}else O.length>0&&rm(G,O,C,B),te&&Rt.render(C),im(p,C,B);E!==null&&w===0&&(ht.updateMultisampleRenderTarget(E),ht.updateRenderTargetMipmap(E)),C.isScene===!0&&C.onAfterRender(y,C,B),xt.resetDefaultState(),M=-1,S=null,_.pop(),_.length>0?(m=_[_.length-1],Qt===!0&&lt.setGlobalState(y.clippingPlanes,m.state.camera)):m=null,v.pop(),v.length>0?p=v[v.length-1]:p=null};function Lh(C,B,H,G){if(C.visible===!1)return;if(C.layers.test(B.layers)){if(C.isGroup)H=C.renderOrder;else if(C.isLOD)C.autoUpdate===!0&&C.update(B);else if(C.isLight)m.pushLight(C),C.castShadow&&m.pushShadow(C);else if(C.isSprite){if(!C.frustumCulled||he.intersectsSprite(C)){G&&Pt.setFromMatrixPosition(C.matrixWorld).applyMatrix4(tt);let vt=k.update(C),At=C.material;At.visible&&p.push(C,vt,At,H,Pt.z,null)}}else if((C.isMesh||C.isLine||C.isPoints)&&(!C.frustumCulled||he.intersectsObject(C))){let vt=k.update(C),At=C.material;if(G&&(C.boundingSphere!==void 0?(C.boundingSphere===null&&C.computeBoundingSphere(),Pt.copy(C.boundingSphere.center)):(vt.boundingSphere===null&&vt.computeBoundingSphere(),Pt.copy(vt.boundingSphere.center)),Pt.applyMatrix4(C.matrixWorld).applyMatrix4(tt)),Array.isArray(At)){let Mt=vt.groups;for(let Ut=0,kt=Mt.length;Ut<kt;Ut++){let Lt=Mt[Ut],ne=At[Lt.materialIndex];ne&&ne.visible&&p.push(C,vt,ne,H,Pt.z,Lt)}}else At.visible&&p.push(C,vt,At,H,Pt.z,null)}}let ot=C.children;for(let vt=0,At=ot.length;vt<At;vt++)Lh(ot[vt],B,H,G)}function im(C,B,H,G){let O=C.opaque,ot=C.transmissive,vt=C.transparent;m.setupLightsView(H),Qt===!0&&lt.setGlobalState(y.clippingPlanes,H),G&&Z.viewport(I.copy(G)),O.length>0&&Ba(O,B,H),ot.length>0&&Ba(ot,B,H),vt.length>0&&Ba(vt,B,H),Z.buffers.depth.setTest(!0),Z.buffers.depth.setMask(!0),Z.buffers.color.setMask(!0),Z.setPolygonOffset(!1)}function rm(C,B,H,G){if((H.isScene===!0?H.overrideMaterial:null)!==null)return;m.state.transmissionRenderTarget[G.id]===void 0&&(m.state.transmissionRenderTarget[G.id]=new ze(1,1,{generateMipmaps:!0,type:K.has("EXT_color_buffer_half_float")||K.has("EXT_color_buffer_float")?Ge:on,minFilter:ai,samples:4,stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:ie.workingColorSpace}));let ot=m.state.transmissionRenderTarget[G.id],vt=G.viewport||I;ot.setSize(vt.z*y.transmissionResolutionScale,vt.w*y.transmissionResolutionScale);let At=y.getRenderTarget(),Mt=y.getActiveCubeFace(),Ut=y.getActiveMipmapLevel();y.setRenderTarget(ot),y.getClearColor(N),z=y.getClearAlpha(),z<1&&y.setClearColor(16777215,.5),y.clear(),te&&Rt.render(H);let kt=y.toneMapping;y.toneMapping=Zn;let Lt=G.viewport;if(G.viewport!==void 0&&(G.viewport=void 0),m.setupLightsView(G),Qt===!0&&lt.setGlobalState(y.clippingPlanes,G),Ba(C,H,G),ht.updateMultisampleRenderTarget(ot),ht.updateRenderTargetMipmap(ot),K.has("WEBGL_multisampled_render_to_texture")===!1){let ne=!1;for(let ge=0,Pe=B.length;ge<Pe;ge++){let Te=B[ge],_e=Te.object,Nt=Te.geometry,Ae=Te.material,ce=Te.group;if(Ae.side===Sn&&_e.layers.test(G.layers)){let Tn=Ae.side;Ae.side=He,Ae.needsUpdate=!0,sm(_e,H,G,Nt,Ae,ce),Ae.side=Tn,Ae.needsUpdate=!0,ne=!0}}ne===!0&&(ht.updateMultisampleRenderTarget(ot),ht.updateRenderTargetMipmap(ot))}y.setRenderTarget(At,Mt,Ut),y.setClearColor(N,z),Lt!==void 0&&(G.viewport=Lt),y.toneMapping=kt}function Ba(C,B,H){let G=B.isScene===!0?B.overrideMaterial:null;for(let O=0,ot=C.length;O<ot;O++){let vt=C[O],At=vt.object,Mt=vt.geometry,Ut=vt.group,kt=vt.material;kt.allowOverride===!0&&G!==null&&(kt=G),At.layers.test(H.layers)&&sm(At,B,H,Mt,kt,Ut)}}function sm(C,B,H,G,O,ot){C.onBeforeRender(y,B,H,G,O,ot),C.modelViewMatrix.multiplyMatrices(H.matrixWorldInverse,C.matrixWorld),C.normalMatrix.getNormalMatrix(C.modelViewMatrix),O.onBeforeRender(y,B,H,G,C,ot),O.transparent===!0&&O.side===Sn&&O.forceSinglePass===!1?(O.side=He,O.needsUpdate=!0,y.renderBufferDirect(H,B,G,O,C,ot),O.side=yn,O.needsUpdate=!0,y.renderBufferDirect(H,B,G,O,C,ot),O.side=Sn):y.renderBufferDirect(H,B,G,O,C,ot),C.onAfterRender(y,B,H,G,O,ot)}function Oa(C,B,H){B.isScene!==!0&&(B=wt);let G=it.get(C),O=m.state.lights,ot=m.state.shadowsArray,vt=O.state.version,At=X.getParameters(C,O.state,ot,B,H),Mt=X.getProgramCacheKey(At),Ut=G.programs;G.environment=C.isMeshStandardMaterial?B.environment:null,G.fog=B.fog,G.envMap=(C.isMeshStandardMaterial?Wt:qt).get(C.envMap||G.environment),G.envMapRotation=G.environment!==null&&C.envMap===null?B.environmentRotation:C.envMapRotation,Ut===void 0&&(C.addEventListener("dispose",Q),Ut=new Map,G.programs=Ut);let kt=Ut.get(Mt);if(kt!==void 0){if(G.currentProgram===kt&&G.lightsStateVersion===vt)return am(C,At),kt}else At.uniforms=X.getUniforms(C),C.onBeforeCompile(At,y),kt=X.acquireProgram(At,Mt),Ut.set(Mt,kt),G.uniforms=At.uniforms;let Lt=G.uniforms;return(!C.isShaderMaterial&&!C.isRawShaderMaterial||C.clipping===!0)&&(Lt.clippingPlanes=lt.uniform),am(C,At),G.needsLights=zv(C),G.lightsStateVersion=vt,G.needsLights&&(Lt.ambientLightColor.value=O.state.ambient,Lt.lightProbe.value=O.state.probe,Lt.directionalLights.value=O.state.directional,Lt.directionalLightShadows.value=O.state.directionalShadow,Lt.spotLights.value=O.state.spot,Lt.spotLightShadows.value=O.state.spotShadow,Lt.rectAreaLights.value=O.state.rectArea,Lt.ltc_1.value=O.state.rectAreaLTC1,Lt.ltc_2.value=O.state.rectAreaLTC2,Lt.pointLights.value=O.state.point,Lt.pointLightShadows.value=O.state.pointShadow,Lt.hemisphereLights.value=O.state.hemi,Lt.directionalShadowMap.value=O.state.directionalShadowMap,Lt.directionalShadowMatrix.value=O.state.directionalShadowMatrix,Lt.spotShadowMap.value=O.state.spotShadowMap,Lt.spotLightMatrix.value=O.state.spotLightMatrix,Lt.spotLightMap.value=O.state.spotLightMap,Lt.pointShadowMap.value=O.state.pointShadowMap,Lt.pointShadowMatrix.value=O.state.pointShadowMatrix),G.currentProgram=kt,G.uniformsList=null,kt}function om(C){if(C.uniformsList===null){let B=C.currentProgram.getUniforms();C.uniformsList=Hs.seqWithValue(B.seq,C.uniforms)}return C.uniformsList}function am(C,B){let H=it.get(C);H.outputColorSpace=B.outputColorSpace,H.batching=B.batching,H.batchingColor=B.batchingColor,H.instancing=B.instancing,H.instancingColor=B.instancingColor,H.instancingMorph=B.instancingMorph,H.skinning=B.skinning,H.morphTargets=B.morphTargets,H.morphNormals=B.morphNormals,H.morphColors=B.morphColors,H.morphTargetsCount=B.morphTargetsCount,H.numClippingPlanes=B.numClippingPlanes,H.numIntersection=B.numClipIntersection,H.vertexAlphas=B.vertexAlphas,H.vertexTangents=B.vertexTangents,H.toneMapping=B.toneMapping}function Bv(C,B,H,G,O){B.isScene!==!0&&(B=wt),ht.resetTextureUnits();let ot=B.fog,vt=G.isMeshStandardMaterial?B.environment:null,At=E===null?y.outputColorSpace:E.isXRRenderTarget===!0?E.texture.colorSpace:yr,Mt=(G.isMeshStandardMaterial?Wt:qt).get(G.envMap||vt),Ut=G.vertexColors===!0&&!!H.attributes.color&&H.attributes.color.itemSize===4,kt=!!H.attributes.tangent&&(!!G.normalMap||G.anisotropy>0),Lt=!!H.morphAttributes.position,ne=!!H.morphAttributes.normal,ge=!!H.morphAttributes.color,Pe=Zn;G.toneMapped&&(E===null||E.isXRRenderTarget===!0)&&(Pe=y.toneMapping);let Te=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,_e=Te!==void 0?Te.length:0,Nt=it.get(G),Ae=m.state.lights;if(Qt===!0&&($===!0||C!==S)){let ln=C===S&&G.id===M;lt.setState(G,C,ln)}let ce=!1;G.version===Nt.__version?(Nt.needsLights&&Nt.lightsStateVersion!==Ae.state.version||Nt.outputColorSpace!==At||O.isBatchedMesh&&Nt.batching===!1||!O.isBatchedMesh&&Nt.batching===!0||O.isBatchedMesh&&Nt.batchingColor===!0&&O.colorTexture===null||O.isBatchedMesh&&Nt.batchingColor===!1&&O.colorTexture!==null||O.isInstancedMesh&&Nt.instancing===!1||!O.isInstancedMesh&&Nt.instancing===!0||O.isSkinnedMesh&&Nt.skinning===!1||!O.isSkinnedMesh&&Nt.skinning===!0||O.isInstancedMesh&&Nt.instancingColor===!0&&O.instanceColor===null||O.isInstancedMesh&&Nt.instancingColor===!1&&O.instanceColor!==null||O.isInstancedMesh&&Nt.instancingMorph===!0&&O.morphTexture===null||O.isInstancedMesh&&Nt.instancingMorph===!1&&O.morphTexture!==null||Nt.envMap!==Mt||G.fog===!0&&Nt.fog!==ot||Nt.numClippingPlanes!==void 0&&(Nt.numClippingPlanes!==lt.numPlanes||Nt.numIntersection!==lt.numIntersection)||Nt.vertexAlphas!==Ut||Nt.vertexTangents!==kt||Nt.morphTargets!==Lt||Nt.morphNormals!==ne||Nt.morphColors!==ge||Nt.toneMapping!==Pe||Nt.morphTargetsCount!==_e)&&(ce=!0):(ce=!0,Nt.__version=G.version);let Tn=Nt.currentProgram;ce===!0&&(Tn=Oa(G,B,O));let $r=!1,wn=!1,ao=!1,Ee=Tn.getUniforms(),Ln=Nt.uniforms;if(Z.useProgram(Tn.program)&&($r=!0,wn=!0,ao=!0),G.id!==M&&(M=G.id,wn=!0),$r||S!==C){Z.buffers.depth.getReversed()&&C.reversedDepth!==!0&&(C._reversedDepth=!0,C.updateProjectionMatrix()),Ee.setValue(F,"projectionMatrix",C.projectionMatrix),Ee.setValue(F,"viewMatrix",C.matrixWorldInverse);let mn=Ee.map.cameraPosition;mn!==void 0&&mn.setValue(F,St.setFromMatrixPosition(C.matrixWorld)),J.logarithmicDepthBuffer&&Ee.setValue(F,"logDepthBufFC",2/(Math.log(C.far+1)/Math.LN2)),(G.isMeshPhongMaterial||G.isMeshToonMaterial||G.isMeshLambertMaterial||G.isMeshBasicMaterial||G.isMeshStandardMaterial||G.isShaderMaterial)&&Ee.setValue(F,"isOrthographic",C.isOrthographicCamera===!0),S!==C&&(S=C,wn=!0,ao=!0)}if(O.isSkinnedMesh){Ee.setOptional(F,O,"bindMatrix"),Ee.setOptional(F,O,"bindMatrixInverse");let ln=O.skeleton;ln&&(ln.boneTexture===null&&ln.computeBoneTexture(),Ee.setValue(F,"boneTexture",ln.boneTexture,ht))}O.isBatchedMesh&&(Ee.setOptional(F,O,"batchingTexture"),Ee.setValue(F,"batchingTexture",O._matricesTexture,ht),Ee.setOptional(F,O,"batchingIdTexture"),Ee.setValue(F,"batchingIdTexture",O._indirectTexture,ht),Ee.setOptional(F,O,"batchingColorTexture"),O._colorsTexture!==null&&Ee.setValue(F,"batchingColorTexture",O._colorsTexture,ht));let Nn=H.morphAttributes;if((Nn.position!==void 0||Nn.normal!==void 0||Nn.color!==void 0)&&rt.update(O,H,Tn),(wn||Nt.receiveShadow!==O.receiveShadow)&&(Nt.receiveShadow=O.receiveShadow,Ee.setValue(F,"receiveShadow",O.receiveShadow)),G.isMeshGouraudMaterial&&G.envMap!==null&&(Ln.envMap.value=Mt,Ln.flipEnvMap.value=Mt.isCubeTexture&&Mt.isRenderTargetTexture===!1?-1:1),G.isMeshStandardMaterial&&G.envMap===null&&B.environment!==null&&(Ln.envMapIntensity.value=B.environmentIntensity),wn&&(Ee.setValue(F,"toneMappingExposure",y.toneMappingExposure),Nt.needsLights&&Ov(Ln,ao),ot&&G.fog===!0&&et.refreshFogUniforms(Ln,ot),et.refreshMaterialUniforms(Ln,G,W,j,m.state.transmissionRenderTarget[C.id]),Hs.upload(F,om(Nt),Ln,ht)),G.isShaderMaterial&&G.uniformsNeedUpdate===!0&&(Hs.upload(F,om(Nt),Ln,ht),G.uniformsNeedUpdate=!1),G.isSpriteMaterial&&Ee.setValue(F,"center",O.center),Ee.setValue(F,"modelViewMatrix",O.modelViewMatrix),Ee.setValue(F,"normalMatrix",O.normalMatrix),Ee.setValue(F,"modelMatrix",O.matrixWorld),G.isShaderMaterial||G.isRawShaderMaterial){let ln=G.uniformsGroups;for(let mn=0,Nh=ln.length;mn<Nh;mn++){let er=ln[mn];Jt.update(er,Tn),Jt.bind(er,Tn)}}return Tn}function Ov(C,B){C.ambientLightColor.needsUpdate=B,C.lightProbe.needsUpdate=B,C.directionalLights.needsUpdate=B,C.directionalLightShadows.needsUpdate=B,C.pointLights.needsUpdate=B,C.pointLightShadows.needsUpdate=B,C.spotLights.needsUpdate=B,C.spotLightShadows.needsUpdate=B,C.rectAreaLights.needsUpdate=B,C.hemisphereLights.needsUpdate=B}function zv(C){return C.isMeshLambertMaterial||C.isMeshToonMaterial||C.isMeshPhongMaterial||C.isMeshStandardMaterial||C.isShadowMaterial||C.isShaderMaterial&&C.lights===!0}this.getActiveCubeFace=function(){return T},this.getActiveMipmapLevel=function(){return w},this.getRenderTarget=function(){return E},this.setRenderTargetTextures=function(C,B,H){let G=it.get(C);G.__autoAllocateDepthBuffer=C.resolveDepthBuffer===!1,G.__autoAllocateDepthBuffer===!1&&(G.__useRenderToTexture=!1),it.get(C.texture).__webglTexture=B,it.get(C.depthTexture).__webglTexture=G.__autoAllocateDepthBuffer?void 0:H,G.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(C,B){let H=it.get(C);H.__webglFramebuffer=B,H.__useDefaultFramebuffer=B===void 0};let kv=F.createFramebuffer();this.setRenderTarget=function(C,B=0,H=0){E=C,T=B,w=H;let G=!0,O=null,ot=!1,vt=!1;if(C){let Mt=it.get(C);if(Mt.__useDefaultFramebuffer!==void 0)Z.bindFramebuffer(F.FRAMEBUFFER,null),G=!1;else if(Mt.__webglFramebuffer===void 0)ht.setupRenderTarget(C);else if(Mt.__hasExternalTextures)ht.rebindTextures(C,it.get(C.texture).__webglTexture,it.get(C.depthTexture).__webglTexture);else if(C.depthBuffer){let Lt=C.depthTexture;if(Mt.__boundDepthTexture!==Lt){if(Lt!==null&&it.has(Lt)&&(C.width!==Lt.image.width||C.height!==Lt.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");ht.setupDepthRenderbuffer(C)}}let Ut=C.texture;(Ut.isData3DTexture||Ut.isDataArrayTexture||Ut.isCompressedArrayTexture)&&(vt=!0);let kt=it.get(C).__webglFramebuffer;C.isWebGLCubeRenderTarget?(Array.isArray(kt[B])?O=kt[B][H]:O=kt[B],ot=!0):C.samples>0&&ht.useMultisampledRTT(C)===!1?O=it.get(C).__webglMultisampledFramebuffer:Array.isArray(kt)?O=kt[H]:O=kt,I.copy(C.viewport),P.copy(C.scissor),L=C.scissorTest}else I.copy(_t).multiplyScalar(W).floor(),P.copy(Ht).multiplyScalar(W).floor(),L=ee;if(H!==0&&(O=kv),Z.bindFramebuffer(F.FRAMEBUFFER,O)&&G&&Z.drawBuffers(C,O),Z.viewport(I),Z.scissor(P),Z.setScissorTest(L),ot){let Mt=it.get(C.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_CUBE_MAP_POSITIVE_X+B,Mt.__webglTexture,H)}else if(vt){let Mt=B;for(let Ut=0;Ut<C.textures.length;Ut++){let kt=it.get(C.textures[Ut]);F.framebufferTextureLayer(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0+Ut,kt.__webglTexture,H,Mt)}}else if(C!==null&&H!==0){let Mt=it.get(C.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,Mt.__webglTexture,H)}M=-1},this.readRenderTargetPixels=function(C,B,H,G,O,ot,vt,At=0){if(!(C&&C.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Mt=it.get(C).__webglFramebuffer;if(C.isWebGLCubeRenderTarget&&vt!==void 0&&(Mt=Mt[vt]),Mt){Z.bindFramebuffer(F.FRAMEBUFFER,Mt);try{let Ut=C.textures[At],kt=Ut.format,Lt=Ut.type;if(!J.textureFormatReadable(kt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!J.textureTypeReadable(Lt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}B>=0&&B<=C.width-G&&H>=0&&H<=C.height-O&&(C.textures.length>1&&F.readBuffer(F.COLOR_ATTACHMENT0+At),F.readPixels(B,H,G,O,Dt.convert(kt),Dt.convert(Lt),ot))}finally{let Ut=E!==null?it.get(E).__webglFramebuffer:null;Z.bindFramebuffer(F.FRAMEBUFFER,Ut)}}},this.readRenderTargetPixelsAsync=async function(C,B,H,G,O,ot,vt,At=0){if(!(C&&C.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Mt=it.get(C).__webglFramebuffer;if(C.isWebGLCubeRenderTarget&&vt!==void 0&&(Mt=Mt[vt]),Mt)if(B>=0&&B<=C.width-G&&H>=0&&H<=C.height-O){Z.bindFramebuffer(F.FRAMEBUFFER,Mt);let Ut=C.textures[At],kt=Ut.format,Lt=Ut.type;if(!J.textureFormatReadable(kt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!J.textureTypeReadable(Lt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let ne=F.createBuffer();F.bindBuffer(F.PIXEL_PACK_BUFFER,ne),F.bufferData(F.PIXEL_PACK_BUFFER,ot.byteLength,F.STREAM_READ),C.textures.length>1&&F.readBuffer(F.COLOR_ATTACHMENT0+At),F.readPixels(B,H,G,O,Dt.convert(kt),Dt.convert(Lt),0);let ge=E!==null?it.get(E).__webglFramebuffer:null;Z.bindFramebuffer(F.FRAMEBUFFER,ge);let Pe=F.fenceSync(F.SYNC_GPU_COMMANDS_COMPLETE,0);return F.flush(),await o0(F,Pe,4),F.bindBuffer(F.PIXEL_PACK_BUFFER,ne),F.getBufferSubData(F.PIXEL_PACK_BUFFER,0,ot),F.deleteBuffer(ne),F.deleteSync(Pe),ot}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(C,B=null,H=0){let G=Math.pow(2,-H),O=Math.floor(C.image.width*G),ot=Math.floor(C.image.height*G),vt=B!==null?B.x:0,At=B!==null?B.y:0;ht.setTexture2D(C,0),F.copyTexSubImage2D(F.TEXTURE_2D,H,0,0,vt,At,O,ot),Z.unbindTexture()};let Vv=F.createFramebuffer(),Hv=F.createFramebuffer();this.copyTextureToTexture=function(C,B,H=null,G=null,O=0,ot=null){ot===null&&(O!==0?(ys("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),ot=O,O=0):ot=0);let vt,At,Mt,Ut,kt,Lt,ne,ge,Pe,Te=C.isCompressedTexture?C.mipmaps[ot]:C.image;if(H!==null)vt=H.max.x-H.min.x,At=H.max.y-H.min.y,Mt=H.isBox3?H.max.z-H.min.z:1,Ut=H.min.x,kt=H.min.y,Lt=H.isBox3?H.min.z:0;else{let Nn=Math.pow(2,-O);vt=Math.floor(Te.width*Nn),At=Math.floor(Te.height*Nn),C.isDataArrayTexture?Mt=Te.depth:C.isData3DTexture?Mt=Math.floor(Te.depth*Nn):Mt=1,Ut=0,kt=0,Lt=0}G!==null?(ne=G.x,ge=G.y,Pe=G.z):(ne=0,ge=0,Pe=0);let _e=Dt.convert(B.format),Nt=Dt.convert(B.type),Ae;B.isData3DTexture?(ht.setTexture3D(B,0),Ae=F.TEXTURE_3D):B.isDataArrayTexture||B.isCompressedArrayTexture?(ht.setTexture2DArray(B,0),Ae=F.TEXTURE_2D_ARRAY):(ht.setTexture2D(B,0),Ae=F.TEXTURE_2D),F.pixelStorei(F.UNPACK_FLIP_Y_WEBGL,B.flipY),F.pixelStorei(F.UNPACK_PREMULTIPLY_ALPHA_WEBGL,B.premultiplyAlpha),F.pixelStorei(F.UNPACK_ALIGNMENT,B.unpackAlignment);let ce=F.getParameter(F.UNPACK_ROW_LENGTH),Tn=F.getParameter(F.UNPACK_IMAGE_HEIGHT),$r=F.getParameter(F.UNPACK_SKIP_PIXELS),wn=F.getParameter(F.UNPACK_SKIP_ROWS),ao=F.getParameter(F.UNPACK_SKIP_IMAGES);F.pixelStorei(F.UNPACK_ROW_LENGTH,Te.width),F.pixelStorei(F.UNPACK_IMAGE_HEIGHT,Te.height),F.pixelStorei(F.UNPACK_SKIP_PIXELS,Ut),F.pixelStorei(F.UNPACK_SKIP_ROWS,kt),F.pixelStorei(F.UNPACK_SKIP_IMAGES,Lt);let Ee=C.isDataArrayTexture||C.isData3DTexture,Ln=B.isDataArrayTexture||B.isData3DTexture;if(C.isDepthTexture){let Nn=it.get(C),ln=it.get(B),mn=it.get(Nn.__renderTarget),Nh=it.get(ln.__renderTarget);Z.bindFramebuffer(F.READ_FRAMEBUFFER,mn.__webglFramebuffer),Z.bindFramebuffer(F.DRAW_FRAMEBUFFER,Nh.__webglFramebuffer);for(let er=0;er<Mt;er++)Ee&&(F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,it.get(C).__webglTexture,O,Lt+er),F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,it.get(B).__webglTexture,ot,Pe+er)),F.blitFramebuffer(Ut,kt,vt,At,ne,ge,vt,At,F.DEPTH_BUFFER_BIT,F.NEAREST);Z.bindFramebuffer(F.READ_FRAMEBUFFER,null),Z.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else if(O!==0||C.isRenderTargetTexture||it.has(C)){let Nn=it.get(C),ln=it.get(B);Z.bindFramebuffer(F.READ_FRAMEBUFFER,Vv),Z.bindFramebuffer(F.DRAW_FRAMEBUFFER,Hv);for(let mn=0;mn<Mt;mn++)Ee?F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,Nn.__webglTexture,O,Lt+mn):F.framebufferTexture2D(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,Nn.__webglTexture,O),Ln?F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,ln.__webglTexture,ot,Pe+mn):F.framebufferTexture2D(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,ln.__webglTexture,ot),O!==0?F.blitFramebuffer(Ut,kt,vt,At,ne,ge,vt,At,F.COLOR_BUFFER_BIT,F.NEAREST):Ln?F.copyTexSubImage3D(Ae,ot,ne,ge,Pe+mn,Ut,kt,vt,At):F.copyTexSubImage2D(Ae,ot,ne,ge,Ut,kt,vt,At);Z.bindFramebuffer(F.READ_FRAMEBUFFER,null),Z.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else Ln?C.isDataTexture||C.isData3DTexture?F.texSubImage3D(Ae,ot,ne,ge,Pe,vt,At,Mt,_e,Nt,Te.data):B.isCompressedArrayTexture?F.compressedTexSubImage3D(Ae,ot,ne,ge,Pe,vt,At,Mt,_e,Te.data):F.texSubImage3D(Ae,ot,ne,ge,Pe,vt,At,Mt,_e,Nt,Te):C.isDataTexture?F.texSubImage2D(F.TEXTURE_2D,ot,ne,ge,vt,At,_e,Nt,Te.data):C.isCompressedTexture?F.compressedTexSubImage2D(F.TEXTURE_2D,ot,ne,ge,Te.width,Te.height,_e,Te.data):F.texSubImage2D(F.TEXTURE_2D,ot,ne,ge,vt,At,_e,Nt,Te);F.pixelStorei(F.UNPACK_ROW_LENGTH,ce),F.pixelStorei(F.UNPACK_IMAGE_HEIGHT,Tn),F.pixelStorei(F.UNPACK_SKIP_PIXELS,$r),F.pixelStorei(F.UNPACK_SKIP_ROWS,wn),F.pixelStorei(F.UNPACK_SKIP_IMAGES,ao),ot===0&&B.generateMipmaps&&F.generateMipmap(Ae),Z.unbindTexture()},this.initRenderTarget=function(C){it.get(C).__webglFramebuffer===void 0&&ht.setupRenderTarget(C)},this.initTexture=function(C){C.isCubeTexture?ht.setTextureCube(C,0):C.isData3DTexture?ht.setTexture3D(C,0):C.isDataArrayTexture||C.isCompressedArrayTexture?ht.setTexture2DArray(C,0):ht.setTexture2D(C,0),Z.unbindTexture()},this.resetState=function(){T=0,w=0,E=null,Z.reset(),xt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Rn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;let e=this.getContext();e.drawingBufferColorSpace=ie._getDrawingBufferColorSpace(t),e.unpackColorSpace=ie._getUnpackColorSpace()}};var Y0=Math.pow(2,-24),_a=Symbol("SKIP_GENERATION"),Iu={strategy:0,maxDepth:40,maxLeafSize:10,useSharedArrayBuffer:!1,setBoundingBox:!0,onProgress:null,indirect:!1,verbose:!0,range:null,[_a]:!1};function ye(r,t,e){return e.min.x=t[r],e.min.y=t[r+1],e.min.z=t[r+2],e.max.x=t[r+3],e.max.y=t[r+4],e.max.z=t[r+5],e}function mp(r){let t=-1,e=-1/0;for(let n=0;n<3;n++){let i=r[n+3]-r[n];i>e&&(e=i,t=n)}return t}function gp(r,t){t.set(r)}function xp(r,t,e){let n,i;for(let s=0;s<3;s++){let o=s+3;n=r[s],i=t[s],e[s]=n<i?n:i,n=r[o],i=t[o],e[o]=n>i?n:i}}function ya(r,t,e){for(let n=0;n<3;n++){let i=t[r+2*n],s=t[r+2*n+1],o=i-s,a=i+s;o<e[n]&&(e[n]=o),a>e[n+3]&&(e[n+3]=a)}}function Ws(r){let t=r[3]-r[0],e=r[4]-r[1],n=r[5]-r[2];return 2*(t*e+e*n+n*t)}function le(r,t){return t[r+15]===65535}function Ie(r,t){return t[r+6]}function Fe(r,t){return t[r+14]}function xe(r){return r+8}function ve(r,t){let e=t[r+6];return r+e*8}function Yi(r,t){return t[r+7]}function Pu(r,t,e,n,i){let s=1/0,o=1/0,a=1/0,c=-1/0,l=-1/0,f=-1/0,h=1/0,u=1/0,d=1/0,g=-1/0,x=-1/0,p=-1/0,m=r.offset||0;for(let v=(t-m)*6,_=(t+e-m)*6;v<_;v+=6){let y=r[v+0],b=r[v+1],T=y-b,w=y+b;T<s&&(s=T),w>c&&(c=w),y<h&&(h=y),y>g&&(g=y);let E=r[v+2],M=r[v+3],S=E-M,I=E+M;S<o&&(o=S),I>l&&(l=I),E<u&&(u=E),E>x&&(x=E);let P=r[v+4],L=r[v+5],N=P-L,z=P+L;N<a&&(a=N),z>f&&(f=z),P<d&&(d=P),P>p&&(p=P)}n[0]=s,n[1]=o,n[2]=a,n[3]=c,n[4]=l,n[5]=f,i[0]=h,i[1]=u,i[2]=d,i[3]=g,i[4]=x,i[5]=p}var wi=32,jw=(r,t)=>r.candidate-t.candidate,$i=new Array(wi).fill().map(()=>({count:0,bounds:new Float32Array(6),rightCacheBounds:new Float32Array(6),leftCacheBounds:new Float32Array(6),candidate:0})),Du=new Float32Array(6);function J0(r,t,e,n,i,s){let o=-1,a=0;if(s===0)o=mp(t),o!==-1&&(a=(t[o]+t[o+3])/2);else if(s===1)o=mp(r),o!==-1&&(a=tA(e,n,i,o));else if(s===2){let c=Ws(r),l=1.25*i,f=e.offset||0,h=(n-f)*6,u=(n+i-f)*6;for(let d=0;d<3;d++){let g=t[d],m=(t[d+3]-g)/wi;if(i<wi/4){let v=[...$i];v.length=i;let _=0;for(let b=h;b<u;b+=6,_++){let T=v[_];T.candidate=e[b+2*d],T.count=0;let{bounds:w,leftCacheBounds:E,rightCacheBounds:M}=T;for(let S=0;S<3;S++)M[S]=1/0,M[S+3]=-1/0,E[S]=1/0,E[S+3]=-1/0,w[S]=1/0,w[S+3]=-1/0;ya(b,e,w)}v.sort(jw);let y=i;for(let b=0;b<y;b++){let T=v[b];for(;b+1<y&&v[b+1].candidate===T.candidate;)v.splice(b+1,1),y--}for(let b=h;b<u;b+=6){let T=e[b+2*d];for(let w=0;w<y;w++){let E=v[w];T>=E.candidate?ya(b,e,E.rightCacheBounds):(ya(b,e,E.leftCacheBounds),E.count++)}}for(let b=0;b<y;b++){let T=v[b],w=T.count,E=i-T.count,M=T.leftCacheBounds,S=T.rightCacheBounds,I=0;w!==0&&(I=Ws(M)/c);let P=0;E!==0&&(P=Ws(S)/c);let L=1+1.25*(I*w+P*E);L<l&&(o=d,l=L,a=T.candidate)}}else{for(let y=0;y<wi;y++){let b=$i[y];b.count=0,b.candidate=g+m+y*m;let T=b.bounds;for(let w=0;w<3;w++)T[w]=1/0,T[w+3]=-1/0}for(let y=h;y<u;y+=6){let w=~~((e[y+2*d]-g)/m);w>=wi&&(w=wi-1);let E=$i[w];E.count++,ya(y,e,E.bounds)}let v=$i[wi-1];gp(v.bounds,v.rightCacheBounds);for(let y=wi-2;y>=0;y--){let b=$i[y],T=$i[y+1];xp(b.bounds,T.rightCacheBounds,b.rightCacheBounds)}let _=0;for(let y=0;y<wi-1;y++){let b=$i[y],T=b.count,w=b.bounds,M=$i[y+1].rightCacheBounds;T!==0&&(_===0?gp(w,Du):xp(w,Du,Du)),_+=T;let S=0,I=0;_!==0&&(S=Ws(Du)/c);let P=i-_;P!==0&&(I=Ws(M)/c);let L=1+1.25*(S*_+I*P);L<l&&(o=d,l=L,a=b.candidate)}}}}else console.warn(`BVH: Invalid build strategy value ${s} used.`);return{axis:o,pos:a}}function tA(r,t,e,n){let i=0,s=r.offset;for(let o=t,a=t+e;o<a;o++)i+=r[(o-s)*6+n*2];return i/e}var Xs=class{constructor(){this.boundingData=new Float32Array(6)}};function K0(r,t,e,n,i,s){let o=n,a=n+i-1,c=s.pos,l=s.axis*2,f=e.offset||0;for(;;){for(;o<=a&&e[(o-f)*6+l]<c;)o++;for(;o<=a&&e[(a-f)*6+l]>=c;)a--;if(o<a){for(let h=0;h<t;h++){let u=r[o*t+h];r[o*t+h]=r[a*t+h],r[a*t+h]=u}for(let h=0;h<6;h++){let u=o-f,d=a-f,g=e[u*6+h];e[u*6+h]=e[d*6+h],e[d*6+h]=g}o++,a--}else return o}}var Q0,Fu,vp,j0,eA=Math.pow(2,32);function Lu(r){return"count"in r?1:1+Lu(r.left)+Lu(r.right)}function tx(r,t,e){return Q0=new Float32Array(e),Fu=new Uint32Array(e),vp=new Uint16Array(e),j0=new Uint8Array(e),_p(r,t)}function _p(r,t){let e=r/4,n=r/2,i="count"in t,s=t.boundingData;for(let o=0;o<6;o++)Q0[e+o]=s[o];if(i)return t.buffer?(j0.set(new Uint8Array(t.buffer),r),r+t.buffer.byteLength):(Fu[e+6]=t.offset,vp[n+14]=t.count,vp[n+15]=65535,r+32);{let{left:o,right:a,splitAxis:c}=t,l=r+32,f=_p(l,o),h=r/32,d=f/32-h;if(d>eA)throw new Error("MeshBVH: Cannot store relative child node offset greater than 32 bits.");return Fu[e+6]=d,Fu[e+7]=c,_p(f,a)}}function nA(r,t,e,n,i){let{maxDepth:s,verbose:o,maxLeafSize:a,strategy:c,onProgress:l}=i,f=r.primitiveBuffer,h=r.primitiveBufferStride,u=new Float32Array(6),d=!1,g=new Xs;return Pu(t,e,n,g.boundingData,u),p(g,e,n,u),g;function x(m){l&&l(m/n)}function p(m,v,_,y=null,b=0){if(!d&&b>=s&&(d=!0,o&&console.warn(`BVH: Max depth of ${s} reached when generating BVH. Consider increasing maxDepth.`)),_<=a||b>=s)return x(v+_),m.offset=v,m.count=_,m;let T=J0(m.boundingData,y,t,v,_,c);if(T.axis===-1)return x(v+_),m.offset=v,m.count=_,m;let w=K0(f,h,t,v,_,T);if(w===v||w===v+_)x(v+_),m.offset=v,m.count=_;else{m.splitAxis=T.axis;let E=new Xs,M=v,S=w-v;m.left=E,Pu(t,M,S,E.boundingData,u),p(E,M,S,u,b+1);let I=new Xs,P=w,L=_-S;m.right=I,Pu(t,P,L,I.boundingData,u),p(I,P,L,u,b+1)}return m}}function ex(r,t){let e=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,n=r.getRootRanges(t.range),i=n[0],s=n[n.length-1],o={offset:i.offset,count:s.offset+s.count-i.offset},a=new Float32Array(6*o.count);a.offset=o.offset,r.computePrimitiveBounds(o.offset,o.count,a),r._roots=n.map(c=>{let l=nA(r,a,c.offset,c.count,t),f=Lu(l),h=new e(32*f);return tx(0,l,h),h})}var Zi=class{constructor(t){this._getNewPrimitive=t,this._primitives=[]}getPrimitive(){let t=this._primitives;return t.length===0?this._getNewPrimitive():t.pop()}releasePrimitive(t){this._primitives.push(t)}};var yp=class{constructor(){this.float32Array=null,this.uint16Array=null,this.uint32Array=null;let t=[],e=null;this.setBuffer=n=>{e&&t.push(e),e=n,this.float32Array=new Float32Array(n),this.uint16Array=new Uint16Array(n),this.uint32Array=new Uint32Array(n)},this.clearBuffer=()=>{e=null,this.float32Array=null,this.uint16Array=null,this.uint32Array=null,t.length!==0&&this.setBuffer(t.pop())}}},ae=new yp;var Ji,Ys,qs=[],Nu=new Zi(()=>new se);function nx(r,t,e,n,i,s){Ji=Nu.getPrimitive(),Ys=Nu.getPrimitive(),qs.push(Ji,Ys),ae.setBuffer(r._roots[t]);let o=bp(0,r.geometry,e,n,i,s);ae.clearBuffer(),Nu.releasePrimitive(Ji),Nu.releasePrimitive(Ys),qs.pop(),qs.pop();let a=qs.length;return a>0&&(Ys=qs[a-1],Ji=qs[a-2]),o}function bp(r,t,e,n,i=null,s=0,o=0){let{float32Array:a,uint16Array:c,uint32Array:l}=ae,f=r*2;if(le(f,c)){let u=Ie(r,l),d=Fe(f,c);return ye(r,a,Ji),n(u,d,!1,o,s+r/8,Ji)}else{let S=function(P){let{uint16Array:L,uint32Array:N}=ae,z=P*2;for(;!le(z,L);)P=xe(P),z=P*2;return Ie(P,N)},I=function(P){let{uint16Array:L,uint32Array:N}=ae,z=P*2;for(;!le(z,L);)P=ve(P,N),z=P*2;return Ie(P,N)+Fe(z,L)},u=xe(r),d=ve(r,l),g=u,x=d,p,m,v,_;if(i&&(v=Ji,_=Ys,ye(g,a,v),ye(x,a,_),p=i(v),m=i(_),m<p)){g=d,x=u;let P=p;p=m,m=P,v=_}v||(v=Ji,ye(g,a,v));let y=le(g*2,c),b=e(v,y,p,o+1,s+g/8),T;if(b===2){let P=S(g),N=I(g)-P;T=n(P,N,!0,o+1,s+g/8,v)}else T=b&&bp(g,t,e,n,i,s,o+1);if(T)return!0;_=Ys,ye(x,a,_);let w=le(x*2,c),E=e(_,w,m,o+1,s+x/8),M;if(E===2){let P=S(x),N=I(x)-P;M=n(P,N,!0,o+1,s+x/8,_)}else M=E&&bp(x,t,e,n,i,s,o+1);return!!M}}function ba(r){return r.index?r.index.count:r.attributes.position.count}function Ki(r){return ba(r)/3}function Sp(r,t=ArrayBuffer){return r>65535?new Uint32Array(new t(4*r)):new Uint16Array(new t(2*r))}function ix(r,t){if(!r.index){let e=r.attributes.position.count,n=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,i=Sp(e,n);r.setIndex(new Ot(i,1));for(let s=0;s<e;s++)i[s]=s}}function rA(r,t,e){let n=ba(r)/e,i=t||r.drawRange,s=i.start/e,o=(i.start+i.count)/e,a=Math.max(0,s),c=Math.min(n,o)-a;return{offset:Math.floor(a),count:Math.floor(c)}}function sA(r,t){return r.groups.map(e=>({offset:e.start/t,count:e.count/t}))}function Sa(r,t,e){let n=rA(r,t,e),i=sA(r,e);if(!i.length)return[n];let s=[],o=n.offset,a=n.offset+n.count,c=ba(r)/e,l=[];for(let u of i){let{offset:d,count:g}=u,x=d,p=isFinite(g)?g:c-d,m=d+p;x<a&&m>o&&(l.push({pos:Math.max(o,x),isStart:!0}),l.push({pos:Math.min(a,m),isStart:!1}))}l.sort((u,d)=>u.pos!==d.pos?u.pos-d.pos:u.type==="end"?-1:1);let f=0,h=null;for(let u of l){let d=u.pos;f!==0&&d!==h&&s.push({offset:h,count:d-h}),f+=u.isStart?1:-1,h=d}return s}var rx=new se,Bu=class{constructor(){this._roots=null,this.primitiveBuffer=null,this.primitiveBufferStride=null}init(t){t={...Iu,...t},ex(this,t)}getRootRanges(t){return Sa(this.geometry,t,this.primitiveStride)}raycastObject3D(){throw new Error("BVH: raycastObject3D() not implemented")}shiftPrimitiveOffsets(t){let e=this._indirectBuffer;if(e)for(let n=0,i=e.length;n<i;n++)e[n]+=t;else{let n=this._roots;for(let i=0;i<n.length;i++){let s=n[i],o=new Uint32Array(s),a=new Uint16Array(s),c=s.byteLength/32;for(let l=0;l<c;l++){let f=8*l,h=2*f;le(h,a)&&(o[f+6]+=t)}}}}traverse(t,e=0){let n=this._roots[e],i=new Uint32Array(n),s=new Uint16Array(n);o(0);function o(a,c=0){let l=a*2,f=le(l,s);if(f){let h=i[a+6],u=s[l+14];t(c,f,new Float32Array(n,a*4,6),h,u)}else{let h=xe(a),u=ve(a,i),d=Yi(a,i);t(c,f,new Float32Array(n,a*4,6),d)||(o(h,c+1),o(u,c+1))}}}getBoundingBox(t){return t.makeEmpty(),this._roots.forEach(n=>{ye(0,new Float32Array(n),rx),t.union(rx)}),t}shapecast(t){let{boundsTraverseOrder:e,intersectsBounds:n,intersectsRange:i,intersectsPrimitive:s,scratchPrimitive:o,iterate:a}=t;if(i&&s){let h=i;i=(u,d,g,x,p)=>h(u,d,g,x,p)?!0:a(u,d,this,s,g,x,o)}else i||(s?i=(h,u,d,g)=>a(h,u,this,s,d,g,o):i=(h,u,d)=>d);let c=!1,l=0,f=this._roots;for(let h=0,u=f.length;h<u;h++){let d=f[h];if(c=nx(this,h,n,i,e,l),c)break;l+=d.byteLength/32}return c}};var Dn=class{constructor(){this.min=1/0,this.max=-1/0}setFromPointsField(t,e){let n=1/0,i=-1/0;for(let s=0,o=t.length;s<o;s++){let c=t[s][e];n=c<n?c:n,i=c>i?c:i}this.min=n,this.max=i}setFromPoints(t,e){let n=1/0,i=-1/0;for(let s=0,o=e.length;s<o;s++){let a=e[s],c=t.dot(a);n=c<n?c:n,i=c>i?c:i}this.min=n,this.max=i}isSeparated(t){return this.min>t.max||t.min>this.max}};Dn.prototype.setFromBox=(function(){let r=new R;return function(e,n){let i=n.min,s=n.max,o=1/0,a=-1/0;for(let c=0;c<=1;c++)for(let l=0;l<=1;l++)for(let f=0;f<=1;f++){r.x=i.x*c+s.x*(1-c),r.y=i.y*l+s.y*(1-l),r.z=i.z*f+s.z*(1-f);let h=e.dot(r);o=Math.min(h,o),a=Math.max(h,a)}this.min=o,this.max=a}})();var oA=(function(){let r=new R,t=new R,e=new R;return function(i,s,o){let a=i.start,c=r,l=s.start,f=t;e.subVectors(a,l),r.subVectors(i.end,i.start),t.subVectors(s.end,s.start);let h=e.dot(f),u=f.dot(c),d=f.dot(f),g=e.dot(c),p=c.dot(c)*d-u*u,m,v;p!==0?m=(h*u-g*d)/p:m=0,v=(h+m*u)/d,o.x=m,o.y=v}})(),Ma=(function(){let r=new q,t=new R,e=new R;return function(i,s,o,a){oA(i,s,r);let c=r.x,l=r.y;if(c>=0&&c<=1&&l>=0&&l<=1){i.at(c,o),s.at(l,a);return}else if(c>=0&&c<=1){l<0?s.at(0,a):s.at(1,a),i.closestPointToPoint(a,!0,o);return}else if(l>=0&&l<=1){c<0?i.at(0,o):i.at(1,o),s.closestPointToPoint(o,!0,a);return}else{let f;c<0?f=i.start:f=i.end;let h;l<0?h=s.start:h=s.end;let u=t,d=e;if(i.closestPointToPoint(h,!0,t),s.closestPointToPoint(f,!0,e),u.distanceToSquared(h)<=d.distanceToSquared(f)){o.copy(u),a.copy(h);return}else{o.copy(f),a.copy(d);return}}}})(),sx=(function(){let r=new R,t=new R,e=new _n,n=new dn;return function(s,o){let{radius:a,center:c}=s,{a:l,b:f,c:h}=o;if(n.start=l,n.end=f,n.closestPointToPoint(c,!0,r).distanceTo(c)<=a||(n.start=l,n.end=h,n.closestPointToPoint(c,!0,r).distanceTo(c)<=a)||(n.start=f,n.end=h,n.closestPointToPoint(c,!0,r).distanceTo(c)<=a))return!0;let x=o.getPlane(e);if(Math.abs(x.distanceToPoint(c))<=a){let m=x.projectPoint(c,t);if(o.containsPoint(m))return!0}return!1}})();var aA=["x","y","z"],Ai=1e-15,ox=Ai*Ai;function Vn(r){return Math.abs(r)<Ai}var tn=class extends $e{constructor(...t){super(...t),this.isExtendedTriangle=!0,this.satAxes=new Array(4).fill().map(()=>new R),this.satBounds=new Array(4).fill().map(()=>new Dn),this.points=[this.a,this.b,this.c],this.plane=new _n,this.isDegenerateIntoSegment=!1,this.isDegenerateIntoPoint=!1,this.degenerateSegment=new dn,this.needsUpdate=!0}intersectsSphere(t){return sx(t,this)}update(){let t=this.a,e=this.b,n=this.c,i=this.points,s=this.satAxes,o=this.satBounds,a=s[0],c=o[0];this.getNormal(a),c.setFromPoints(a,i);let l=s[1],f=o[1];l.subVectors(t,e),f.setFromPoints(l,i);let h=s[2],u=o[2];h.subVectors(e,n),u.setFromPoints(h,i);let d=s[3],g=o[3];d.subVectors(n,t),g.setFromPoints(d,i);let x=l.length(),p=h.length(),m=d.length();this.isDegenerateIntoPoint=!1,this.isDegenerateIntoSegment=!1,x<Ai?p<Ai||m<Ai?this.isDegenerateIntoPoint=!0:(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(t),this.degenerateSegment.end.copy(n)):p<Ai?m<Ai?this.isDegenerateIntoPoint=!0:(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(e),this.degenerateSegment.end.copy(t)):m<Ai&&(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(n),this.degenerateSegment.end.copy(e)),this.plane.setFromNormalAndCoplanarPoint(a,t),this.needsUpdate=!1}};tn.prototype.closestPointToSegment=(function(){let r=new R,t=new R,e=new dn;return function(i,s=null,o=null){let{start:a,end:c}=i,l=this.points,f,h=1/0;for(let u=0;u<3;u++){let d=(u+1)%3;e.start.copy(l[u]),e.end.copy(l[d]),Ma(e,i,r,t),f=r.distanceToSquared(t),f<h&&(h=f,s&&s.copy(r),o&&o.copy(t))}return this.closestPointToPoint(a,r),f=a.distanceToSquared(r),f<h&&(h=f,s&&s.copy(r),o&&o.copy(a)),this.closestPointToPoint(c,r),f=c.distanceToSquared(r),f<h&&(h=f,s&&s.copy(r),o&&o.copy(c)),Math.sqrt(h)}})();tn.prototype.intersectsTriangle=(function(){let r=new tn,t=new Dn,e=new Dn,n=new R,i=new R,s=new R,o=new R,a=new dn,c=new dn,l=new R,f=new q,h=new q;function u(_,y,b,T){let w=n;!_.isDegenerateIntoPoint&&!_.isDegenerateIntoSegment?w.copy(_.plane.normal):w.copy(y.plane.normal);let E=_.satBounds,M=_.satAxes;for(let P=1;P<4;P++){let L=E[P],N=M[P];if(t.setFromPoints(N,y.points),L.isSeparated(t)||(o.copy(w).cross(N),t.setFromPoints(o,_.points),e.setFromPoints(o,y.points),t.isSeparated(e)))return!1}let S=y.satBounds,I=y.satAxes;for(let P=1;P<4;P++){let L=S[P],N=I[P];if(t.setFromPoints(N,_.points),L.isSeparated(t)||(o.crossVectors(w,N),t.setFromPoints(o,_.points),e.setFromPoints(o,y.points),t.isSeparated(e)))return!1}return b&&(T||console.warn("ExtendedTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0."),b.start.set(0,0,0),b.end.set(0,0,0)),!0}function d(_,y,b,T,w,E,M,S,I,P,L){let N=M/(M-S);P.x=T+(w-T)*N,L.start.subVectors(y,_).multiplyScalar(N).add(_),N=M/(M-I),P.y=T+(E-T)*N,L.end.subVectors(b,_).multiplyScalar(N).add(_)}function g(_,y,b,T,w,E,M,S,I,P,L){if(w>0)d(_.c,_.a,_.b,T,y,b,I,M,S,P,L);else if(E>0)d(_.b,_.a,_.c,b,y,T,S,M,I,P,L);else if(S*I>0||M!=0)d(_.a,_.b,_.c,y,b,T,M,S,I,P,L);else if(S!=0)d(_.b,_.a,_.c,b,y,T,S,M,I,P,L);else if(I!=0)d(_.c,_.a,_.b,T,y,b,I,M,S,P,L);else return!0;return!1}function x(_,y,b,T){let w=y.degenerateSegment,E=_.plane.distanceToPoint(w.start),M=_.plane.distanceToPoint(w.end);return Vn(E)?Vn(M)?u(_,y,b,T):(b&&(b.start.copy(w.start),b.end.copy(w.start)),_.containsPoint(w.start)):Vn(M)?(b&&(b.start.copy(w.end),b.end.copy(w.end)),_.containsPoint(w.end)):_.plane.intersectLine(w,n)!=null?(b&&(b.start.copy(n),b.end.copy(n)),_.containsPoint(n)):!1}function p(_,y,b){let T=y.a;return Vn(_.plane.distanceToPoint(T))&&_.containsPoint(T)?(b&&(b.start.copy(T),b.end.copy(T)),!0):!1}function m(_,y,b){let T=_.degenerateSegment,w=y.a;return T.closestPointToPoint(w,!0,n),w.distanceToSquared(n)<ox?(b&&(b.start.copy(w),b.end.copy(w)),!0):!1}function v(_,y,b,T){if(_.isDegenerateIntoSegment)if(y.isDegenerateIntoSegment){let w=_.degenerateSegment,E=y.degenerateSegment,M=i,S=s;w.delta(M),E.delta(S);let I=n.subVectors(E.start,w.start),P=M.x*S.y-M.y*S.x;if(Vn(P))return!1;let L=(I.x*S.y-I.y*S.x)/P,N=-(M.x*I.y-M.y*I.x)/P;if(L<0||L>1||N<0||N>1)return!1;let z=w.start.z+M.z*L,V=E.start.z+S.z*N;return Vn(z-V)?(b&&(b.start.copy(w.start).addScaledVector(M,L),b.end.copy(w.start).addScaledVector(M,L)),!0):!1}else return y.isDegenerateIntoPoint?m(_,y,b):x(y,_,b,T);else{if(_.isDegenerateIntoPoint)return y.isDegenerateIntoPoint?y.a.distanceToSquared(_.a)<ox?(b&&(b.start.copy(_.a),b.end.copy(_.a)),!0):!1:y.isDegenerateIntoSegment?m(y,_,b):p(y,_,b);if(y.isDegenerateIntoPoint)return p(_,y,b);if(y.isDegenerateIntoSegment)return x(_,y,b,T)}}return function(y,b=null,T=!1){this.needsUpdate&&this.update(),y.isExtendedTriangle?y.needsUpdate&&y.update():(r.copy(y),r.update(),y=r);let w=v(this,y,b,T);if(w!==void 0)return w;let E=this.plane,M=y.plane,S=M.distanceToPoint(this.a),I=M.distanceToPoint(this.b),P=M.distanceToPoint(this.c);Vn(S)&&(S=0),Vn(I)&&(I=0),Vn(P)&&(P=0);let L=S*I,N=S*P;if(L>0&&N>0)return!1;let z=E.distanceToPoint(y.a),V=E.distanceToPoint(y.b),j=E.distanceToPoint(y.c);Vn(z)&&(z=0),Vn(V)&&(V=0),Vn(j)&&(j=0);let W=z*V,ct=z*j;if(W>0&&ct>0)return!1;i.copy(E.normal),s.copy(M.normal);let pt=i.cross(s),_t=0,Ht=Math.abs(pt.x),ee=Math.abs(pt.y);ee>Ht&&(Ht=ee,_t=1),Math.abs(pt.z)>Ht&&(_t=2);let Qt=aA[_t],$=this.a[Qt],tt=this.b[Qt],St=this.c[Qt],Pt=y.a[Qt],wt=y.b[Qt],te=y.c[Qt];if(g(this,$,tt,St,L,N,S,I,P,f,a))return u(this,y,b,T);if(g(y,Pt,wt,te,W,ct,z,V,j,h,c))return u(this,y,b,T);if(f.y<f.x){let fe=f.y;f.y=f.x,f.x=fe,l.copy(a.start),a.start.copy(a.end),a.end.copy(l)}if(h.y<h.x){let fe=h.y;h.y=h.x,h.x=fe,l.copy(c.start),c.start.copy(c.end),c.end.copy(l)}return f.y<h.x||h.y<f.x?!1:(b&&(h.x>f.x?b.start.copy(c.start):b.start.copy(a.start),h.y<f.y?b.end.copy(c.end):b.end.copy(a.end)),!0)}})();tn.prototype.distanceToPoint=(function(){let r=new R;return function(e){return this.closestPointToPoint(e,r),e.distanceTo(r)}})();tn.prototype.distanceToTriangle=(function(){let r=new R,t=new R,e=["a","b","c"],n=new dn,i=new dn;return function(o,a=null,c=null){let l=a||c?n:null;if(this.intersectsTriangle(o,l))return(a||c)&&(a&&l.getCenter(a),c&&l.getCenter(c)),0;let f=1/0;for(let h=0;h<3;h++){let u,d=e[h],g=o[d];this.closestPointToPoint(g,r),u=g.distanceToSquared(r),u<f&&(f=u,a&&a.copy(r),c&&c.copy(g));let x=this[d];o.closestPointToPoint(x,r),u=x.distanceToSquared(r),u<f&&(f=u,a&&a.copy(x),c&&c.copy(r))}for(let h=0;h<3;h++){let u=e[h],d=e[(h+1)%3];n.set(this[u],this[d]);for(let g=0;g<3;g++){let x=e[g],p=e[(g+1)%3];i.set(o[x],o[p]),Ma(n,i,r,t);let m=r.distanceToSquared(t);m<f&&(f=m,a&&a.copy(r),c&&c.copy(t))}}return Math.sqrt(f)}})();var Le=class{constructor(t,e,n){this.isOrientedBox=!0,this.min=new R,this.max=new R,this.matrix=new gt,this.invMatrix=new gt,this.points=new Array(8).fill().map(()=>new R),this.satAxes=new Array(3).fill().map(()=>new R),this.satBounds=new Array(3).fill().map(()=>new Dn),this.alignedSatBounds=new Array(3).fill().map(()=>new Dn),this.needsUpdate=!1,t&&this.min.copy(t),e&&this.max.copy(e),n&&this.matrix.copy(n)}set(t,e,n){this.min.copy(t),this.max.copy(e),this.matrix.copy(n),this.needsUpdate=!0}copy(t){this.min.copy(t.min),this.max.copy(t.max),this.matrix.copy(t.matrix),this.needsUpdate=!0}};Le.prototype.update=(function(){return function(){let t=this.matrix,e=this.min,n=this.max,i=this.points;for(let l=0;l<=1;l++)for(let f=0;f<=1;f++)for(let h=0;h<=1;h++){let u=1*l|2*f|4*h,d=i[u];d.x=l?n.x:e.x,d.y=f?n.y:e.y,d.z=h?n.z:e.z,d.applyMatrix4(t)}let s=this.satBounds,o=this.satAxes,a=i[0];for(let l=0;l<3;l++){let f=o[l],h=s[l],u=1<<l,d=i[u];f.subVectors(a,d),h.setFromPoints(f,i)}let c=this.alignedSatBounds;c[0].setFromPointsField(i,"x"),c[1].setFromPointsField(i,"y"),c[2].setFromPointsField(i,"z"),this.invMatrix.copy(this.matrix).invert(),this.needsUpdate=!1}})();Le.prototype.intersectsBox=(function(){let r=new Dn;return function(e){this.needsUpdate&&this.update();let n=e.min,i=e.max,s=this.satBounds,o=this.satAxes,a=this.alignedSatBounds;if(r.min=n.x,r.max=i.x,a[0].isSeparated(r)||(r.min=n.y,r.max=i.y,a[1].isSeparated(r))||(r.min=n.z,r.max=i.z,a[2].isSeparated(r)))return!1;for(let c=0;c<3;c++){let l=o[c],f=s[c];if(r.setFromBox(l,e),f.isSeparated(r))return!1}return!0}})();Le.prototype.intersectsTriangle=(function(){let r=new tn,t=new Array(3),e=new Dn,n=new Dn,i=new R;return function(o){this.needsUpdate&&this.update(),o.isExtendedTriangle?o.needsUpdate&&o.update():(r.copy(o),r.update(),o=r);let a=this.satBounds,c=this.satAxes;t[0]=o.a,t[1]=o.b,t[2]=o.c;for(let u=0;u<3;u++){let d=a[u],g=c[u];if(e.setFromPoints(g,t),d.isSeparated(e))return!1}let l=o.satBounds,f=o.satAxes,h=this.points;for(let u=0;u<3;u++){let d=l[u],g=f[u];if(e.setFromPoints(g,h),d.isSeparated(e))return!1}for(let u=0;u<3;u++){let d=c[u];for(let g=0;g<4;g++){let x=f[g];if(i.crossVectors(d,x),e.setFromPoints(i,t),n.setFromPoints(i,h),e.isSeparated(n))return!1}}return!0}})();Le.prototype.closestPointToPoint=(function(){return function(t,e){return this.needsUpdate&&this.update(),e.copy(t).applyMatrix4(this.invMatrix).clamp(this.min,this.max).applyMatrix4(this.matrix),e}})();Le.prototype.distanceToPoint=(function(){let r=new R;return function(e){return this.closestPointToPoint(e,r),e.distanceTo(r)}})();Le.prototype.distanceToBox=(function(){let r=["x","y","z"],t=new Array(12).fill().map(()=>new dn),e=new Array(12).fill().map(()=>new dn),n=new R,i=new R;return function(o,a=0,c=null,l=null){if(this.needsUpdate&&this.update(),this.intersectsBox(o))return(c||l)&&(o.getCenter(i),this.closestPointToPoint(i,n),o.closestPointToPoint(n,i),c&&c.copy(n),l&&l.copy(i)),0;let f=a*a,h=o.min,u=o.max,d=this.points,g=1/0;for(let p=0;p<8;p++){let m=d[p];i.copy(m).clamp(h,u);let v=m.distanceToSquared(i);if(v<g&&(g=v,c&&c.copy(m),l&&l.copy(i),v<f))return Math.sqrt(v)}let x=0;for(let p=0;p<3;p++)for(let m=0;m<=1;m++)for(let v=0;v<=1;v++){let _=(p+1)%3,y=(p+2)%3,b=m<<_|v<<y,T=1<<p|m<<_|v<<y,w=d[b],E=d[T];t[x].set(w,E);let S=r[p],I=r[_],P=r[y],L=e[x],N=L.start,z=L.end;N[S]=h[S],N[I]=m?h[I]:u[I],N[P]=v?h[P]:u[I],z[S]=u[S],z[I]=m?h[I]:u[I],z[P]=v?h[P]:u[I],x++}for(let p=0;p<=1;p++)for(let m=0;m<=1;m++)for(let v=0;v<=1;v++){i.x=p?u.x:h.x,i.y=m?u.y:h.y,i.z=v?u.z:h.z,this.closestPointToPoint(i,n);let _=i.distanceToSquared(n);if(_<g&&(g=_,c&&c.copy(n),l&&l.copy(i),_<f))return Math.sqrt(_)}for(let p=0;p<12;p++){let m=t[p];for(let v=0;v<12;v++){let _=e[v];Ma(m,_,n,i);let y=n.distanceToSquared(i);if(y<g&&(g=y,c&&c.copy(n),l&&l.copy(i),y<f))return Math.sqrt(y)}}return Math.sqrt(g)}})();var Mp=class extends Zi{constructor(){super(()=>new tn)}},pn=new Mp;var Ta=new R,Tp=new R;function ax(r,t,e={},n=0,i=1/0){let s=n*n,o=i*i,a=1/0,c=null;if(r.shapecast({boundsTraverseOrder:f=>(Ta.copy(t).clamp(f.min,f.max),Ta.distanceToSquared(t)),intersectsBounds:(f,h,u)=>u<a&&u<o,intersectsTriangle:(f,h)=>{f.closestPointToPoint(t,Ta);let u=t.distanceToSquared(Ta);return u<a&&(Tp.copy(Ta),a=u,c=h),u<s}}),a===1/0)return null;let l=Math.sqrt(a);return e.point?e.point.copy(Tp):e.point=Tp.clone(),e.distance=l,e.faceIndex=c,e}var Ou=parseInt("180")>=169,cA=parseInt("180")<=161,zr=new R,kr=new R,Vr=new R,zu=new q,ku=new q,Vu=new q,cx=new R,lx=new R,ux=new R,wa=new R;function lA(r,t,e,n,i,s,o,a){let c;if(s===He?c=r.intersectTriangle(n,e,t,!0,i):c=r.intersectTriangle(t,e,n,s!==Sn,i),c===null)return null;let l=r.origin.distanceTo(i);return l<o||l>a?null:{distance:l,point:i.clone()}}function hx(r,t,e,n,i,s,o,a,c,l,f){zr.fromBufferAttribute(t,s),kr.fromBufferAttribute(t,o),Vr.fromBufferAttribute(t,a);let h=lA(r,zr,kr,Vr,wa,c,l,f);if(h){if(n){zu.fromBufferAttribute(n,s),ku.fromBufferAttribute(n,o),Vu.fromBufferAttribute(n,a),h.uv=new q;let d=$e.getInterpolation(wa,zr,kr,Vr,zu,ku,Vu,h.uv);Ou||(h.uv=d)}if(i){zu.fromBufferAttribute(i,s),ku.fromBufferAttribute(i,o),Vu.fromBufferAttribute(i,a),h.uv1=new q;let d=$e.getInterpolation(wa,zr,kr,Vr,zu,ku,Vu,h.uv1);Ou||(h.uv1=d),cA&&(h.uv2=h.uv1)}if(e){cx.fromBufferAttribute(e,s),lx.fromBufferAttribute(e,o),ux.fromBufferAttribute(e,a),h.normal=new R;let d=$e.getInterpolation(wa,zr,kr,Vr,cx,lx,ux,h.normal);h.normal.dot(r.direction)>0&&h.normal.multiplyScalar(-1),Ou||(h.normal=d)}let u={a:s,b:o,c:a,normal:new R,materialIndex:0};if($e.getNormal(zr,kr,Vr,u.normal),h.face=u,h.faceIndex=s,Ou){let d=new R;$e.getBarycoord(wa,zr,kr,Vr,d),h.barycoord=d}}return h}function fx(r){return r&&r.isMaterial?r.side:r}function $s(r,t,e,n,i,s,o){let a=n*3,c=a+0,l=a+1,f=a+2,{index:h,groups:u}=r;r.index&&(c=h.getX(c),l=h.getX(l),f=h.getX(f));let{position:d,normal:g,uv:x,uv1:p}=r.attributes;if(Array.isArray(t)){let m=n*3;for(let v=0,_=u.length;v<_;v++){let{start:y,count:b,materialIndex:T}=u[v];if(m>=y&&m<y+b){let w=fx(t[T]),E=hx(e,d,g,x,p,c,l,f,w,s,o);if(E)if(E.faceIndex=n,E.face.materialIndex=T,i)i.push(E);else return E}}}else{let m=fx(t),v=hx(e,d,g,x,p,c,l,f,m,s,o);if(v)if(v.faceIndex=n,v.face.materialIndex=0,i)i.push(v);else return v}return null}function be(r,t,e,n){let i=r.a,s=r.b,o=r.c,a=t,c=t+1,l=t+2;e&&(a=e.getX(a),c=e.getX(c),l=e.getX(l)),i.x=n.getX(a),i.y=n.getY(a),i.z=n.getZ(a),s.x=n.getX(c),s.y=n.getY(c),s.z=n.getZ(c),o.x=n.getX(l),o.y=n.getY(l),o.z=n.getZ(l)}function dx(r,t,e,n,i,s,o,a){let{geometry:c,_indirectBuffer:l}=r;for(let f=n,h=n+i;f<h;f++)$s(c,t,e,f,s,o,a)}function px(r,t,e,n,i,s,o){let{geometry:a,_indirectBuffer:c}=r,l=1/0,f=null;for(let h=n,u=n+i;h<u;h++){let d;d=$s(a,t,e,h,null,s,o),d&&d.distance<l&&(f=d,l=d.distance)}return f}function mx(r,t,e,n,i,s,o){let{geometry:a}=e,{index:c}=a,l=a.attributes.position;for(let f=r,h=t+r;f<h;f++){let u;if(u=f,be(o,u*3,c,l),o.needsUpdate=!0,n(o,u,i,s))return!0}return!1}function gx(r,t=null){t&&Array.isArray(t)&&(t=new Set(t));let e=r.geometry,n=e.index?e.index.array:null,i=e.attributes.position,s,o,a,c,l=0,f=r._roots;for(let u=0,d=f.length;u<d;u++)s=f[u],o=new Uint32Array(s),a=new Uint16Array(s),c=new Float32Array(s),h(0,l),l+=s.byteLength;function h(u,d,g=!1){let x=u*2;if(le(x,a)){let p=o[u+6],m=a[x+14],v=1/0,_=1/0,y=1/0,b=-1/0,T=-1/0,w=-1/0;for(let E=3*p,M=3*(p+m);E<M;E++){let S=n[E],I=i.getX(S),P=i.getY(S),L=i.getZ(S);I<v&&(v=I),I>b&&(b=I),P<_&&(_=P),P>T&&(T=P),L<y&&(y=L),L>w&&(w=L)}return c[u+0]!==v||c[u+1]!==_||c[u+2]!==y||c[u+3]!==b||c[u+4]!==T||c[u+5]!==w?(c[u+0]=v,c[u+1]=_,c[u+2]=y,c[u+3]=b,c[u+4]=T,c[u+5]=w,!0):!1}else{let p=xe(u),m=ve(u,o),v=g,_=!1,y=!1;if(t){if(!v){let S=p/8+d/32,I=m/8+d/32;_=t.has(S),y=t.has(I),v=!_&&!y}}else _=!0,y=!0;let b=v||_,T=v||y,w=!1;b&&(w=h(p,d,v));let E=!1;T&&(E=h(m,d,v));let M=w||E;if(M)for(let S=0;S<3;S++){let I=p+S,P=m+S,L=c[I],N=c[I+3],z=c[P],V=c[P+3];c[u+S]=L<z?L:z,c[u+S+3]=N>V?N:V}return M}}}function Hn(r,t,e,n,i){let s,o,a,c,l,f,h=1/e.direction.x,u=1/e.direction.y,d=1/e.direction.z,g=e.origin.x,x=e.origin.y,p=e.origin.z,m=t[r],v=t[r+3],_=t[r+1],y=t[r+3+1],b=t[r+2],T=t[r+3+2];return h>=0?(s=(m-g)*h,o=(v-g)*h):(s=(v-g)*h,o=(m-g)*h),u>=0?(a=(_-x)*u,c=(y-x)*u):(a=(y-x)*u,c=(_-x)*u),s>c||a>o||((a>s||isNaN(s))&&(s=a),(c<o||isNaN(o))&&(o=c),d>=0?(l=(b-p)*d,f=(T-p)*d):(l=(T-p)*d,f=(b-p)*d),s>f||l>o)?!1:((l>s||s!==s)&&(s=l),(f<o||o!==o)&&(o=f),s<=i&&o>=n)}function xx(r,t,e,n,i,s,o,a){let{geometry:c,_indirectBuffer:l}=r;for(let f=n,h=n+i;f<h;f++){let u=l?l[f]:f;$s(c,t,e,u,s,o,a)}}function vx(r,t,e,n,i,s,o){let{geometry:a,_indirectBuffer:c}=r,l=1/0,f=null;for(let h=n,u=n+i;h<u;h++){let d;d=$s(a,t,e,c?c[h]:h,null,s,o),d&&d.distance<l&&(f=d,l=d.distance)}return f}function _x(r,t,e,n,i,s,o){let{geometry:a}=e,{index:c}=a,l=a.attributes.position;for(let f=r,h=t+r;f<h;f++){let u;if(u=e.resolveTriangleIndex(f),be(o,u*3,c,l),o.needsUpdate=!0,n(o,u,i,s))return!0}return!1}function yx(r,t,e,n,i,s,o){ae.setBuffer(r._roots[t]),wp(0,r,e,n,i,s,o),ae.clearBuffer()}function wp(r,t,e,n,i,s,o){let{float32Array:a,uint16Array:c,uint32Array:l}=ae,f=r*2;if(le(f,c)){let u=Ie(r,l),d=Fe(f,c);dx(t,e,n,u,d,i,s,o)}else{let u=xe(r);Hn(u,a,n,s,o)&&wp(u,t,e,n,i,s,o);let d=ve(r,l);Hn(d,a,n,s,o)&&wp(d,t,e,n,i,s,o)}}var uA=["x","y","z"];function bx(r,t,e,n,i,s){ae.setBuffer(r._roots[t]);let o=Ap(0,r,e,n,i,s);return ae.clearBuffer(),o}function Ap(r,t,e,n,i,s){let{float32Array:o,uint16Array:a,uint32Array:c}=ae,l=r*2;if(le(l,a)){let h=Ie(r,c),u=Fe(l,a);return px(t,e,n,h,u,i,s)}else{let h=Yi(r,c),u=uA[h],g=n.direction[u]>=0,x,p;g?(x=xe(r),p=ve(r,c)):(x=ve(r,c),p=xe(r));let v=Hn(x,o,n,i,s)?Ap(x,t,e,n,i,s):null;if(v){let b=v.point[u];if(g?b<=o[p+h]:b>=o[p+h+3])return v}let y=Hn(p,o,n,i,s)?Ap(p,t,e,n,i,s):null;return v&&y?v.distance<=y.distance?v:y:v||y||null}}var Hu=new se,Zs=new tn,Js=new tn,Aa=new gt,Sx=new Le,Gu=new Le;function Mx(r,t,e,n){ae.setBuffer(r._roots[t]);let i=Ep(0,r,e,n);return ae.clearBuffer(),i}function Ep(r,t,e,n,i=null){let{float32Array:s,uint16Array:o,uint32Array:a}=ae,c=r*2;if(i===null&&(e.boundingBox||e.computeBoundingBox(),Sx.set(e.boundingBox.min,e.boundingBox.max,n),i=Sx),le(c,o)){let f=t.geometry,h=f.index,u=f.attributes.position,d=e.index,g=e.attributes.position,x=Ie(r,a),p=Fe(c,o);if(Aa.copy(n).invert(),e.boundsTree)return ye(r,s,Gu),Gu.matrix.copy(Aa),Gu.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:v=>Gu.intersectsBox(v),intersectsTriangle:v=>{v.a.applyMatrix4(n),v.b.applyMatrix4(n),v.c.applyMatrix4(n),v.needsUpdate=!0;for(let _=x*3,y=(p+x)*3;_<y;_+=3)if(be(Js,_,h,u),Js.needsUpdate=!0,v.intersectsTriangle(Js))return!0;return!1}});{let m=Ki(e);for(let v=x*3,_=(p+x)*3;v<_;v+=3){be(Zs,v,h,u),Zs.a.applyMatrix4(Aa),Zs.b.applyMatrix4(Aa),Zs.c.applyMatrix4(Aa),Zs.needsUpdate=!0;for(let y=0,b=m*3;y<b;y+=3)if(be(Js,y,d,g),Js.needsUpdate=!0,Zs.intersectsTriangle(Js))return!0}}}else{let f=xe(r),h=ve(r,a);return ye(f,s,Hu),!!(i.intersectsBox(Hu)&&Ep(f,t,e,n,i)||(ye(h,s,Hu),i.intersectsBox(Hu)&&Ep(h,t,e,n,i)))}}var Wu=new gt,Rp=new Le,Ea=new Le,hA=new R,fA=new R,dA=new R,pA=new R;function Tx(r,t,e,n={},i={},s=0,o=1/0){t.boundingBox||t.computeBoundingBox(),Rp.set(t.boundingBox.min,t.boundingBox.max,e),Rp.needsUpdate=!0;let a=r.geometry,c=a.attributes.position,l=a.index,f=t.attributes.position,h=t.index,u=pn.getPrimitive(),d=pn.getPrimitive(),g=hA,x=fA,p=null,m=null;i&&(p=dA,m=pA);let v=1/0,_=null,y=null;return Wu.copy(e).invert(),Ea.matrix.copy(Wu),r.shapecast({boundsTraverseOrder:b=>Rp.distanceToBox(b),intersectsBounds:(b,T,w)=>w<v&&w<o?(T&&(Ea.min.copy(b.min),Ea.max.copy(b.max),Ea.needsUpdate=!0),!0):!1,intersectsRange:(b,T)=>{if(t.boundsTree)return t.boundsTree.shapecast({boundsTraverseOrder:E=>Ea.distanceToBox(E),intersectsBounds:(E,M,S)=>S<v&&S<o,intersectsRange:(E,M)=>{for(let S=E,I=E+M;S<I;S++){be(d,3*S,h,f),d.a.applyMatrix4(e),d.b.applyMatrix4(e),d.c.applyMatrix4(e),d.needsUpdate=!0;for(let P=b,L=b+T;P<L;P++){be(u,3*P,l,c),u.needsUpdate=!0;let N=u.distanceToTriangle(d,g,p);if(N<v&&(x.copy(g),m&&m.copy(p),v=N,_=P,y=S),N<s)return!0}}}});{let w=Ki(t);for(let E=0,M=w;E<M;E++){be(d,3*E,h,f),d.a.applyMatrix4(e),d.b.applyMatrix4(e),d.c.applyMatrix4(e),d.needsUpdate=!0;for(let S=b,I=b+T;S<I;S++){be(u,3*S,l,c),u.needsUpdate=!0;let P=u.distanceToTriangle(d,g,p);if(P<v&&(x.copy(g),m&&m.copy(p),v=P,_=S,y=E),P<s)return!0}}}}}),pn.releasePrimitive(u),pn.releasePrimitive(d),v===1/0?null:(n.point?n.point.copy(x):n.point=x.clone(),n.distance=v,n.faceIndex=_,i&&(i.point?i.point.copy(m):i.point=m.clone(),i.point.applyMatrix4(Wu),x.applyMatrix4(Wu),i.distance=x.sub(i.point).length(),i.faceIndex=y),n)}function wx(r,t=null){t&&Array.isArray(t)&&(t=new Set(t));let e=r.geometry,n=e.index?e.index.array:null,i=e.attributes.position,s,o,a,c,l=0,f=r._roots;for(let u=0,d=f.length;u<d;u++)s=f[u],o=new Uint32Array(s),a=new Uint16Array(s),c=new Float32Array(s),h(0,l),l+=s.byteLength;function h(u,d,g=!1){let x=u*2;if(le(x,a)){let p=o[u+6],m=a[x+14],v=1/0,_=1/0,y=1/0,b=-1/0,T=-1/0,w=-1/0;for(let E=p,M=p+m;E<M;E++){let S=3*r.resolveTriangleIndex(E);for(let I=0;I<3;I++){let P=S+I;P=n?n[P]:P;let L=i.getX(P),N=i.getY(P),z=i.getZ(P);L<v&&(v=L),L>b&&(b=L),N<_&&(_=N),N>T&&(T=N),z<y&&(y=z),z>w&&(w=z)}}return c[u+0]!==v||c[u+1]!==_||c[u+2]!==y||c[u+3]!==b||c[u+4]!==T||c[u+5]!==w?(c[u+0]=v,c[u+1]=_,c[u+2]=y,c[u+3]=b,c[u+4]=T,c[u+5]=w,!0):!1}else{let p=xe(u),m=ve(u,o),v=g,_=!1,y=!1;if(t){if(!v){let S=p/8+d/32,I=m/8+d/32;_=t.has(S),y=t.has(I),v=!_&&!y}}else _=!0,y=!0;let b=v||_,T=v||y,w=!1;b&&(w=h(p,d,v));let E=!1;T&&(E=h(m,d,v));let M=w||E;if(M)for(let S=0;S<3;S++){let I=p+S,P=m+S,L=c[I],N=c[I+3],z=c[P],V=c[P+3];c[u+S]=L<z?L:z,c[u+S+3]=N>V?N:V}return M}}}function Ax(r,t,e,n,i,s,o){ae.setBuffer(r._roots[t]),Cp(0,r,e,n,i,s,o),ae.clearBuffer()}function Cp(r,t,e,n,i,s,o){let{float32Array:a,uint16Array:c,uint32Array:l}=ae,f=r*2;if(le(f,c)){let u=Ie(r,l),d=Fe(f,c);xx(t,e,n,u,d,i,s,o)}else{let u=xe(r);Hn(u,a,n,s,o)&&Cp(u,t,e,n,i,s,o);let d=ve(r,l);Hn(d,a,n,s,o)&&Cp(d,t,e,n,i,s,o)}}var mA=["x","y","z"];function Ex(r,t,e,n,i,s){ae.setBuffer(r._roots[t]);let o=Ip(0,r,e,n,i,s);return ae.clearBuffer(),o}function Ip(r,t,e,n,i,s){let{float32Array:o,uint16Array:a,uint32Array:c}=ae,l=r*2;if(le(l,a)){let h=Ie(r,c),u=Fe(l,a);return vx(t,e,n,h,u,i,s)}else{let h=Yi(r,c),u=mA[h],g=n.direction[u]>=0,x,p;g?(x=xe(r),p=ve(r,c)):(x=ve(r,c),p=xe(r));let v=Hn(x,o,n,i,s)?Ip(x,t,e,n,i,s):null;if(v){let b=v.point[u];if(g?b<=o[p+h]:b>=o[p+h+3])return v}let y=Hn(p,o,n,i,s)?Ip(p,t,e,n,i,s):null;return v&&y?v.distance<=y.distance?v:y:v||y||null}}var Xu=new se,Ks=new tn,Qs=new tn,Ra=new gt,Rx=new Le,qu=new Le;function Cx(r,t,e,n){ae.setBuffer(r._roots[t]);let i=Pp(0,r,e,n);return ae.clearBuffer(),i}function Pp(r,t,e,n,i=null){let{float32Array:s,uint16Array:o,uint32Array:a}=ae,c=r*2;if(i===null&&(e.boundingBox||e.computeBoundingBox(),Rx.set(e.boundingBox.min,e.boundingBox.max,n),i=Rx),le(c,o)){let f=t.geometry,h=f.index,u=f.attributes.position,d=e.index,g=e.attributes.position,x=Ie(r,a),p=Fe(c,o);if(Ra.copy(n).invert(),e.boundsTree)return ye(r,s,qu),qu.matrix.copy(Ra),qu.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:v=>qu.intersectsBox(v),intersectsTriangle:v=>{v.a.applyMatrix4(n),v.b.applyMatrix4(n),v.c.applyMatrix4(n),v.needsUpdate=!0;for(let _=x,y=p+x;_<y;_++)if(be(Qs,3*t.resolveTriangleIndex(_),h,u),Qs.needsUpdate=!0,v.intersectsTriangle(Qs))return!0;return!1}});{let m=Ki(e);for(let v=x,_=p+x;v<_;v++){let y=t.resolveTriangleIndex(v);be(Ks,3*y,h,u),Ks.a.applyMatrix4(Ra),Ks.b.applyMatrix4(Ra),Ks.c.applyMatrix4(Ra),Ks.needsUpdate=!0;for(let b=0,T=m*3;b<T;b+=3)if(be(Qs,b,d,g),Qs.needsUpdate=!0,Ks.intersectsTriangle(Qs))return!0}}}else{let f=xe(r),h=ve(r,a);return ye(f,s,Xu),!!(i.intersectsBox(Xu)&&Pp(f,t,e,n,i)||(ye(h,s,Xu),i.intersectsBox(Xu)&&Pp(h,t,e,n,i)))}}var Yu=new gt,Dp=new Le,Ca=new Le,gA=new R,xA=new R,vA=new R,_A=new R;function Ix(r,t,e,n={},i={},s=0,o=1/0){t.boundingBox||t.computeBoundingBox(),Dp.set(t.boundingBox.min,t.boundingBox.max,e),Dp.needsUpdate=!0;let a=r.geometry,c=a.attributes.position,l=a.index,f=t.attributes.position,h=t.index,u=pn.getPrimitive(),d=pn.getPrimitive(),g=gA,x=xA,p=null,m=null;i&&(p=vA,m=_A);let v=1/0,_=null,y=null;return Yu.copy(e).invert(),Ca.matrix.copy(Yu),r.shapecast({boundsTraverseOrder:b=>Dp.distanceToBox(b),intersectsBounds:(b,T,w)=>w<v&&w<o?(T&&(Ca.min.copy(b.min),Ca.max.copy(b.max),Ca.needsUpdate=!0),!0):!1,intersectsRange:(b,T)=>{if(t.boundsTree){let w=t.boundsTree;return w.shapecast({boundsTraverseOrder:E=>Ca.distanceToBox(E),intersectsBounds:(E,M,S)=>S<v&&S<o,intersectsRange:(E,M)=>{for(let S=E,I=E+M;S<I;S++){let P=w.resolveTriangleIndex(S);be(d,3*P,h,f),d.a.applyMatrix4(e),d.b.applyMatrix4(e),d.c.applyMatrix4(e),d.needsUpdate=!0;for(let L=b,N=b+T;L<N;L++){let z=r.resolveTriangleIndex(L);be(u,3*z,l,c),u.needsUpdate=!0;let V=u.distanceToTriangle(d,g,p);if(V<v&&(x.copy(g),m&&m.copy(p),v=V,_=L,y=S),V<s)return!0}}}})}else{let w=Ki(t);for(let E=0,M=w;E<M;E++){be(d,3*E,h,f),d.a.applyMatrix4(e),d.b.applyMatrix4(e),d.c.applyMatrix4(e),d.needsUpdate=!0;for(let S=b,I=b+T;S<I;S++){let P=r.resolveTriangleIndex(S);be(u,3*P,l,c),u.needsUpdate=!0;let L=u.distanceToTriangle(d,g,p);if(L<v&&(x.copy(g),m&&m.copy(p),v=L,_=S,y=E),L<s)return!0}}}}}),pn.releasePrimitive(u),pn.releasePrimitive(d),v===1/0?null:(n.point?n.point.copy(x):n.point=x.clone(),n.distance=v,n.faceIndex=_,i&&(i.point?i.point.copy(m):i.point=m.clone(),i.point.applyMatrix4(Yu),x.applyMatrix4(Yu),i.distance=x.sub(i.point).length(),i.faceIndex=y),n)}var Ia=new ae.constructor,$u=new ae.constructor,Qi=new Zi(()=>new se),js=new se,to=new se,Fp=new se,Lp=new se,Np=!1;function Px(r,t,e,n){if(Np)throw new Error("MeshBVH: Recursive calls to bvhcast not supported.");Np=!0;let i=r._roots,s=t._roots,o,a=0,c=0,l=new gt().copy(e).invert();for(let f=0,h=i.length;f<h;f++){Ia.setBuffer(i[f]),c=0;let u=Qi.getPrimitive();ye(0,Ia.float32Array,u),u.applyMatrix4(l);for(let d=0,g=s.length;d<g&&($u.setBuffer(s[d]),o=Kn(0,0,e,l,n,a,c,0,0,u),$u.clearBuffer(),c+=s[d].byteLength/32,!o);d++);if(Qi.releasePrimitive(u),Ia.clearBuffer(),a+=i[f].byteLength/32,o)break}return Np=!1,o}function Kn(r,t,e,n,i,s=0,o=0,a=0,c=0,l=null,f=!1){let h,u;f?(h=$u,u=Ia):(h=Ia,u=$u);let d=h.float32Array,g=h.uint32Array,x=h.uint16Array,p=u.float32Array,m=u.uint32Array,v=u.uint16Array,_=r*2,y=t*2,b=le(_,x),T=le(y,v),w=!1;if(T&&b)f?w=i(Ie(t,m),Fe(t*2,v),Ie(r,g),Fe(r*2,x),c,o+t/8,a,s+r/8):w=i(Ie(r,g),Fe(r*2,x),Ie(t,m),Fe(t*2,v),a,s+r/8,c,o+t/8);else if(T){let E=Qi.getPrimitive();ye(t,p,E),E.applyMatrix4(e);let M=xe(r),S=ve(r,g);ye(M,d,js),ye(S,d,to);let I=E.intersectsBox(js),P=E.intersectsBox(to);w=I&&Kn(t,M,n,e,i,o,s,c,a+1,E,!f)||P&&Kn(t,S,n,e,i,o,s,c,a+1,E,!f),Qi.releasePrimitive(E)}else{let E=xe(t),M=ve(t,m);ye(E,p,Fp),ye(M,p,Lp);let S=l.intersectsBox(Fp),I=l.intersectsBox(Lp);if(S&&I)w=Kn(r,E,e,n,i,s,o,a,c+1,l,f)||Kn(r,M,e,n,i,s,o,a,c+1,l,f);else if(S)if(b)w=Kn(r,E,e,n,i,s,o,a,c+1,l,f);else{let P=Qi.getPrimitive();P.copy(Fp).applyMatrix4(e);let L=xe(r),N=ve(r,g);ye(L,d,js),ye(N,d,to);let z=P.intersectsBox(js),V=P.intersectsBox(to);w=z&&Kn(E,L,n,e,i,o,s,c,a+1,P,!f)||V&&Kn(E,N,n,e,i,o,s,c,a+1,P,!f),Qi.releasePrimitive(P)}else if(I)if(b)w=Kn(r,M,e,n,i,s,o,a,c+1,l,f);else{let P=Qi.getPrimitive();P.copy(Lp).applyMatrix4(e);let L=xe(r),N=ve(r,g);ye(L,d,js),ye(N,d,to);let z=P.intersectsBox(js),V=P.intersectsBox(to);w=z&&Kn(M,L,n,e,i,o,s,c,a+1,P,!f)||V&&Kn(M,N,n,e,i,o,s,c,a+1,P,!f),Qi.releasePrimitive(P)}}return w}function Up(r,t,e){return r===null?null:(r.point.applyMatrix4(t.matrixWorld),r.distance=r.point.distanceTo(e.ray.origin),r.object=t,r)}function Dx(){return typeof SharedArrayBuffer<"u"}function yA(r,t){let e=r[r.length-1],n=e.offset+e.count>2**16,i=r.reduce((l,f)=>l+f.count,0),s=n?4:2,o=t?new SharedArrayBuffer(i*s):new ArrayBuffer(i*s),a=n?new Uint32Array(o):new Uint16Array(o),c=0;for(let l=0;l<r.length;l++){let{offset:f,count:h}=r[l];for(let u=0;u<h;u++)a[c+u]=f+u;c+=h}return a}var Zu=class extends Bu{get indirect(){return!!this._indirectBuffer}get primitiveStride(){return null}get primitiveBufferStride(){return this.indirect?1:this.primitiveStride}set primitiveBufferStride(t){}get primitiveBuffer(){return this.indirect?this._indirectBuffer:this.geometry.index.array}set primitiveBuffer(t){}constructor(t,e={}){if(t.isBufferGeometry){if(t.index&&t.index.isInterleavedBufferAttribute)throw new Error("BVH: InterleavedBufferAttribute is not supported for the index attribute.")}else throw new Error("BVH: Only BufferGeometries are supported.");if(e.useSharedArrayBuffer&&!Dx())throw new Error("BVH: SharedArrayBuffer is not available.");super(),this.geometry=t,this.resolvePrimitiveIndex=e.indirect?n=>this._indirectBuffer[n]:n=>n,this.primitiveBuffer=null,this.primitiveBufferStride=null,this._indirectBuffer=null,e={...Iu,...e},e[_a]||this.init(e)}init(t){let{geometry:e,primitiveStride:n}=this;if(t.indirect){let i=Sa(e,t.range,n),s=yA(i,t.useSharedArrayBuffer);this._indirectBuffer=s}else ix(e,t);super.init(t),!e.boundingBox&&t.setBoundingBox&&(e.boundingBox=this.getBoundingBox(new se))}computePrimitiveBounds(){throw new Error("BVH: computePrimitiveBounds() not implemented")}getRootRanges(t){return this.indirect?[{offset:0,count:this._indirectBuffer.length}]:Sa(this.geometry,t,this.primitiveStride)}raycastObject3D(){throw new Error("BVH: raycastObject3D() not implemented")}shapecast(t){let{iterateDirect:e,iterateIndirect:n,...i}=t,s=this.indirect?n:e;return super.shapecast({...i,iterate:s})}};var Ju=new Le,Ku=new ii,Fx=new R,Lx=new gt,Nx=new R,Qu=class r extends Zu{static serialize(t,e={}){e={cloneBuffers:!0,...e};let n=t.geometry,i=t._roots,s=t._indirectBuffer,o=n.getIndex(),a={version:1,roots:null,index:null,indirectBuffer:null};return e.cloneBuffers?(a.roots=i.map(c=>c.slice()),a.index=o?o.array.slice():null,a.indirectBuffer=s?s.slice():null):(a.roots=i,a.index=o?o.array:null,a.indirectBuffer=s),a}static deserialize(t,e,n={}){n={setIndex:!0,indirect:!!t.indirectBuffer,...n};let{index:i,roots:s,indirectBuffer:o}=t;t.version||(console.warn("MeshBVH.deserialize: Serialization format has been changed and will be fixed up. It is recommended to regenerate any stored serialized data."),c(s));let a=new r(e,{...n,[_a]:!0});if(a._roots=s,a._indirectBuffer=o||null,n.setIndex){let l=e.getIndex();if(l===null){let f=new Ot(t.index,1,!1);e.setIndex(f)}else l.array!==i&&(l.array.set(i),l.needsUpdate=!0)}return a;function c(l){for(let f=0;f<l.length;f++){let h=l[f],u=new Uint32Array(h),d=new Uint16Array(h);for(let g=0,x=h.byteLength/32;g<x;g++){let p=8*g,m=2*p;le(m,d)||(u[p+6]=u[p+6]/8-g)}}}}get primitiveStride(){return 3}get resolveTriangleIndex(){return this.resolvePrimitiveIndex}constructor(t,e={}){e.maxLeafTris&&(e={...e,maxLeafSize:e.maxLeafTris}),super(t,e)}shiftTriangleOffsets(t){return super.shiftPrimitiveOffsets(t)}computePrimitiveBounds(t,e,n){let i=this.geometry,s=this._indirectBuffer,o=i.attributes.position,a=i.index?i.index.array:null,c=o.normalized;if(t<0||e+t-n.offset>n.length/6)throw new Error("MeshBVH: compute triangle bounds range is invalid.");let l=o.array,f=o.offset||0,h=3;o.isInterleavedBufferAttribute&&(h=o.data.stride);let u=["getX","getY","getZ"],d=n.offset;for(let g=t,x=t+e;g<x;g++){let m=(s?s[g]:g)*3,v=(g-d)*6,_=m+0,y=m+1,b=m+2;a&&(_=a[_],y=a[y],b=a[b]),c||(_=_*h+f,y=y*h+f,b=b*h+f);for(let T=0;T<3;T++){let w,E,M;c?(w=o[u[T]](_),E=o[u[T]](y),M=o[u[T]](b)):(w=l[_+T],E=l[y+T],M=l[b+T]);let S=w;E<S&&(S=E),M<S&&(S=M);let I=w;E>I&&(I=E),M>I&&(I=M);let P=(I-S)/2,L=T*2;n[v+L+0]=S+P,n[v+L+1]=P+(Math.abs(S)+P)*Y0}}return n}raycastObject3D(t,e,n=[]){let{material:i}=t;if(i===void 0)return;Lx.copy(t.matrixWorld).invert(),Ku.copy(e.ray).applyMatrix4(Lx),Nx.setFromMatrixScale(t.matrixWorld),Fx.copy(Ku.direction).multiply(Nx);let s=Fx.length(),o=e.near/s,a=e.far/s;if(e.firstHitOnly===!0){let c=this.raycastFirst(Ku,i,o,a);c=Up(c,t,e),c&&n.push(c)}else{let c=this.raycast(Ku,i,o,a);for(let l=0,f=c.length;l<f;l++){let h=Up(c[l],t,e);h&&n.push(h)}}return n}refit(t=null){return(this.indirect?wx:gx)(this,t)}raycast(t,e=yn,n=0,i=1/0){let s=this._roots,o=[],a=this.indirect?Ax:yx;for(let c=0,l=s.length;c<l;c++)a(this,c,e,t,o,n,i);return o}raycastFirst(t,e=yn,n=0,i=1/0){let s=this._roots,o=null,a=this.indirect?Ex:bx;for(let c=0,l=s.length;c<l;c++){let f=a(this,c,e,t,n,i);f!=null&&(o==null||f.distance<o.distance)&&(o=f)}return o}intersectsGeometry(t,e){let n=!1,i=this._roots,s=this.indirect?Cx:Mx;for(let o=0,a=i.length;o<a&&(n=s(this,o,t,e),!n);o++);return n}shapecast(t){let e=pn.getPrimitive(),n=super.shapecast({...t,intersectsPrimitive:t.intersectsTriangle,scratchPrimitive:e,iterateDirect:mx,iterateIndirect:_x});return pn.releasePrimitive(e),n}bvhcast(t,e,n){let{intersectsRanges:i,intersectsTriangles:s}=n,o=pn.getPrimitive(),a=this.geometry.index,c=this.geometry.attributes.position,l=this.indirect?g=>{let x=this.resolveTriangleIndex(g);be(o,x*3,a,c)}:g=>{be(o,g*3,a,c)},f=pn.getPrimitive(),h=t.geometry.index,u=t.geometry.attributes.position,d=t.indirect?g=>{let x=t.resolveTriangleIndex(g);be(f,x*3,h,u)}:g=>{be(f,g*3,h,u)};if(s){let g=(x,p,m,v,_,y,b,T)=>{for(let w=m,E=m+v;w<E;w++){d(w),f.a.applyMatrix4(e),f.b.applyMatrix4(e),f.c.applyMatrix4(e),f.needsUpdate=!0;for(let M=x,S=x+p;M<S;M++)if(l(M),o.needsUpdate=!0,s(o,f,M,w,_,y,b,T))return!0}return!1};if(i){let x=i;i=function(p,m,v,_,y,b,T,w){return x(p,m,v,_,y,b,T,w)?!0:g(p,m,v,_,y,b,T,w)}}else i=g}return Px(this,t,e,i)}intersectsBox(t,e){return Ju.set(t.min,t.max,e),Ju.needsUpdate=!0,this.shapecast({intersectsBounds:n=>Ju.intersectsBox(n),intersectsTriangle:n=>Ju.intersectsTriangle(n)})}intersectsSphere(t){return this.shapecast({intersectsBounds:e=>t.intersectsBox(e),intersectsTriangle:e=>e.intersectsSphere(t)})}closestPointToGeometry(t,e,n={},i={},s=0,o=1/0){return(this.indirect?Ix:Tx)(this,t,e,n,i,s,o)}closestPointToPoint(t,e={},n=0,i=1/0){return ax(this,t,e,n,i)}};function bA(r){switch(r){case 1:return"R";case 2:return"RG";case 3:return"RGBA";case 4:return"RGBA"}throw new Error}function SA(r){switch(r){case 1:return Jn;case 2:return Fr;case 3:return Gt;case 4:return Gt}}function Ux(r){switch(r){case 1:return Dr;case 2:return Wi;case 3:return Xi;case 4:return Xi}}var ju=class extends oe{constructor(){super(),this.minFilter=Vt,this.magFilter=Vt,this.generateMipmaps=!1,this.overrideItemSize=null,this._forcedType=null}updateFrom(t){let e=this.overrideItemSize,n=t.itemSize,i=t.count;if(e!==null){if(n*i%e!==0)throw new Error("VertexAttributeTexture: overrideItemSize must divide evenly into buffer length.");t.itemSize=e,t.count=i*n/e}let s=t.itemSize,o=t.count,a=t.normalized,c=t.array.constructor,l=c.BYTES_PER_ELEMENT,f=this._forcedType,h=s;if(f===null)switch(c){case Float32Array:f=$t;break;case Uint8Array:case Uint16Array:case Uint32Array:f=an;break;case Int8Array:case Int16Array:case Int32Array:f=Gi;break}let u,d,g,x,p=bA(s);switch(f){case $t:g=1,d=SA(s),a&&l===1?(x=c,p+="8",c===Uint8Array?u=on:(u=Bs,p+="_SNORM")):(x=Float32Array,p+="32F",u=$t);break;case Gi:p+=l*8+"I",g=a?Math.pow(2,c.BYTES_PER_ELEMENT*8-1):1,d=Ux(s),l===1?(x=Int8Array,u=Bs):l===2?(x=Int16Array,u=da):(x=Int32Array,u=Gi);break;case an:p+=l*8+"UI",g=a?Math.pow(2,c.BYTES_PER_ELEMENT*8-1):1,d=Ux(s),l===1?(x=Uint8Array,u=on):l===2?(x=Uint16Array,u=Hi):(x=Uint32Array,u=an);break}h===3&&(d===Gt||d===Xi)&&(h=4);let m=Math.ceil(Math.sqrt(o))||1,v=h*m*m,_=new x(v),y=t.normalized;t.normalized=!1;for(let b=0;b<o;b++){let T=h*b;_[T]=t.getX(b)/g,s>=2&&(_[T+1]=t.getY(b)/g),s>=3&&(_[T+2]=t.getZ(b)/g,h===4&&(_[T+3]=1)),s>=4&&(_[T+3]=t.getW(b)/g)}t.normalized=y,this.internalFormat=p,this.format=d,this.type=u,this.image.width=m,this.image.height=m,this.image.data=_,this.needsUpdate=!0,this.dispose(),t.itemSize=n,t.count=i}},eo=class extends ju{constructor(){super(),this._forcedType=an}};var no=class extends ju{constructor(){super(),this._forcedType=$t}};var th=class{constructor(){this.index=new eo,this.position=new no,this.bvhBounds=new oe,this.bvhContents=new oe,this._cachedIndexAttr=null,this.index.overrideItemSize=3}updateFrom(t){let{geometry:e}=t;if(TA(t,this.bvhBounds,this.bvhContents),this.position.updateFrom(e.attributes.position),t.indirect){let n=t._indirectBuffer;if(this._cachedIndexAttr===null||this._cachedIndexAttr.count!==n.length)if(e.index)this._cachedIndexAttr=e.index.clone();else{let i=Sp(ba(e));this._cachedIndexAttr=new Ot(i,1,!1)}MA(e,n,this._cachedIndexAttr),this.index.updateFrom(this._cachedIndexAttr)}else this.index.updateFrom(e.index)}dispose(){let{index:t,position:e,bvhBounds:n,bvhContents:i}=this;t&&t.dispose(),e&&e.dispose(),n&&n.dispose(),i&&i.dispose()}};function MA(r,t,e){let n=e.array,i=r.index?r.index.array:null;for(let s=0,o=t.length;s<o;s++){let a=3*s,c=3*t[s];for(let l=0;l<3;l++)n[a+l]=i?i[c+l]:c+l}}function TA(r,t,e){let n=r._roots;if(n.length!==1)throw new Error("MeshBVHUniformStruct: Multi-root BVHs not supported.");let i=n[0],s=new Uint16Array(i),o=new Uint32Array(i),a=new Float32Array(i),c=i.byteLength/32,l=2*Math.ceil(Math.sqrt(c/2)),f=new Float32Array(4*l*l),h=Math.ceil(Math.sqrt(c)),u=new Uint32Array(2*h*h);for(let d=0;d<c;d++){let g=d*32/4,x=g*2,p=g;for(let m=0;m<3;m++)f[8*d+0+m]=a[p+0+m],f[8*d+4+m]=a[p+3+m];if(le(x,s)){let m=Fe(x,s),v=Ie(g,o),_=-65536|m;u[d*2+0]=_,u[d*2+1]=v}else{let m=o[g+6],v=Yi(g,o);u[d*2+0]=v,u[d*2+1]=m}}t.image.data=f,t.image.width=l,t.image.height=l,t.format=Gt,t.type=$t,t.internalFormat="RGBA32F",t.minFilter=Vt,t.magFilter=Vt,t.generateMipmaps=!1,t.needsUpdate=!0,t.dispose(),e.image.data=u,e.image.width=h,e.image.height=h,e.format=Wi,e.type=an,e.internalFormat="RG32UI",e.minFilter=Vt,e.magFilter=Vt,e.generateMipmaps=!1,e.needsUpdate=!0,e.dispose()}var Hr={};Wv(Hr,{bvh_distance_functions:()=>Bx,bvh_ray_functions:()=>Op,bvh_struct_definitions:()=>Ox,common_functions:()=>Bp});var Bp=`

// A stack of uint32 indices can can store the indices for
// a perfectly balanced tree with a depth up to 31. Lower stack
// depth gets higher performance.
//
// However not all trees are balanced. Best value to set this to
// is the trees max depth.
#ifndef BVH_STACK_DEPTH
#define BVH_STACK_DEPTH 60
#endif

#ifndef INFINITY
#define INFINITY 1e20
#endif

// Utilities
uvec4 uTexelFetch1D( usampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

ivec4 iTexelFetch1D( isampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 texelFetch1D( sampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 textureSampleBarycoord( sampler2D tex, vec3 barycoord, uvec3 faceIndices ) {

	return
		barycoord.x * texelFetch1D( tex, faceIndices.x ) +
		barycoord.y * texelFetch1D( tex, faceIndices.y ) +
		barycoord.z * texelFetch1D( tex, faceIndices.z );

}

void ndcToCameraRay(
	vec2 coord, mat4 cameraWorld, mat4 invProjectionMatrix,
	out vec3 rayOrigin, out vec3 rayDirection
) {

	// get camera look direction and near plane for camera clipping
	vec4 lookDirection = cameraWorld * vec4( 0.0, 0.0, - 1.0, 0.0 );
	vec4 nearVector = invProjectionMatrix * vec4( 0.0, 0.0, - 1.0, 1.0 );
	float near = abs( nearVector.z / nearVector.w );

	// get the camera direction and position from camera matrices
	vec4 origin = cameraWorld * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec4 direction = invProjectionMatrix * vec4( coord, 0.5, 1.0 );
	direction /= direction.w;
	direction = cameraWorld * direction - origin;

	// slide the origin along the ray until it sits at the near clip plane position
	origin.xyz += direction.xyz * near / dot( direction, lookDirection );

	rayOrigin = origin.xyz;
	rayDirection = direction.xyz;

}
`;var Bx=`

float dot2( vec3 v ) {

	return dot( v, v );

}

// https://www.shadertoy.com/view/ttfGWl
vec3 closestPointToTriangle( vec3 p, vec3 v0, vec3 v1, vec3 v2, out vec3 barycoord ) {

    vec3 v10 = v1 - v0;
    vec3 v21 = v2 - v1;
    vec3 v02 = v0 - v2;

	vec3 p0 = p - v0;
	vec3 p1 = p - v1;
	vec3 p2 = p - v2;

    vec3 nor = cross( v10, v02 );

    // method 2, in barycentric space
    vec3  q = cross( nor, p0 );
    float d = 1.0 / dot2( nor );
    float u = d * dot( q, v02 );
    float v = d * dot( q, v10 );
    float w = 1.0 - u - v;

	if( u < 0.0 ) {

		w = clamp( dot( p2, v02 ) / dot2( v02 ), 0.0, 1.0 );
		u = 0.0;
		v = 1.0 - w;

	} else if( v < 0.0 ) {

		u = clamp( dot( p0, v10 ) / dot2( v10 ), 0.0, 1.0 );
		v = 0.0;
		w = 1.0 - u;

	} else if( w < 0.0 ) {

		v = clamp( dot( p1, v21 ) / dot2( v21 ), 0.0, 1.0 );
		w = 0.0;
		u = 1.0 - v;

	}

	barycoord = vec3( u, v, w );
    return u * v1 + v * v2 + w * v0;

}

float distanceToTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// point and cut off range
	vec3 point, float closestDistanceSquared,

	// outputs
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord, inout float side, inout vec3 outPoint
) {

	bool found = false;
	vec3 localBarycoord;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		// get the closest point and barycoord
		vec3 closestPoint = closestPointToTriangle( point, a, b, c, localBarycoord );
		vec3 delta = point - closestPoint;
		float sqDist = dot2( delta );
		if ( sqDist < closestDistanceSquared ) {

			// set the output results
			closestDistanceSquared = sqDist;
			faceIndices = uvec4( indices.xyz, i );
			faceNormal = normalize( cross( a - b, b - c ) );
			barycoord = localBarycoord;
			outPoint = closestPoint;
			side = sign( dot( faceNormal, delta ) );

		}

	}

	return closestDistanceSquared;

}

float distanceSqToBounds( vec3 point, vec3 boundsMin, vec3 boundsMax ) {

	vec3 clampedPoint = clamp( point, boundsMin, boundsMax );
	vec3 delta = point - clampedPoint;
	return dot( delta, delta );

}

float distanceSqToBVHNodeBoundsPoint( vec3 point, sampler2D bvhBounds, uint currNodeIndex ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return distanceSqToBounds( point, boundsMin, boundsMax );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhClosestPointToPoint(		bvh,		point, maxDistance, faceIndices, faceNormal, barycoord, side, outPoint	)	_bvhClosestPointToPoint(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		point, maxDistance, faceIndices, faceNormal, barycoord, side, outPoint	)

float _bvhClosestPointToPoint(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// point to check
	vec3 point, float maxDistance,

	// output variables
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout vec3 outPoint
 ) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float closestDistanceSquared = maxDistance * maxDistance;
	bool found = false;
	while ( ptr > - 1 && ptr < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

		// check if we intersect the current bounds
		float boundsHitDistance = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, currNodeIndex );
		if ( boundsHitDistance > closestDistanceSquared ) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );
		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;
			closestDistanceSquared = distanceToTriangles(
				bvh_position, bvh_index, offset, count, point, closestDistanceSquared,

				// outputs
				faceIndices, faceNormal, barycoord, side, outPoint
			);

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = currNodeIndex + boundsInfo.y;
			bool leftToRight = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, leftIndex ) < distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, rightIndex );//rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			ptr ++;
			stack[ ptr ] = c2;
			ptr ++;
			stack[ ptr ] = c1;

		}

	}

	return sqrt( closestDistanceSquared );

}
`;var Op=`

#ifndef TRI_INTERSECT_EPSILON
#define TRI_INTERSECT_EPSILON 1e-5
#endif

// Raycasting
bool intersectsBounds( vec3 rayOrigin, vec3 rayDirection, vec3 boundsMin, vec3 boundsMax, out float dist ) {

	// https://www.reddit.com/r/opengl/comments/8ntzz5/fast_glsl_ray_box_intersection/
	// https://tavianator.com/2011/ray_box.html
	vec3 invDir = 1.0 / rayDirection;

	// find intersection distances for each plane
	vec3 tMinPlane = invDir * ( boundsMin - rayOrigin );
	vec3 tMaxPlane = invDir * ( boundsMax - rayOrigin );

	// get the min and max distances from each intersection
	vec3 tMinHit = min( tMaxPlane, tMinPlane );
	vec3 tMaxHit = max( tMaxPlane, tMinPlane );

	// get the furthest hit distance
	vec2 t = max( tMinHit.xx, tMinHit.yz );
	float t0 = max( t.x, t.y );

	// get the minimum hit distance
	t = min( tMaxHit.xx, tMaxHit.yz );
	float t1 = min( t.x, t.y );

	// set distance to 0.0 if the ray starts inside the box
	dist = max( t0, 0.0 );

	return t1 >= dist;

}

bool intersectsTriangle(
	vec3 rayOrigin, vec3 rayDirection, vec3 a, vec3 b, vec3 c,
	out vec3 barycoord, out vec3 norm, out float dist, out float side
) {

	// https://stackoverflow.com/questions/42740765/intersection-between-line-and-triangle-in-3d
	vec3 edge1 = b - a;
	vec3 edge2 = c - a;
	norm = cross( edge1, edge2 );

	float det = - dot( rayDirection, norm );
	float invdet = 1.0 / det;

	vec3 AO = rayOrigin - a;
	vec3 DAO = cross( AO, rayDirection );

	vec4 uvt;
	uvt.x = dot( edge2, DAO ) * invdet;
	uvt.y = - dot( edge1, DAO ) * invdet;
	uvt.z = dot( AO, norm ) * invdet;
	uvt.w = 1.0 - uvt.x - uvt.y;

	// set the hit information
	barycoord = uvt.wxy; // arranged in A, B, C order
	dist = uvt.z;
	side = sign( det );
	norm = side * normalize( norm );

	// add an epsilon to avoid misses between triangles
	uvt += vec4( TRI_INTERSECT_EPSILON );

	return all( greaterThanEqual( uvt, vec4( 0.0 ) ) );

}

bool intersectTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// outputs
	inout float minDistance, inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	bool found = false;
	vec3 localBarycoord, localNormal;
	float localDist, localSide;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		if (
			intersectsTriangle( rayOrigin, rayDirection, a, b, c, localBarycoord, localNormal, localDist, localSide )
			&& localDist < minDistance
		) {

			found = true;
			minDistance = localDist;

			faceIndices = uvec4( indices.xyz, i );
			faceNormal = localNormal;

			side = localSide;
			barycoord = localBarycoord;
			dist = localDist;

		}

	}

	return found;

}

bool intersectsBVHNodeBounds( vec3 rayOrigin, vec3 rayDirection, sampler2D bvhBounds, uint currNodeIndex, out float dist ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return intersectsBounds( rayOrigin, rayDirection, boundsMin, boundsMax, dist );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhIntersectFirstHit(		bvh,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)	_bvhIntersectFirstHit(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)

bool _bvhIntersectFirstHit(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// output variables split into separate variables due to output precision
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float triangleDistance = INFINITY;
	bool found = false;
	while ( ptr > - 1 && ptr < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

		// check if we intersect the current bounds
		float boundsHitDistance;
		if (
			! intersectsBVHNodeBounds( rayOrigin, rayDirection, bvh_bvhBounds, currNodeIndex, boundsHitDistance )
			|| boundsHitDistance > triangleDistance
		) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );

		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;

			found = intersectTriangles(
				bvh_position, bvh_index, offset, count,
				rayOrigin, rayDirection, triangleDistance,
				faceIndices, faceNormal, barycoord, side, dist
			) || found;

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = currNodeIndex + boundsInfo.y;

			bool leftToRight = rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			ptr ++;
			stack[ ptr ] = c2;

			ptr ++;
			stack[ ptr ] = c1;

		}

	}

	return found;

}
`;var Ox=`
struct BVH {

	usampler2D index;
	sampler2D position;

	sampler2D bvhBounds;
	usampler2D bvhContents;

};
`;var pC=`
	${Bp}
	${Op}
`;function eh(r,t,e=0){if(r.isInterleavedBufferAttribute){let n=r.itemSize;for(let i=0,s=r.count;i<s;i++){let o=i+e;t.setX(o,r.getX(i)),n>=2&&t.setY(o,r.getY(i)),n>=3&&t.setZ(o,r.getZ(i)),n>=4&&t.setW(o,r.getW(i))}}else{let n=t.array,i=n.constructor,s=n.BYTES_PER_ELEMENT*r.itemSize*e;new i(n.buffer,s,r.array.length).set(r.array)}}function Gr(r,t=null){let e=r.array.constructor,n=r.normalized,i=r.itemSize,s=t===null?r.count:t;return new Ot(new e(i*s),i,n)}function ji(r,t){if(!r&&!t)return!0;if(!!r!=!!t)return!1;let e=r.count===t.count,n=r.normalized===t.normalized,i=r.array.constructor===t.array.constructor,s=r.itemSize===t.itemSize;return!(!e||!n||!i||!s)}function wA(r){let t=r[0].index!==null,e=new Set(Object.keys(r[0].attributes));if(!r[0].getAttribute("position"))throw new Error("StaticGeometryGenerator: position attribute is required.");for(let n=0;n<r.length;++n){let i=r[n],s=0;if(t!==(i.index!==null))throw new Error("StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.");for(let o in i.attributes){if(!e.has(o))throw new Error('StaticGeometryGenerator: All geometries must have compatible attributes; make sure "'+o+'" attribute exists among all geometries, or in none of them.');s++}if(s!==e.size)throw new Error("StaticGeometryGenerator: All geometries must have the same number of attributes.")}}function AA(r){let t=0;for(let e=0,n=r.length;e<n;e++)t+=r[e].getIndex().count;return t}function EA(r){let t=0;for(let e=0,n=r.length;e<n;e++)t+=r[e].getAttribute("position").count;return t}function RA(r,t,e){r.index&&r.index.count!==t&&r.setIndex(null);let n=r.attributes;for(let i in n)n[i].count!==e&&r.deleteAttribute(i)}function zx(r,t={},e=new Ft){let{useGroups:n=!1,forceUpdate:i=!1,skipAssigningAttributes:s=[],overwriteIndex:o=!0}=t;wA(r);let a=r[0].index!==null,c=a?AA(r):-1,l=EA(r);if(RA(e,c,l),n){let h=0;for(let u=0,d=r.length;u<d;u++){let g=r[u],x;a?x=g.getIndex().count:x=g.getAttribute("position").count,e.addGroup(h,x,u),h+=x}}if(a){let h=!1;if(e.index||(e.setIndex(new Ot(new Uint32Array(c),1,!1)),h=!0),h||o){let u=0,d=0,g=e.getIndex();for(let x=0,p=r.length;x<p;x++){let m=r[x],v=m.getIndex();if(!(!i&&!h&&s[x]))for(let y=0;y<v.count;++y)g.setX(u+y,v.getX(y)+d);u+=v.count,d+=m.getAttribute("position").count}}}let f=Object.keys(r[0].attributes);for(let h=0,u=f.length;h<u;h++){let d=!1,g=f[h];if(!e.getAttribute(g)){let m=r[0].getAttribute(g);e.setAttribute(g,Gr(m,l)),d=!0}let x=0,p=e.getAttribute(g);for(let m=0,v=r.length;m<v;m++){let _=r[m],y=!i&&!d&&s[m],b=_.getAttribute(g);if(!y)if(g==="color"&&p.itemSize!==b.itemSize)for(let T=x,w=b.count;T<w;T++)b.setXYZW(T,p.getX(T),p.getY(T),p.getZ(T),1);else eh(b,p,x);x+=b.count}}}function kx(r,t,e){let n=r.index,s=r.attributes.position.count,o=n?n.count:s,a=r.groups;a.length===0&&(a=[{count:o,start:0,materialIndex:0}]);let c=r.getAttribute("materialIndex");if(!c||c.count!==s){let f;e.length<=255?f=new Uint8Array(s):f=new Uint16Array(s),c=new Ot(f,1,!1),r.deleteAttribute("materialIndex"),r.setAttribute("materialIndex",c)}let l=c.array;for(let f=0;f<a.length;f++){let h=a[f],u=h.start,d=h.count,g=Math.min(d,o-u),x=Array.isArray(t)?t[h.materialIndex]:t,p=e.indexOf(x);for(let m=0;m<g;m++){let v=u+m;n&&(v=n.getX(v)),l[v]=p}}}function Vx(r,t){if(!r.index){let e=r.attributes.position.count,n=new Array(e);for(let i=0;i<e;i++)n[i]=i;r.setIndex(n)}if(!r.attributes.normal&&t&&t.includes("normal")&&r.computeVertexNormals(),!r.attributes.uv&&t&&t.includes("uv")){let e=r.attributes.position.count;r.setAttribute("uv",new Ot(new Float32Array(e*2),2,!1))}if(!r.attributes.uv2&&t&&t.includes("uv2")){let e=r.attributes.position.count;r.setAttribute("uv2",new Ot(new Float32Array(e*2),2,!1))}if(!r.attributes.tangent&&t&&t.includes("tangent"))if(r.attributes.uv&&r.attributes.normal)r.computeTangents();else{let e=r.attributes.position.count;r.setAttribute("tangent",new Ot(new Float32Array(e*4),4,!1))}if(!r.attributes.color&&t&&t.includes("color")){let e=r.attributes.position.count,n=new Float32Array(e*4);n.fill(1),r.setAttribute("color",new Ot(n,4))}}function io(r){let t=0;if(r.byteLength!==0){let e=new Uint8Array(r);for(let n=0;n<r.byteLength;n++){let i=e[n];t=(t<<5)-t+i,t|=0}}return t}function Hx(r){let t=r.uuid,e=Object.values(r.attributes);r.index&&(e.push(r.index),t+=`index|${r.index.version}`);let n=Object.keys(e).sort();for(let i of n){let s=e[i];t+=`${i}_${s.version}|`}return t}function Gx(r){let t=r.skeleton;return t?(t.boneTexture||t.computeBoneTexture(),`${io(t.boneTexture.image.data.buffer)}_${t.boneTexture.uuid}`):null}var nh=class{constructor(t=null){this.matrixWorld=new gt,this.geometryHash=null,this.skeletonHash=null,this.primitiveCount=-1,t!==null&&this.updateFrom(t)}updateFrom(t){let e=t.geometry,n=(e.index?e.index.count:e.attributes.position.count)/3;this.matrixWorld.copy(t.matrixWorld),this.geometryHash=Hx(e),this.primitiveCount=n,this.skeletonHash=Gx(t)}didChange(t){let e=t.geometry,n=(e.index?e.index.count:e.attributes.position.count)/3;return!(this.matrixWorld.equals(t.matrixWorld)&&this.geometryHash===Hx(e)&&this.skeletonHash===Gx(t)&&this.primitiveCount===n)}};var Wr=new R,Xr=new R,qr=new R,Wx=new Kt,ih=new R,zp=new R,Xx=new Kt,qx=new Kt,rh=new gt,Yx=new gt;function $x(r,t,e){let n=r.skeleton,i=r.geometry,s=n.bones,o=n.boneInverses;Xx.fromBufferAttribute(i.attributes.skinIndex,t),qx.fromBufferAttribute(i.attributes.skinWeight,t),rh.elements.fill(0);for(let a=0;a<4;a++){let c=qx.getComponent(a);if(c!==0){let l=Xx.getComponent(a);Yx.multiplyMatrices(s[l].matrixWorld,o[l]),CA(rh,Yx,c)}}return rh.multiply(r.bindMatrix).premultiply(r.bindMatrixInverse),e.transformDirection(rh),e}function kp(r,t,e,n,i){ih.set(0,0,0);for(let s=0,o=r.length;s<o;s++){let a=t[s],c=r[s];a!==0&&(zp.fromBufferAttribute(c,n),e?ih.addScaledVector(zp,a):ih.addScaledVector(zp.sub(i),a))}i.add(ih)}function CA(r,t,e){let n=r.elements,i=t.elements;for(let s=0,o=i.length;s<o;s++)n[s]+=i[s]*e}function IA(r){let{index:t,attributes:e}=r;if(t)for(let n=0,i=t.count;n<i;n+=3){let s=t.getX(n),o=t.getX(n+2);t.setX(n,o),t.setX(n+2,s)}else for(let n in e){let i=e[n],s=i.itemSize;for(let o=0,a=i.count;o<a;o+=3)for(let c=0;c<s;c++){let l=i.getComponent(o,c),f=i.getComponent(o+2,c);i.setComponent(o,c,f),i.setComponent(o+2,c,l)}}return r}function Zx(r,t={},e=new Ft){t={applyWorldTransforms:!0,attributes:[],...t};let n=r.geometry,i=t.applyWorldTransforms,s=t.attributes.includes("normal"),o=t.attributes.includes("tangent"),a=n.attributes,c=e.attributes;for(let v in e.attributes)(!t.attributes.includes(v)||!(v in n.attributes))&&e.deleteAttribute(v);!e.index&&n.index&&(e.index=n.index.clone()),c.position||e.setAttribute("position",Gr(a.position)),s&&!c.normal&&a.normal&&e.setAttribute("normal",Gr(a.normal)),o&&!c.tangent&&a.tangent&&e.setAttribute("tangent",Gr(a.tangent)),ji(n.index,e.index),ji(a.position,c.position),s&&ji(a.normal,c.normal),o&&ji(a.tangent,c.tangent);let l=a.position,f=s?a.normal:null,h=o?a.tangent:null,u=n.morphAttributes.position,d=n.morphAttributes.normal,g=n.morphAttributes.tangent,x=n.morphTargetsRelative,p=r.morphTargetInfluences,m=new Xt;m.getNormalMatrix(r.matrixWorld),n.index&&e.index.array.set(n.index.array);for(let v=0,_=a.position.count;v<_;v++)Wr.fromBufferAttribute(l,v),f&&Xr.fromBufferAttribute(f,v),h&&(Wx.fromBufferAttribute(h,v),qr.fromBufferAttribute(h,v)),p&&(u&&kp(u,p,x,v,Wr),d&&kp(d,p,x,v,Xr),g&&kp(g,p,x,v,qr)),r.isSkinnedMesh&&(r.applyBoneTransform(v,Wr),f&&$x(r,v,Xr),h&&$x(r,v,qr)),i&&Wr.applyMatrix4(r.matrixWorld),c.position.setXYZ(v,Wr.x,Wr.y,Wr.z),f&&(i&&Xr.applyNormalMatrix(m),c.normal.setXYZ(v,Xr.x,Xr.y,Xr.z)),h&&(i&&qr.transformDirection(r.matrixWorld),c.tangent.setXYZW(v,qr.x,qr.y,qr.z,Wx.w));for(let v in t.attributes){let _=t.attributes[v];_==="position"||_==="tangent"||_==="normal"||!(_ in a)||(c[_]||e.setAttribute(_,Gr(a[_])),ji(a[_],c[_]),eh(a[_],c[_]))}return r.matrixWorld.determinant()<0&&IA(e),e}var sh=class extends Ft{constructor(){super(),this.version=0,this.hash=null,this._diff=new nh}isCompatible(t,e){let n=t.geometry;for(let i=0;i<e.length;i++){let s=e[i],o=n.attributes[s],a=this.attributes[s];if(o&&!ji(o,a))return!1}return!0}updateFrom(t,e){let n=this._diff;return n.didChange(t)?(Zx(t,e,this),n.updateFrom(t),this.version++,this.hash=`${this.uuid}_${this.version}`,!0):!1}};var ah=0,Vp=1,Hp=2;function PA(r,t){for(let e=0,n=r.length;e<n;e++)r[e].traverseVisible(s=>{s.isMesh&&t(s)})}function DA(r){let t=[];for(let e=0,n=r.length;e<n;e++){let i=r[e];Array.isArray(i.material)?t.push(...i.material):t.push(i.material)}return t}function FA(r,t,e){if(r.length===0){t.setIndex(null);let n=t.attributes;for(let i in n)t.deleteAttribute(i);for(let i in e.attributes)t.setAttribute(e.attributes[i],new Ot(new Float32Array(0),4,!1))}else zx(r,e,t);for(let n in t.attributes)t.attributes[n].needsUpdate=!0}var oh=class{constructor(t){this.objects=null,this.useGroups=!0,this.applyWorldTransforms=!0,this.generateMissingAttributes=!0,this.overwriteIndex=!0,this.attributes=["position","normal","color","tangent","uv","uv2"],this._intermediateGeometry=new Map,this._geometryMergeSets=new WeakMap,this._mergeOrder=[],this._dummyMesh=null,this.setObjects(t||[])}_getDummyMesh(){if(!this._dummyMesh){let t=new zn,e=new Ft;e.setAttribute("position",new Ot(new Float32Array(9),3)),this._dummyMesh=new Me(e,t)}return this._dummyMesh}_getMeshes(){let t=[];return PA(this.objects,e=>{t.push(e)}),t.sort((e,n)=>e.uuid>n.uuid?1:e.uuid<n.uuid?-1:0),t.length===0&&t.push(this._getDummyMesh()),t}_updateIntermediateGeometries(){let{_intermediateGeometry:t}=this,e=this._getMeshes(),n=new Set(t.keys()),i={attributes:this.attributes,applyWorldTransforms:this.applyWorldTransforms};for(let s=0,o=e.length;s<o;s++){let a=e[s],c=a.uuid;n.delete(c);let l=t.get(c);(!l||!l.isCompatible(a,this.attributes))&&(l&&l.dispose(),l=new sh,t.set(c,l)),l.updateFrom(a,i)&&this.generateMissingAttributes&&Vx(l,this.attributes)}n.forEach(s=>{t.delete(s)})}setObjects(t){Array.isArray(t)?this.objects=[...t]:this.objects=[t]}generate(t=new Ft){let{useGroups:e,overwriteIndex:n,_intermediateGeometry:i,_geometryMergeSets:s}=this,o=this._getMeshes(),a=[],c=[],l=s.get(t)||[];this._updateIntermediateGeometries();let f=!1;o.length!==l.length&&(f=!0);for(let u=0,d=o.length;u<d;u++){let g=o[u],x=i.get(g.uuid);c.push(x);let p=l[u];!p||p.uuid!==x.uuid?(a.push(!1),f=!0):p.version!==x.version?a.push(!1):a.push(!0)}FA(c,t,{useGroups:e,forceUpdate:f,skipAssigningAttributes:a,overwriteIndex:n}),f&&t.dispose(),s.set(t,c.map(u=>({version:u.version,uuid:u.uuid})));let h=ah;return f?h=Hp:a.includes(!1)&&(h=Vp),{changeType:h,materials:DA(o),geometry:t}}};function LA(r){let t=new Set;for(let e=0,n=r.length;e<n;e++){let i=r[e];for(let s in i){let o=i[s];o&&o.isTexture&&t.add(o)}}return Array.from(t)}function NA(r){let t=[],e=new Set;for(let i=0,s=r.length;i<s;i++)r[i].traverse(o=>{o.visible&&(o.isRectAreaLight||o.isSpotLight||o.isPointLight||o.isDirectionalLight)&&(t.push(o),o.iesMap&&e.add(o.iesMap))});let n=Array.from(e).sort((i,s)=>i.uuid<s.uuid?1:i.uuid>s.uuid?-1:0);return{lights:t,iesTextures:n}}var ch=class{get initialized(){return!!this.bvh}constructor(t){this.bvhOptions={},this.attributes=["position","normal","tangent","color","uv","uv2"],this.generateBVH=!0,this.bvh=null,this.geometry=new Ft,this.staticGeometryGenerator=new oh(t),this._bvhWorker=null,this._pendingGenerate=null,this._buildAsync=!1,this._materialUuids=null}setObjects(t){this.staticGeometryGenerator.setObjects(t)}setBVHWorker(t){this._bvhWorker=t}async generateAsync(t=null){if(!this._bvhWorker)throw new Error('PathTracingSceneGenerator: "setBVHWorker" must be called before "generateAsync" can be called.');if(this.bvh instanceof Promise)return this._pendingGenerate||(this._pendingGenerate=new Promise(async()=>(await this.bvh,this._pendingGenerate=null,this.generateAsync(t)))),this._pendingGenerate;{this._buildAsync=!0;let e=this.generate(t);return this._buildAsync=!1,e.bvh=this.bvh=await e.bvh,e}}generate(t=null){let{staticGeometryGenerator:e,geometry:n,attributes:i}=this,s=e.objects;e.attributes=i,s.forEach(u=>{u.traverse(d=>{d.isSkinnedMesh&&d.skeleton&&d.skeleton.update()})});let o=e.generate(n),a=o.materials,c=o.changeType!==ah||this._materialUuids===null||this._materialUuids.length!==length;if(!c){for(let u=0,d=a.length;u<d;u++)if(a[u].uuid!==this._materialUuids[u]){c=!0;break}}let l=LA(a),{lights:f,iesTextures:h}=NA(s);if(c&&(kx(n,a,a),this._materialUuids=a.map(u=>u.uuid)),this.generateBVH){if(this.bvh instanceof Promise)throw new Error("PathTracingSceneGenerator: BVH is already building asynchronously.");if(o.changeType===Hp){let u={strategy:2,maxLeafTris:1,indirect:!0,onProgress:t,...this.bvhOptions};this._buildAsync?this.bvh=this._bvhWorker.generate(n,u):this.bvh=new Qu(n,u)}else o.changeType===Vp&&this.bvh.refit()}return{bvhChanged:o.changeType!==ah,bvh:this.bvh,needsMaterialIndexUpdate:c,lights:f,iesTextures:h,geometry:n,materials:a,textures:l,objects:s}}};var UA=new ki(-1,1,1,-1,0,1),Gp=class extends Ft{constructor(){super(),this.setAttribute("position",new bt([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new bt([0,2,0,0,2,0],2))}},BA=new Gp,Fn=class{constructor(t){this._mesh=new Me(BA,t)}dispose(){this._mesh.geometry.dispose()}render(t){t.render(this._mesh,UA)}get material(){return this._mesh.material}set material(t){this._mesh.material=t}};var li=class extends Ue{set needsUpdate(t){super.needsUpdate=!0,this.dispatchEvent({type:"recompilation"})}constructor(t){super(t);for(let e in this.uniforms)Object.defineProperty(this,e,{get(){return this.uniforms[e].value},set(n){this.uniforms[e].value=n}})}setDefine(t,e=void 0){if(e==null){if(t in this.defines)return delete this.defines[t],this.needsUpdate=!0,!0}else if(this.defines[t]!==e)return this.defines[t]=e,this.needsUpdate=!0,!0;return!1}};var lh=class extends li{constructor(t){super({blending:ke,uniforms:{target1:{value:null},target2:{value:null},opacity:{value:1}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`

				uniform float opacity;

				uniform sampler2D target1;
				uniform sampler2D target2;

				varying vec2 vUv;

				void main() {

					vec4 color1 = texture2D( target1, vUv );
					vec4 color2 = texture2D( target2, vUv );

					float invOpacity = 1.0 - opacity;
					float totalAlpha = color1.a * invOpacity + color2.a * opacity;

					if ( color1.a != 0.0 || color2.a != 0.0 ) {

						gl_FragColor.rgb = color1.rgb * ( invOpacity * color1.a / totalAlpha ) + color2.rgb * ( opacity * color2.a / totalAlpha );
						gl_FragColor.a = totalAlpha;

					} else {

						gl_FragColor = vec4( 0.0 );

					}

				}`}),this.setValues(t)}};function uh(r=1){let t="uint";return r>1&&(t="uvec"+r),`
		${t} sobolReverseBits( ${t} x ) {

			x = ( ( ( x & 0xaaaaaaaau ) >> 1 ) | ( ( x & 0x55555555u ) << 1 ) );
			x = ( ( ( x & 0xccccccccu ) >> 2 ) | ( ( x & 0x33333333u ) << 2 ) );
			x = ( ( ( x & 0xf0f0f0f0u ) >> 4 ) | ( ( x & 0x0f0f0f0fu ) << 4 ) );
			x = ( ( ( x & 0xff00ff00u ) >> 8 ) | ( ( x & 0x00ff00ffu ) << 8 ) );
			return ( ( x >> 16 ) | ( x << 16 ) );

		}

		${t} sobolHashCombine( uint seed, ${t} v ) {

			return seed ^ ( v + ${t}( ( seed << 6 ) + ( seed >> 2 ) ) );

		}

		${t} sobolLaineKarrasPermutation( ${t} x, ${t} seed ) {

			x += seed;
			x ^= x * 0x6c50b47cu;
			x ^= x * 0xb82f1e52u;
			x ^= x * 0xc7afe638u;
			x ^= x * 0x8d22f6e6u;
			return x;

		}

		${t} nestedUniformScrambleBase2( ${t} x, ${t} seed ) {

			x = sobolLaineKarrasPermutation( x, seed );
			x = sobolReverseBits( x );
			return x;

		}
	`}function hh(r=1){let t="uint",e="float",n="",i=".r",s="1u";return r>1&&(t="uvec"+r,e="vec"+r,n=r+"",r===2?(i=".rg",s="uvec2( 1u, 2u )"):r===3?(i=".rgb",s="uvec3( 1u, 2u, 3u )"):(i="",s="uvec4( 1u, 2u, 3u, 4u )")),`

		${e} sobol${n}( int effect ) {

			uint seed = sobolGetSeed( sobolBounceIndex, uint( effect ) );
			uint index = sobolPathIndex;

			uint shuffle_seed = sobolHashCombine( seed, 0u );
			uint shuffled_index = nestedUniformScrambleBase2( sobolReverseBits( index ), shuffle_seed );
			${e} sobol_pt = sobolGetTexturePoint( shuffled_index )${i};
			${t} result = ${t}( sobol_pt * 16777216.0 );

			${t} seed2 = sobolHashCombine( seed, ${s} );
			result = nestedUniformScrambleBase2( result, seed2 );

			return SOBOL_FACTOR * ${e}( result >> 8 );

		}
	`}var fh=`

	// Utils
	const float SOBOL_FACTOR = 1.0 / 16777216.0;
	const uint SOBOL_MAX_POINTS = 256u * 256u;

	${uh(1)}
	${uh(2)}
	${uh(3)}
	${uh(4)}

	uint sobolHash( uint x ) {

		// finalizer from murmurhash3
		x ^= x >> 16;
		x *= 0x85ebca6bu;
		x ^= x >> 13;
		x *= 0xc2b2ae35u;
		x ^= x >> 16;
		return x;

	}

`,Jx=`

	const uint SOBOL_DIRECTIONS_1[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0xa0000000u, 0xf0000000u,
		0x88000000u, 0xcc000000u, 0xaa000000u, 0xff000000u,
		0x80800000u, 0xc0c00000u, 0xa0a00000u, 0xf0f00000u,
		0x88880000u, 0xcccc0000u, 0xaaaa0000u, 0xffff0000u,
		0x80008000u, 0xc000c000u, 0xa000a000u, 0xf000f000u,
		0x88008800u, 0xcc00cc00u, 0xaa00aa00u, 0xff00ff00u,
		0x80808080u, 0xc0c0c0c0u, 0xa0a0a0a0u, 0xf0f0f0f0u,
		0x88888888u, 0xccccccccu, 0xaaaaaaaau, 0xffffffffu
	);

	const uint SOBOL_DIRECTIONS_2[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0x60000000u, 0x90000000u,
		0xe8000000u, 0x5c000000u, 0x8e000000u, 0xc5000000u,
		0x68800000u, 0x9cc00000u, 0xee600000u, 0x55900000u,
		0x80680000u, 0xc09c0000u, 0x60ee0000u, 0x90550000u,
		0xe8808000u, 0x5cc0c000u, 0x8e606000u, 0xc5909000u,
		0x6868e800u, 0x9c9c5c00u, 0xeeee8e00u, 0x5555c500u,
		0x8000e880u, 0xc0005cc0u, 0x60008e60u, 0x9000c590u,
		0xe8006868u, 0x5c009c9cu, 0x8e00eeeeu, 0xc5005555u
	);

	const uint SOBOL_DIRECTIONS_3[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0x20000000u, 0x50000000u,
		0xf8000000u, 0x74000000u, 0xa2000000u, 0x93000000u,
		0xd8800000u, 0x25400000u, 0x59e00000u, 0xe6d00000u,
		0x78080000u, 0xb40c0000u, 0x82020000u, 0xc3050000u,
		0x208f8000u, 0x51474000u, 0xfbea2000u, 0x75d93000u,
		0xa0858800u, 0x914e5400u, 0xdbe79e00u, 0x25db6d00u,
		0x58800080u, 0xe54000c0u, 0x79e00020u, 0xb6d00050u,
		0x800800f8u, 0xc00c0074u, 0x200200a2u, 0x50050093u
	);

	const uint SOBOL_DIRECTIONS_4[ 32 ] = uint[ 32 ](
		0x80000000u, 0x40000000u, 0x20000000u, 0xb0000000u,
		0xf8000000u, 0xdc000000u, 0x7a000000u, 0x9d000000u,
		0x5a800000u, 0x2fc00000u, 0xa1600000u, 0xf0b00000u,
		0xda880000u, 0x6fc40000u, 0x81620000u, 0x40bb0000u,
		0x22878000u, 0xb3c9c000u, 0xfb65a000u, 0xddb2d000u,
		0x78022800u, 0x9c0b3c00u, 0x5a0fb600u, 0x2d0ddb00u,
		0xa2878080u, 0xf3c9c040u, 0xdb65a020u, 0x6db2d0b0u,
		0x800228f8u, 0x400b3cdcu, 0x200fb67au, 0xb00ddb9du
	);

	uint getMaskedSobol( uint index, uint directions[ 32 ] ) {

		uint X = 0u;
		for ( int bit = 0; bit < 32; bit ++ ) {

			uint mask = ( index >> bit ) & 1u;
			X ^= mask * directions[ bit ];

		}
		return X;

	}

	vec4 generateSobolPoint( uint index ) {

		if ( index >= SOBOL_MAX_POINTS ) {

			return vec4( 0.0 );

		}

		// NOTE: this sobol "direction" is also available but we can't write out 5 components
		// uint x = index & 0x00ffffffu;
		uint x = sobolReverseBits( getMaskedSobol( index, SOBOL_DIRECTIONS_1 ) ) & 0x00ffffffu;
		uint y = sobolReverseBits( getMaskedSobol( index, SOBOL_DIRECTIONS_2 ) ) & 0x00ffffffu;
		uint z = sobolReverseBits( getMaskedSobol( index, SOBOL_DIRECTIONS_3 ) ) & 0x00ffffffu;
		uint w = sobolReverseBits( getMaskedSobol( index, SOBOL_DIRECTIONS_4 ) ) & 0x00ffffffu;

		return vec4( x, y, z, w ) * SOBOL_FACTOR;

	}

`,Kx=`

	// Seeds
	uniform sampler2D sobolTexture;
	uint sobolPixelIndex = 0u;
	uint sobolPathIndex = 0u;
	uint sobolBounceIndex = 0u;

	uint sobolGetSeed( uint bounce, uint effect ) {

		return sobolHash(
			sobolHashCombine(
				sobolHashCombine(
					sobolHash( bounce ),
					sobolPixelIndex
				),
				effect
			)
		);

	}

	vec4 sobolGetTexturePoint( uint index ) {

		if ( index >= SOBOL_MAX_POINTS ) {

			index = index % SOBOL_MAX_POINTS;

		}

		uvec2 dim = uvec2( textureSize( sobolTexture, 0 ).xy );
		uint y = index / dim.x;
		uint x = index - y * dim.x;
		vec2 uv = vec2( x, y ) / vec2( dim );
		return texture( sobolTexture, uv );

	}

	${hh(1)}
	${hh(2)}
	${hh(3)}
	${hh(4)}

`;var Wp=class extends li{constructor(){super({blending:ke,uniforms:{resolution:{value:new q}},vertexShader:`

				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,fragmentShader:`

				${fh}
				${Jx}

				varying vec2 vUv;
				uniform vec2 resolution;
				void main() {

					uint index = uint( gl_FragCoord.y ) * uint( resolution.x ) + uint( gl_FragCoord.x );
					gl_FragColor = generateSobolPoint( index );

				}
			`})}},dh=class{generate(t,e=256){let n=new ze(e,e,{type:$t,format:Gt,minFilter:Vt,magFilter:Vt,generateMipmaps:!1}),i=t.getRenderTarget();t.setRenderTarget(n);let s=new Fn(new Wp);return s.material.resolution.set(e,e),s.render(t),t.setRenderTarget(i),s.dispose(),n}};var Pa=class extends Re{set bokehSize(t){this.fStop=this.getFocalLength()/t}get bokehSize(){return this.getFocalLength()/this.fStop}constructor(...t){super(...t),this.fStop=1.4,this.apertureBlades=0,this.apertureRotation=0,this.focusDistance=25,this.anamorphicRatio=1}copy(t,e){return super.copy(t,e),this.fStop=t.fStop,this.apertureBlades=t.apertureBlades,this.apertureRotation=t.apertureRotation,this.focusDistance=t.focusDistance,this.anamorphicRatio=t.anamorphicRatio,this}};var ph=class{constructor(){this.bokehSize=0,this.apertureBlades=0,this.apertureRotation=0,this.focusDistance=10,this.anamorphicRatio=1}updateFrom(t){t instanceof Pa?(this.bokehSize=t.bokehSize,this.apertureBlades=t.apertureBlades,this.apertureRotation=t.apertureRotation,this.focusDistance=t.focusDistance,this.anamorphicRatio=t.anamorphicRatio):(this.bokehSize=0,this.apertureRotation=0,this.apertureBlades=0,this.focusDistance=10,this.anamorphicRatio=1)}};function mh(r){let t=new Uint16Array(r.length);for(let e=0,n=r.length;e<n;++e)t[e]=fn.toHalfFloat(r[e]);return t}function Qx(r,t,e=0,n=r.length){let i=e,s=e+n-1;for(;i<s;){let o=i+s>>1;r[o]<t?i=o+1:s=o}return i-e}function OA(r,t,e){return .2126*r+.7152*t+.0722*e}function zA(r,t=Ge){let e=r.clone();e.source=new Bn({...e.image});let{width:n,height:i,data:s}=e.image,o=s;if(e.type!==t){t===Ge?o=new Uint16Array(s.length):o=new Float32Array(s.length);let a;s instanceof Int8Array||s instanceof Int16Array||s instanceof Int32Array?a=2**(8*s.BYTES_PER_ELEMENT-1)-1:a=2**(8*s.BYTES_PER_ELEMENT)-1;for(let c=0,l=s.length;c<l;c++){let f=s[c];e.type===Ge&&(f=fn.fromHalfFloat(s[c])),e.type!==$t&&e.type!==Ge&&(f/=a),t===Ge&&(o[c]=fn.toHalfFloat(f))}e.image.data=o,e.type=t}if(e.flipY){let a=o;o=o.slice();for(let c=0;c<i;c++)for(let l=0;l<n;l++){let f=i-c-1,h=4*(c*n+l),u=4*(f*n+l);o[u+0]=a[h+0],o[u+1]=a[h+1],o[u+2]=a[h+2],o[u+3]=a[h+3]}e.flipY=!1,e.image.data=o}return e}var gh=class{constructor(){let t=new oe(mh(new Float32Array([0,0,0,0])),1,1);t.type=Ge,t.format=Gt,t.minFilter=re,t.magFilter=re,t.wrapS=Ke,t.wrapT=Ke,t.generateMipmaps=!1,t.needsUpdate=!0;let e=new oe(mh(new Float32Array([0,1])),1,2);e.type=Ge,e.format=Jn,e.minFilter=re,e.magFilter=re,e.generateMipmaps=!1,e.needsUpdate=!0;let n=new oe(mh(new Float32Array([0,0,1,1])),2,2);n.type=Ge,n.format=Jn,n.minFilter=re,n.magFilter=re,n.generateMipmaps=!1,n.needsUpdate=!0,this.map=t,this.marginalWeights=e,this.conditionalWeights=n,this.totalSum=0}dispose(){this.marginalWeights.dispose(),this.conditionalWeights.dispose(),this.map.dispose()}updateFrom(t){let e=zA(t);e.wrapS=Ke,e.wrapT=we;let{width:n,height:i,data:s}=e.image,o=new Float32Array(n*i),a=new Float32Array(n*i),c=new Float32Array(i),l=new Float32Array(i),f=0,h=0;for(let p=0;p<i;p++){let m=0;for(let v=0;v<n;v++){let _=p*n+v,y=fn.fromHalfFloat(s[4*_+0]),b=fn.fromHalfFloat(s[4*_+1]),T=fn.fromHalfFloat(s[4*_+2]),w=OA(y,b,T);m+=w,f+=w,o[_]=w,a[_]=m}if(m!==0)for(let v=p*n,_=p*n+n;v<_;v++)o[v]/=m,a[v]/=m;h+=m,c[p]=m,l[p]=h}if(h!==0)for(let p=0,m=c.length;p<m;p++)c[p]/=h,l[p]/=h;let u=new Uint16Array(i),d=new Uint16Array(n*i);for(let p=0;p<i;p++){let m=(p+1)/i,v=Qx(l,m);u[p]=fn.toHalfFloat((v+.5)/i)}for(let p=0;p<i;p++)for(let m=0;m<n;m++){let v=p*n+m,_=(m+1)/n,y=Qx(a,_,p*n,n);d[v]=fn.toHalfFloat((y+.5)/n)}this.dispose();let{marginalWeights:g,conditionalWeights:x}=this;g.image={width:i,height:1,data:u},g.needsUpdate=!0,x.image={width:n,height:i,data:d},x.needsUpdate=!0,this.totalSum=f,this.map=e}};var Xp=6,kA=0,VA=1,HA=2,GA=3,WA=4,Qn=new R,Mn=new R,jx=new gt,ro=new Ze,tv=new R,so=new R,XA=new R(0,1,0),xh=class{constructor(){let t=new oe(new Float32Array(4),1,1);t.format=Gt,t.type=$t,t.wrapS=we,t.wrapT=we,t.generateMipmaps=!1,t.minFilter=Vt,t.magFilter=Vt,this.tex=t,this.count=0}updateFrom(t,e=[]){let n=this.tex,i=Math.max(t.length*Xp,1),s=Math.ceil(Math.sqrt(i));n.image.width!==s&&(n.dispose(),n.image.data=new Float32Array(s*s*4),n.image.width=s,n.image.height=s);let o=n.image.data;for(let c=0,l=t.length;c<l;c++){let f=t[c],h=c*Xp*4,u=0;for(let g=0;g<Xp*4;g++)o[h+g]=0;f.getWorldPosition(Mn),o[h+u++]=Mn.x,o[h+u++]=Mn.y,o[h+u++]=Mn.z;let d=kA;if(f.isRectAreaLight&&f.isCircular?d=VA:f.isSpotLight?d=HA:f.isDirectionalLight?d=GA:f.isPointLight&&(d=WA),o[h+u++]=d,o[h+u++]=f.color.r,o[h+u++]=f.color.g,o[h+u++]=f.color.b,o[h+u++]=f.intensity,f.getWorldQuaternion(ro),f.isRectAreaLight)Qn.set(f.width,0,0).applyQuaternion(ro),o[h+u++]=Qn.x,o[h+u++]=Qn.y,o[h+u++]=Qn.z,u++,Mn.set(0,f.height,0).applyQuaternion(ro),o[h+u++]=Mn.x,o[h+u++]=Mn.y,o[h+u++]=Mn.z,o[h+u++]=Qn.cross(Mn).length()*(f.isCircular?Math.PI/4:1);else if(f.isSpotLight){let g=f.radius||0;tv.setFromMatrixPosition(f.matrixWorld),so.setFromMatrixPosition(f.target.matrixWorld),jx.lookAt(tv,so,XA),ro.setFromRotationMatrix(jx),Qn.set(1,0,0).applyQuaternion(ro),o[h+u++]=Qn.x,o[h+u++]=Qn.y,o[h+u++]=Qn.z,u++,Mn.set(0,1,0).applyQuaternion(ro),o[h+u++]=Mn.x,o[h+u++]=Mn.y,o[h+u++]=Mn.z,o[h+u++]=Math.PI*g*g,o[h+u++]=g,o[h+u++]=f.decay,o[h+u++]=f.distance,o[h+u++]=Math.cos(f.angle),o[h+u++]=Math.cos(f.angle*(1-f.penumbra)),o[h+u++]=f.iesMap?e.indexOf(f.iesMap):-1}else if(f.isPointLight){let g=Qn.setFromMatrixPosition(f.matrixWorld);o[h+u++]=g.x,o[h+u++]=g.y,o[h+u++]=g.z,u++,u+=4,u+=1,o[h+u++]=f.decay,o[h+u++]=f.distance}else if(f.isDirectionalLight){let g=Qn.setFromMatrixPosition(f.matrixWorld),x=Mn.setFromMatrixPosition(f.target.matrixWorld);so.subVectors(g,x).normalize(),o[h+u++]=so.x,o[h+u++]=so.y,o[h+u++]=so.z}}this.count=t.length;let a=io(o.buffer);return this.hash!==a?(this.hash=a,n.needsUpdate=!0,!0):!1}};function ev(r,t,e,n,i){if(t>n)throw new Error;let s=r.length/t,o=r.constructor.BYTES_PER_ELEMENT*8,a=1;switch(r.constructor){case Uint8Array:case Uint16Array:case Uint32Array:a=2**o-1;break;case Int8Array:case Int16Array:case Int32Array:a=2**(o-1)-1;break}for(let c=0;c<s;c++){let l=4*c,f=t*c;for(let h=0;h<n;h++)e[i+l+h]=t>=h+1?r[f+h]/a:0}}var vh=class extends Ui{constructor(){super(),this._textures=[],this.type=$t,this.format=Gt,this.internalFormat="RGBA32F"}updateAttribute(t,e){let n=this._textures[t];n.updateFrom(e);let i=n.image,s=this.image;if(i.width!==s.width||i.height!==s.height)throw new Error("FloatAttributeTextureArray: Attribute must be the same dimensions when updating single layer.");let{width:o,height:a,data:c}=s,f=o*a*4*t,h=e.itemSize;h===3&&(h=4),ev(n.image.data,h,c,4,f),this.dispose(),this.needsUpdate=!0}setAttributes(t){let e=t[0].count,n=t.length;for(let h=0,u=n;h<u;h++)if(t[h].count!==e)throw new Error("FloatAttributeTextureArray: All attributes must have the same item count.");let i=this._textures;for(;i.length<n;){let h=new no;i.push(h)}for(;i.length>n;)i.pop();for(let h=0,u=n;h<u;h++)i[h].updateFrom(t[h]);let o=i[0].image,a=this.image;(o.width!==a.width||o.height!==a.height||o.depth!==n)&&(a.width=o.width,a.height=o.height,a.depth=n,a.data=new Float32Array(a.width*a.height*a.depth*4));let{data:c,width:l,height:f}=a;for(let h=0,u=n;h<u;h++){let d=i[h],x=l*f*4*h,p=t[h].itemSize;p===3&&(p=4),ev(d.image.data,p,c,4,x)}this.dispose(),this.needsUpdate=!0}};var _h=class extends vh{updateNormalAttribute(t){this.updateAttribute(0,t)}updateTangentAttribute(t){this.updateAttribute(1,t)}updateUvAttribute(t){this.updateAttribute(2,t)}updateColorAttribute(t){this.updateAttribute(3,t)}updateFrom(t,e,n,i){this.setAttributes([t,e,n,i])}};function qp(r,t){return r.uuid<t.uuid?1:r.uuid>t.uuid?-1:0}function yh(r){return`${r.source.uuid}:${r.colorSpace}`}function qA(r){let t=new Set,e=[];for(let n=0,i=r.length;n<i;n++){let s=r[n],o=yh(s);t.has(o)||(t.add(o),e.push(s))}return e}function nv(r){let t=r.map(n=>n.iesMap||null).filter(n=>n),e=new Set(t);return Array.from(e).sort(qp)}function iv(r){let t=new Set;for(let n=0,i=r.length;n<i;n++){let s=r[n];for(let o in s){let a=s[o];a&&a.isTexture&&t.add(a)}}let e=Array.from(t);return qA(e).sort(qp)}function rv(r){let t=[];return r.traverse(e=>{e.visible&&(e.isRectAreaLight||e.isSpotLight||e.isPointLight||e.isDirectionalLight)&&t.push(e)}),t.sort(qp)}var Sh=47,sv=Sh*4,Yp=class{constructor(){this._features={}}isUsed(t){return t in this._features}setUsed(t,e=!0){e===!1?delete this._features[t]:this._features[t]=!0}reset(){this._features={}}},bh=class extends oe{constructor(){super(new Float32Array(4),1,1),this.format=Gt,this.type=$t,this.wrapS=we,this.wrapT=we,this.minFilter=Vt,this.magFilter=Vt,this.generateMipmaps=!1,this.features=new Yp}updateFrom(t,e){function n(g,x,p=-1){if(x in g&&g[x]){let m=yh(g[x]);return h[m]}else return p}function i(g,x,p){return x in g?g[x]:p}function s(g,x,p,m){let v=g[x]&&g[x].isTexture?g[x]:null;if(v){v.matrixAutoUpdate&&v.updateMatrix();let _=v.matrix.elements,y=0;p[m+y++]=_[0],p[m+y++]=_[3],p[m+y++]=_[6],y++,p[m+y++]=_[1],p[m+y++]=_[4],p[m+y++]=_[7],y++}return 8}let o=0,a=t.length*Sh,c=Math.ceil(Math.sqrt(a))||1,{image:l,features:f}=this,h={};for(let g=0,x=e.length;g<x;g++)h[yh(e[g])]=g;l.width!==c&&(this.dispose(),l.data=new Float32Array(c*c*4),l.width=c,l.height=c);let u=l.data;f.reset();for(let g=0,x=t.length;g<x;g++){let p=t[g];if(p.isFogVolumeMaterial){f.setUsed("FOG");for(let _=0;_<sv;_++)u[o+_]=0;u[o+0+0]=p.color.r,u[o+0+1]=p.color.g,u[o+0+2]=p.color.b,u[o+8+3]=i(p,"emissiveIntensity",0),u[o+12+0]=p.emissive.r,u[o+12+1]=p.emissive.g,u[o+12+2]=p.emissive.b,u[o+52+1]=p.density,u[o+52+3]=0,u[o+56+2]=4,o+=sv;continue}u[o++]=p.color.r,u[o++]=p.color.g,u[o++]=p.color.b,u[o++]=n(p,"map"),u[o++]=i(p,"metalness",0),u[o++]=n(p,"metalnessMap"),u[o++]=i(p,"roughness",0),u[o++]=n(p,"roughnessMap"),u[o++]=i(p,"ior",1.5),u[o++]=i(p,"transmission",0),u[o++]=n(p,"transmissionMap"),u[o++]=i(p,"emissiveIntensity",0),"emissive"in p?(u[o++]=p.emissive.r,u[o++]=p.emissive.g,u[o++]=p.emissive.b):(u[o++]=0,u[o++]=0,u[o++]=0),u[o++]=n(p,"emissiveMap"),u[o++]=n(p,"normalMap"),"normalScale"in p?(u[o++]=p.normalScale.x,u[o++]=p.normalScale.y):(u[o++]=1,u[o++]=1),u[o++]=i(p,"clearcoat",0),u[o++]=n(p,"clearcoatMap"),u[o++]=i(p,"clearcoatRoughness",0),u[o++]=n(p,"clearcoatRoughnessMap"),u[o++]=n(p,"clearcoatNormalMap"),"clearcoatNormalScale"in p?(u[o++]=p.clearcoatNormalScale.x,u[o++]=p.clearcoatNormalScale.y):(u[o++]=1,u[o++]=1),o++,u[o++]=i(p,"sheen",0),"sheenColor"in p?(u[o++]=p.sheenColor.r,u[o++]=p.sheenColor.g,u[o++]=p.sheenColor.b):(u[o++]=0,u[o++]=0,u[o++]=0),u[o++]=n(p,"sheenColorMap"),u[o++]=i(p,"sheenRoughness",0),u[o++]=n(p,"sheenRoughnessMap"),u[o++]=n(p,"iridescenceMap"),u[o++]=n(p,"iridescenceThicknessMap"),u[o++]=i(p,"iridescence",0),u[o++]=i(p,"iridescenceIOR",1.3);let m=i(p,"iridescenceThicknessRange",[100,400]);u[o++]=m[0],u[o++]=m[1],"specularColor"in p?(u[o++]=p.specularColor.r,u[o++]=p.specularColor.g,u[o++]=p.specularColor.b):(u[o++]=1,u[o++]=1,u[o++]=1),u[o++]=n(p,"specularColorMap"),u[o++]=i(p,"specularIntensity",1),u[o++]=n(p,"specularIntensityMap");let v=i(p,"thickness",0)===0&&i(p,"attenuationDistance",1/0)===1/0;if(u[o++]=Number(v),o++,"attenuationColor"in p?(u[o++]=p.attenuationColor.r,u[o++]=p.attenuationColor.g,u[o++]=p.attenuationColor.b):(u[o++]=1,u[o++]=1,u[o++]=1),u[o++]=i(p,"attenuationDistance",1/0),u[o++]=n(p,"alphaMap"),u[o++]=p.opacity,u[o++]=p.alphaTest,!v&&p.transmission>0)u[o++]=0;else switch(p.side){case yn:u[o++]=1;break;case He:u[o++]=-1;break;case Sn:u[o++]=0;break}u[o++]=Number(i(p,"matte",!1)),u[o++]=Number(i(p,"castShadow",!0)),u[o++]=Number(p.vertexColors)|Number(p.flatShading)<<1,u[o++]=Number(p.transparent),o+=s(p,"map",u,o),o+=s(p,"metalnessMap",u,o),o+=s(p,"roughnessMap",u,o),o+=s(p,"transmissionMap",u,o),o+=s(p,"emissiveMap",u,o),o+=s(p,"normalMap",u,o),o+=s(p,"clearcoatMap",u,o),o+=s(p,"clearcoatNormalMap",u,o),o+=s(p,"clearcoatRoughnessMap",u,o),o+=s(p,"sheenColorMap",u,o),o+=s(p,"sheenRoughnessMap",u,o),o+=s(p,"iridescenceMap",u,o),o+=s(p,"iridescenceThicknessMap",u,o),o+=s(p,"specularColorMap",u,o),o+=s(p,"specularIntensityMap",u,o),o+=s(p,"alphaMap",u,o)}let d=io(u.buffer);return this.hash!==d?(this.hash=d,this.needsUpdate=!0,!0):!1}};var ov=new ft;function YA(r){return r?`${r.uuid}:${r.version}`:null}function $A(r,t){for(let e in t)e in r&&(r[e]=t[e])}var Da=class extends Do{constructor(t,e,n){let i={format:Gt,type:on,minFilter:re,magFilter:re,wrapS:Ke,wrapT:Ke,generateMipmaps:!1,...n};super(t,e,1,i),$A(this.texture,i),this.texture.setTextures=(...o)=>{this.setTextures(...o)},this.hashes=[null];let s=new Fn(new $p);this.fsQuad=s}setTextures(t,e,n=this.width,i=this.height){let s=t.getRenderTarget(),o=t.toneMapping,a=t.getClearAlpha();t.getClearColor(ov);let c=e.length||1;(n!==this.width||i!==this.height||this.depth!==c)&&(this.setSize(n,i,c),this.hashes=new Array(c).fill(null)),t.setClearColor(0,0),t.toneMapping=Zn;let l=this.fsQuad,f=this.hashes,h=!1;for(let u=0,d=c;u<d;u++){let g=e[u],x=YA(g);g&&(f[u]!==x||g.isWebGLRenderTarget)&&(g.matrixAutoUpdate=!1,g.matrix.identity(),l.material.map=g,t.setRenderTarget(this,u),l.render(t),g.updateMatrix(),g.matrixAutoUpdate=!0,f[u]=x,h=!0)}return l.material.map=null,t.setClearColor(ov,a),t.setRenderTarget(s),t.toneMapping=o,h}dispose(){super.dispose(),this.fsQuad.dispose()}},$p=class extends Ue{get map(){return this.uniforms.map.value}set map(t){this.uniforms.map.value=t}constructor(){super({uniforms:{map:{value:null}},vertexShader:`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,fragmentShader:`
				uniform sampler2D map;
				varying vec2 vUv;
				void main() {

					gl_FragColor = texture2D( map, vUv );

				}
			`})}};function ZA(r,t=Math.random()){for(let e=r.length-1;e>0;e--){let n=Math.floor(t()*(e+1)),i=r[e];r[e]=r[n],r[n]=i}return r}var Mh=class{constructor(t,e,n=Math.random){let i=t**e,s=new Uint16Array(i),o=i;for(let a=0;a<i;a++)s[a]=a;this.samples=new Float32Array(e),this.strataCount=t,this.reset=function(){for(let a=0;a<i;a++)s[a]=a;o=0},this.reshuffle=function(){o=0},this.next=function(){let{samples:a}=this;o>=s.length&&(ZA(s,n),this.reshuffle());let c=s[o++];for(let l=0;l<e;l++)a[l]=(c%t+n())/t,c=Math.floor(c/t);return a}}};var Th=class{constructor(t,e,n=Math.random){let i=0;for(let c of e)i+=c;let s=new Float32Array(i),o=[],a=0;for(let c of e){let l=new Mh(t,c,n);l.samples=new Float32Array(s.buffer,a,l.samples.length),a+=l.samples.length*4,o.push(l)}this.samples=s,this.strataCount=t,this.next=function(){for(let c of o)c.next();return s},this.reshuffle=function(){for(let c of o)c.reshuffle()},this.reset=function(){for(let c of o)c.reset()}}};var Zp=class{constructor(t=0){this.m=2147483648,this.a=1103515245,this.c=12345,this.seed=t}nextInt(){return this.seed=(this.a*this.seed+this.c)%this.m,this.seed}nextFloat(){return this.nextInt()/(this.m-1)}},wh=class extends oe{constructor(t=1,e=1,n=8){super(new Float32Array(1),1,1,Gt,$t),this.minFilter=Vt,this.magFilter=Vt,this.strata=n,this.sampler=null,this.generator=new Zp,this.stableNoise=!1,this.random=()=>this.stableNoise?this.generator.nextFloat():Math.random(),this.init(t,e,n)}init(t=this.image.height,e=this.image.width,n=this.strata){let{image:i}=this;if(i.width===e&&i.height===t&&this.sampler!==null)return;let s=new Array(t*e).fill(4),o=new Th(n,s,this.random);i.width=e,i.height=t,i.data=o.samples,this.sampler=o,this.dispose(),this.next()}next(){this.sampler.next(),this.needsUpdate=!0}reset(){this.sampler.reset(),this.generator.seed=0}};function av(r,t=Math.random){for(let e=r.length-1;e>0;e--){let n=~~((t()-1e-6)*e),i=r[e];r[e]=r[n],r[n]=i}}function cv(r,t){r.fill(0);for(let e=0;e<t;e++)r[e]=1}var Fa=class{constructor(t){this.count=0,this.size=-1,this.sigma=-1,this.radius=-1,this.lookupTable=null,this.score=null,this.binaryPattern=null,this.resize(t),this.setSigma(1.5)}findVoid(){let{score:t,binaryPattern:e}=this,n=1/0,i=-1;for(let s=0,o=e.length;s<o;s++){if(e[s]!==0)continue;let a=t[s];a<n&&(n=a,i=s)}return i}findCluster(){let{score:t,binaryPattern:e}=this,n=-1/0,i=-1;for(let s=0,o=e.length;s<o;s++){if(e[s]!==1)continue;let a=t[s];a>n&&(n=a,i=s)}return i}setSigma(t){if(t===this.sigma)return;let e=~~(Math.sqrt(20*t**2)+1),n=2*e+1,i=new Float32Array(n*n),s=t*t;for(let o=-e;o<=e;o++)for(let a=-e;a<=e;a++){let c=(e+a)*n+o+e,l=o*o+a*a;i[c]=Math.E**(-l/(2*s))}this.lookupTable=i,this.sigma=t,this.radius=e}resize(t){this.size!==t&&(this.size=t,this.score=new Float32Array(t*t),this.binaryPattern=new Uint8Array(t*t))}invert(){let{binaryPattern:t,score:e,size:n}=this;e.fill(0);for(let i=0,s=t.length;i<s;i++)if(t[i]===0){let o=~~(i/n),a=i-o*n;this.updateScore(a,o,1),t[i]=1}else t[i]=0}updateScore(t,e,n){let{size:i,score:s,lookupTable:o}=this,a=this.radius,c=2*a+1;for(let l=-a;l<=a;l++)for(let f=-a;f<=a;f++){let h=(a+f)*c+l+a,u=o[h],d=t+l;d=d<0?i+d:d%i;let g=e+f;g=g<0?i+g:g%i;let x=g*i+d;s[x]+=n*u}}addPointIndex(t){this.binaryPattern[t]=1;let e=this.size,n=~~(t/e),i=t-n*e;this.updateScore(i,n,1),this.count++}removePointIndex(t){this.binaryPattern[t]=0;let e=this.size,n=~~(t/e),i=t-n*e;this.updateScore(i,n,-1),this.count--}copy(t){this.resize(t.size),this.score.set(t.score),this.binaryPattern.set(t.binaryPattern),this.setSigma(t.sigma),this.count=t.count}};var Ah=class{constructor(){this.random=Math.random,this.sigma=1.5,this.size=64,this.majorityPointsRatio=.1,this.samples=new Fa(1),this.savedSamples=new Fa(1)}generate(){let{samples:t,savedSamples:e,sigma:n,majorityPointsRatio:i,size:s}=this;t.resize(s),t.setSigma(n);let o=Math.floor(s*s*i),a=t.binaryPattern;cv(a,o),av(a,this.random);for(let h=0,u=a.length;h<u;h++)a[h]===1&&t.addPointIndex(h);for(;;){let h=t.findCluster();t.removePointIndex(h);let u=t.findVoid();if(h===u){t.addPointIndex(h);break}t.addPointIndex(u)}let c=new Uint32Array(s*s);e.copy(t);let l;for(l=t.count-1;l>=0;){let h=t.findCluster();t.removePointIndex(h),c[h]=l,l--}let f=s*s;for(l=e.count;l<f/2;){let h=e.findVoid();e.addPointIndex(h),c[h]=l,l++}for(e.invert();l<f;){let h=e.findCluster();e.removePointIndex(h),c[h]=l,l++}return{data:c,maxValue:f}}};function JA(r){return r>=3?4:r}function KA(r){switch(r){case 1:return Jn;case 2:return Fr;default:return Gt}}var Eh=class extends oe{constructor(t=64,e=1){super(new Float32Array(4),1,1,Gt,$t),this.minFilter=Vt,this.magFilter=Vt,this.size=t,this.channels=e,this.update()}update(){let t=this.channels,e=this.size,n=new Ah;n.channels=t,n.size=e;let i=JA(t),s=KA(i);(this.image.width!==e||s!==this.format)&&(this.image.width=e,this.image.height=e,this.image.data=new Float32Array(e**2*i),this.format=s,this.dispose());let o=this.image.data;for(let a=0,c=t;a<c;a++){let l=n.generate(),f=l.data,h=l.maxValue;for(let u=0,d=f.length;u<d;u++){let g=f[u]/h;o[u*i+a]=g}}this.needsUpdate=!0}};var lv=`

	struct PhysicalCamera {

		float focusDistance;
		float anamorphicRatio;
		float bokehSize;
		int apertureBlades;
		float apertureRotation;

	};

`;var uv=`

	struct EquirectHdrInfo {

		sampler2D marginalWeights;
		sampler2D conditionalWeights;
		sampler2D map;

		float totalSum;

	};

`;var hv=`

	#define RECT_AREA_LIGHT_TYPE 0
	#define CIRC_AREA_LIGHT_TYPE 1
	#define SPOT_LIGHT_TYPE 2
	#define DIR_LIGHT_TYPE 3
	#define POINT_LIGHT_TYPE 4

	struct LightsInfo {

		sampler2D tex;
		uint count;

	};

	struct Light {

		vec3 position;
		int type;

		vec3 color;
		float intensity;

		vec3 u;
		vec3 v;
		float area;

		// spot light fields
		float radius;
		float near;
		float decay;
		float distance;
		float coneCos;
		float penumbraCos;
		int iesProfile;

	};

	Light readLightInfo( sampler2D tex, uint index ) {

		uint i = index * 6u;

		vec4 s0 = texelFetch1D( tex, i + 0u );
		vec4 s1 = texelFetch1D( tex, i + 1u );
		vec4 s2 = texelFetch1D( tex, i + 2u );
		vec4 s3 = texelFetch1D( tex, i + 3u );

		Light l;
		l.position = s0.rgb;
		l.type = int( round( s0.a ) );

		l.color = s1.rgb;
		l.intensity = s1.a;

		l.u = s2.rgb;
		l.v = s3.rgb;
		l.area = s3.a;

		if ( l.type == SPOT_LIGHT_TYPE || l.type == POINT_LIGHT_TYPE ) {

			vec4 s4 = texelFetch1D( tex, i + 4u );
			vec4 s5 = texelFetch1D( tex, i + 5u );
			l.radius = s4.r;
			l.decay = s4.g;
			l.distance = s4.b;
			l.coneCos = s4.a;

			l.penumbraCos = s5.r;
			l.iesProfile = int( round( s5.g ) );

		} else {

			l.radius = 0.0;
			l.decay = 0.0;
			l.distance = 0.0;

			l.coneCos = 0.0;
			l.penumbraCos = 0.0;
			l.iesProfile = - 1;

		}

		return l;

	}

`;var fv=`

	struct Material {

		vec3 color;
		int map;

		float metalness;
		int metalnessMap;

		float roughness;
		int roughnessMap;

		float ior;
		float transmission;
		int transmissionMap;

		float emissiveIntensity;
		vec3 emissive;
		int emissiveMap;

		int normalMap;
		vec2 normalScale;

		float clearcoat;
		int clearcoatMap;
		int clearcoatNormalMap;
		vec2 clearcoatNormalScale;
		float clearcoatRoughness;
		int clearcoatRoughnessMap;

		int iridescenceMap;
		int iridescenceThicknessMap;
		float iridescence;
		float iridescenceIor;
		float iridescenceThicknessMinimum;
		float iridescenceThicknessMaximum;

		vec3 specularColor;
		int specularColorMap;

		float specularIntensity;
		int specularIntensityMap;
		bool thinFilm;

		vec3 attenuationColor;
		float attenuationDistance;

		int alphaMap;

		bool castShadow;
		float opacity;
		float alphaTest;

		float side;
		bool matte;

		float sheen;
		vec3 sheenColor;
		int sheenColorMap;
		float sheenRoughness;
		int sheenRoughnessMap;

		bool vertexColors;
		bool flatShading;
		bool transparent;
		bool fogVolume;

		mat3 mapTransform;
		mat3 metalnessMapTransform;
		mat3 roughnessMapTransform;
		mat3 transmissionMapTransform;
		mat3 emissiveMapTransform;
		mat3 normalMapTransform;
		mat3 clearcoatMapTransform;
		mat3 clearcoatNormalMapTransform;
		mat3 clearcoatRoughnessMapTransform;
		mat3 sheenColorMapTransform;
		mat3 sheenRoughnessMapTransform;
		mat3 iridescenceMapTransform;
		mat3 iridescenceThicknessMapTransform;
		mat3 specularColorMapTransform;
		mat3 specularIntensityMapTransform;
		mat3 alphaMapTransform;

	};

	mat3 readTextureTransform( sampler2D tex, uint index ) {

		mat3 textureTransform;

		vec4 row1 = texelFetch1D( tex, index );
		vec4 row2 = texelFetch1D( tex, index + 1u );

		textureTransform[0] = vec3(row1.r, row2.r, 0.0);
		textureTransform[1] = vec3(row1.g, row2.g, 0.0);
		textureTransform[2] = vec3(row1.b, row2.b, 1.0);

		return textureTransform;

	}

	Material readMaterialInfo( sampler2D tex, uint index ) {

		uint i = index * uint( MATERIAL_PIXELS );

		vec4 s0 = texelFetch1D( tex, i + 0u );
		vec4 s1 = texelFetch1D( tex, i + 1u );
		vec4 s2 = texelFetch1D( tex, i + 2u );
		vec4 s3 = texelFetch1D( tex, i + 3u );
		vec4 s4 = texelFetch1D( tex, i + 4u );
		vec4 s5 = texelFetch1D( tex, i + 5u );
		vec4 s6 = texelFetch1D( tex, i + 6u );
		vec4 s7 = texelFetch1D( tex, i + 7u );
		vec4 s8 = texelFetch1D( tex, i + 8u );
		vec4 s9 = texelFetch1D( tex, i + 9u );
		vec4 s10 = texelFetch1D( tex, i + 10u );
		vec4 s11 = texelFetch1D( tex, i + 11u );
		vec4 s12 = texelFetch1D( tex, i + 12u );
		vec4 s13 = texelFetch1D( tex, i + 13u );
		vec4 s14 = texelFetch1D( tex, i + 14u );

		Material m;
		m.color = s0.rgb;
		m.map = int( round( s0.a ) );

		m.metalness = s1.r;
		m.metalnessMap = int( round( s1.g ) );
		m.roughness = s1.b;
		m.roughnessMap = int( round( s1.a ) );

		m.ior = s2.r;
		m.transmission = s2.g;
		m.transmissionMap = int( round( s2.b ) );
		m.emissiveIntensity = s2.a;

		m.emissive = s3.rgb;
		m.emissiveMap = int( round( s3.a ) );

		m.normalMap = int( round( s4.r ) );
		m.normalScale = s4.gb;

		m.clearcoat = s4.a;
		m.clearcoatMap = int( round( s5.r ) );
		m.clearcoatRoughness = s5.g;
		m.clearcoatRoughnessMap = int( round( s5.b ) );
		m.clearcoatNormalMap = int( round( s5.a ) );
		m.clearcoatNormalScale = s6.rg;

		m.sheen = s6.a;
		m.sheenColor = s7.rgb;
		m.sheenColorMap = int( round( s7.a ) );
		m.sheenRoughness = s8.r;
		m.sheenRoughnessMap = int( round( s8.g ) );

		m.iridescenceMap = int( round( s8.b ) );
		m.iridescenceThicknessMap = int( round( s8.a ) );
		m.iridescence = s9.r;
		m.iridescenceIor = s9.g;
		m.iridescenceThicknessMinimum = s9.b;
		m.iridescenceThicknessMaximum = s9.a;

		m.specularColor = s10.rgb;
		m.specularColorMap = int( round( s10.a ) );

		m.specularIntensity = s11.r;
		m.specularIntensityMap = int( round( s11.g ) );
		m.thinFilm = bool( s11.b );

		m.attenuationColor = s12.rgb;
		m.attenuationDistance = s12.a;

		m.alphaMap = int( round( s13.r ) );

		m.opacity = s13.g;
		m.alphaTest = s13.b;
		m.side = s13.a;

		m.matte = bool( s14.r );
		m.castShadow = bool( s14.g );
		m.vertexColors = bool( int( s14.b ) & 1 );
		m.flatShading = bool( int( s14.b ) & 2 );
		m.fogVolume = bool( int( s14.b ) & 4 );
		m.transparent = bool( s14.a );

		uint firstTextureTransformIdx = i + 15u;

		// mat3( 1.0 ) is an identity matrix
		m.mapTransform = m.map == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx );
		m.metalnessMapTransform = m.metalnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 2u );
		m.roughnessMapTransform = m.roughnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 4u );
		m.transmissionMapTransform = m.transmissionMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 6u );
		m.emissiveMapTransform = m.emissiveMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 8u );
		m.normalMapTransform = m.normalMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 10u );
		m.clearcoatMapTransform = m.clearcoatMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 12u );
		m.clearcoatNormalMapTransform = m.clearcoatNormalMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 14u );
		m.clearcoatRoughnessMapTransform = m.clearcoatRoughnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 16u );
		m.sheenColorMapTransform = m.sheenColorMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 18u );
		m.sheenRoughnessMapTransform = m.sheenRoughnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 20u );
		m.iridescenceMapTransform = m.iridescenceMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 22u );
		m.iridescenceThicknessMapTransform = m.iridescenceThicknessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 24u );
		m.specularColorMapTransform = m.specularColorMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 26u );
		m.specularIntensityMapTransform = m.specularIntensityMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 28u );
		m.alphaMapTransform = m.alphaMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 30u );

		return m;

	}

`;var dv=`

	struct SurfaceRecord {

		// surface type
		bool volumeParticle;

		// geometry
		vec3 faceNormal;
		bool frontFace;
		vec3 normal;
		mat3 normalBasis;
		mat3 normalInvBasis;

		// cached properties
		float eta;
		float f0;

		// material
		float roughness;
		float filteredRoughness;
		float metalness;
		vec3 color;
		vec3 emission;

		// transmission
		float ior;
		float transmission;
		bool thinFilm;
		vec3 attenuationColor;
		float attenuationDistance;

		// clearcoat
		vec3 clearcoatNormal;
		mat3 clearcoatBasis;
		mat3 clearcoatInvBasis;
		float clearcoat;
		float clearcoatRoughness;
		float filteredClearcoatRoughness;

		// sheen
		float sheen;
		vec3 sheenColor;
		float sheenRoughness;

		// iridescence
		float iridescence;
		float iridescenceIor;
		float iridescenceThickness;

		// specular
		vec3 specularColor;
		float specularIntensity;
	};

	struct ScatterRecord {
		float specularPdf;
		float pdf;
		vec3 direction;
		vec3 color;
	};

`;var pv=`

	// samples the the given environment map in the given direction
	vec3 sampleEquirectColor( sampler2D envMap, vec3 direction ) {

		return texture2D( envMap, equirectDirectionToUv( direction ) ).rgb;

	}

	// gets the pdf of the given direction to sample
	float equirectDirectionPdf( vec3 direction ) {

		vec2 uv = equirectDirectionToUv( direction );
		float theta = uv.y * PI;
		float sinTheta = sin( theta );
		if ( sinTheta == 0.0 ) {

			return 0.0;

		}

		return 1.0 / ( 2.0 * PI * PI * sinTheta );

	}

	// samples the color given env map with CDF and returns the pdf of the direction
	float sampleEquirect( vec3 direction, inout vec3 color ) {

		float totalSum = envMapInfo.totalSum;
		if ( totalSum == 0.0 ) {

			color = vec3( 0.0 );
			return 1.0;

		}

		vec2 uv = equirectDirectionToUv( direction );
		color = texture2D( envMapInfo.map, uv ).rgb;

		float lum = luminance( color );
		ivec2 resolution = textureSize( envMapInfo.map, 0 );
		float pdf = lum / totalSum;

		return float( resolution.x * resolution.y ) * pdf * equirectDirectionPdf( direction );

	}

	// samples a direction of the envmap with color and retrieves pdf
	float sampleEquirectProbability( vec2 r, inout vec3 color, inout vec3 direction ) {

		// sample env map cdf
		float v = texture2D( envMapInfo.marginalWeights, vec2( r.x, 0.0 ) ).x;
		float u = texture2D( envMapInfo.conditionalWeights, vec2( r.y, v ) ).x;
		vec2 uv = vec2( u, v );

		vec3 derivedDirection = equirectUvToDirection( uv );
		direction = derivedDirection;
		color = texture2D( envMapInfo.map, uv ).rgb;

		float totalSum = envMapInfo.totalSum;
		float lum = luminance( color );
		ivec2 resolution = textureSize( envMapInfo.map, 0 );
		float pdf = lum / totalSum;

		return float( resolution.x * resolution.y ) * pdf * equirectDirectionPdf( direction );

	}
`;var mv=`

	float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {

		return smoothstep( coneCosine, penumbraCosine, angleCosine );

	}

	float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {

		// based upon Frostbite 3 Moving to Physically-based Rendering
		// page 32, equation 26: E[window1]
		// https://seblagarde.files.wordpress.com/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf
		float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), EPSILON );

		if ( cutoffDistance > 0.0 ) {

			distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );

		}

		return distanceFalloff;

	}

	float getPhotometricAttenuation( sampler2DArray iesProfiles, int iesProfile, vec3 posToLight, vec3 lightDir, vec3 u, vec3 v ) {

		float cosTheta = dot( posToLight, lightDir );
		float angle = acos( cosTheta ) / PI;

		return texture2D( iesProfiles, vec3( angle, 0.0, iesProfile ) ).r;

	}

	struct LightRecord {

		float dist;
		vec3 direction;
		float pdf;
		vec3 emission;
		int type;

	};

	bool intersectLightAtIndex( sampler2D lights, vec3 rayOrigin, vec3 rayDirection, uint l, inout LightRecord lightRec ) {

		bool didHit = false;
		Light light = readLightInfo( lights, l );

		vec3 u = light.u;
		vec3 v = light.v;

		// check for backface
		vec3 normal = normalize( cross( u, v ) );
		if ( dot( normal, rayDirection ) > 0.0 ) {

			u *= 1.0 / dot( u, u );
			v *= 1.0 / dot( v, v );

			float dist;

			// MIS / light intersection is not supported for punctual lights.
			if(
				( light.type == RECT_AREA_LIGHT_TYPE && intersectsRectangle( light.position, normal, u, v, rayOrigin, rayDirection, dist ) ) ||
				( light.type == CIRC_AREA_LIGHT_TYPE && intersectsCircle( light.position, normal, u, v, rayOrigin, rayDirection, dist ) )
			) {

				float cosTheta = dot( rayDirection, normal );
				didHit = true;
				lightRec.dist = dist;
				lightRec.pdf = ( dist * dist ) / ( light.area * cosTheta );
				lightRec.emission = light.color * light.intensity;
				lightRec.direction = rayDirection;
				lightRec.type = light.type;

			}

		}

		return didHit;

	}

	LightRecord randomAreaLightSample( Light light, vec3 rayOrigin, vec2 ruv ) {

		vec3 randomPos;
		if( light.type == RECT_AREA_LIGHT_TYPE ) {

			// rectangular area light
			randomPos = light.position + light.u * ( ruv.x - 0.5 ) + light.v * ( ruv.y - 0.5 );

		} else if( light.type == CIRC_AREA_LIGHT_TYPE ) {

			// circular area light
			float r = 0.5 * sqrt( ruv.x );
			float theta = ruv.y * 2.0 * PI;
			float x = r * cos( theta );
			float y = r * sin( theta );

			randomPos = light.position + light.u * x + light.v * y;

		}

		vec3 toLight = randomPos - rayOrigin;
		float lightDistSq = dot( toLight, toLight );
		float dist = sqrt( lightDistSq );
		vec3 direction = toLight / dist;
		vec3 lightNormal = normalize( cross( light.u, light.v ) );

		LightRecord lightRec;
		lightRec.type = light.type;
		lightRec.emission = light.color * light.intensity;
		lightRec.dist = dist;
		lightRec.direction = direction;

		// TODO: the denominator is potentially zero
		lightRec.pdf = lightDistSq / ( light.area * dot( direction, lightNormal ) );

		return lightRec;

	}

	LightRecord randomSpotLightSample( Light light, sampler2DArray iesProfiles, vec3 rayOrigin, vec2 ruv ) {

		float radius = light.radius * sqrt( ruv.x );
		float theta = ruv.y * 2.0 * PI;
		float x = radius * cos( theta );
		float y = radius * sin( theta );

		vec3 u = light.u;
		vec3 v = light.v;
		vec3 normal = normalize( cross( u, v ) );

		float angle = acos( light.coneCos );
		float angleTan = tan( angle );
		float startDistance = light.radius / max( angleTan, EPSILON );

		vec3 randomPos = light.position - normal * startDistance + u * x + v * y;
		vec3 toLight = randomPos - rayOrigin;
		float lightDistSq = dot( toLight, toLight );
		float dist = sqrt( lightDistSq );

		vec3 direction = toLight / max( dist, EPSILON );
		float cosTheta = dot( direction, normal );

		float spotAttenuation = light.iesProfile != - 1 ?
			getPhotometricAttenuation( iesProfiles, light.iesProfile, direction, normal, u, v ) :
			getSpotAttenuation( light.coneCos, light.penumbraCos, cosTheta );

		float distanceAttenuation = getDistanceAttenuation( dist, light.distance, light.decay );
		LightRecord lightRec;
		lightRec.type = light.type;
		lightRec.dist = dist;
		lightRec.direction = direction;
		lightRec.emission = light.color * light.intensity * distanceAttenuation * spotAttenuation;
		lightRec.pdf = 1.0;

		return lightRec;

	}

	LightRecord randomLightSample( sampler2D lights, sampler2DArray iesProfiles, uint lightCount, vec3 rayOrigin, vec3 ruv ) {

		LightRecord result;

		// pick a random light
		uint l = uint( ruv.x * float( lightCount ) );
		Light light = readLightInfo( lights, l );

		if ( light.type == SPOT_LIGHT_TYPE ) {

			result = randomSpotLightSample( light, iesProfiles, rayOrigin, ruv.yz );

		} else if ( light.type == POINT_LIGHT_TYPE ) {

			vec3 lightRay = light.u - rayOrigin;
			float lightDist = length( lightRay );
			float cutoffDistance = light.distance;
			float distanceFalloff = 1.0 / max( pow( lightDist, light.decay ), 0.01 );
			if ( cutoffDistance > 0.0 ) {

				distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDist / cutoffDistance ) ) );

			}

			LightRecord rec;
			rec.direction = normalize( lightRay );
			rec.dist = length( lightRay );
			rec.pdf = 1.0;
			rec.emission = light.color * light.intensity * distanceFalloff;
			rec.type = light.type;
			result = rec;

		} else if ( light.type == DIR_LIGHT_TYPE ) {

			LightRecord rec;
			rec.dist = 1e10;
			rec.direction = light.u;
			rec.pdf = 1.0;
			rec.emission = light.color * light.intensity;
			rec.type = light.type;

			result = rec;

		} else {

			// sample the light
			result = randomAreaLightSample( light, rayOrigin, ruv.yz );

		}

		return result;

	}

`;var gv=`

	vec3 sampleHemisphere( vec3 n, vec2 uv ) {

		// https://www.rorydriscoll.com/2009/01/07/better-sampling/
		// https://graphics.pixar.com/library/OrthonormalB/paper.pdf
		float sign = n.z == 0.0 ? 1.0 : sign( n.z );
		float a = - 1.0 / ( sign + n.z );
		float b = n.x * n.y * a;
		vec3 b1 = vec3( 1.0 + sign * n.x * n.x * a, sign * b, - sign * n.x );
		vec3 b2 = vec3( b, sign + n.y * n.y * a, - n.y );

		float r = sqrt( uv.x );
		float theta = 2.0 * PI * uv.y;
		float x = r * cos( theta );
		float y = r * sin( theta );
		return x * b1 + y * b2 + sqrt( 1.0 - uv.x ) * n;

	}

	vec2 sampleTriangle( vec2 a, vec2 b, vec2 c, vec2 r ) {

		// get the edges of the triangle and the diagonal across the
		// center of the parallelogram
		vec2 e1 = a - b;
		vec2 e2 = c - b;
		vec2 diag = normalize( e1 + e2 );

		// pick the point in the parallelogram
		if ( r.x + r.y > 1.0 ) {

			r = vec2( 1.0 ) - r;

		}

		return e1 * r.x + e2 * r.y;

	}

	vec2 sampleCircle( vec2 uv ) {

		float angle = 2.0 * PI * uv.x;
		float radius = sqrt( uv.y );
		return vec2( cos( angle ), sin( angle ) ) * radius;

	}

	vec3 sampleSphere( vec2 uv ) {

		float u = ( uv.x - 0.5 ) * 2.0;
		float t = uv.y * PI * 2.0;
		float f = sqrt( 1.0 - u * u );

		return vec3( f * cos( t ), f * sin( t ), u );

	}

	vec2 sampleRegularPolygon( int sides, vec3 uvw ) {

		sides = max( sides, 3 );

		vec3 r = uvw;
		float anglePerSegment = 2.0 * PI / float( sides );
		float segment = floor( float( sides ) * r.x );

		float angle1 = anglePerSegment * segment;
		float angle2 = angle1 + anglePerSegment;
		vec2 a = vec2( sin( angle1 ), cos( angle1 ) );
		vec2 b = vec2( 0.0, 0.0 );
		vec2 c = vec2( sin( angle2 ), cos( angle2 ) );

		return sampleTriangle( a, b, c, r.yz );

	}

	// samples an aperture shape with the given number of sides. 0 means circle
	vec2 sampleAperture( int blades, vec3 uvw ) {

		return blades == 0 ?
			sampleCircle( uvw.xy ) :
			sampleRegularPolygon( blades, uvw );

	}


`;var xv=`

	bool totalInternalReflection( float cosTheta, float eta ) {

		float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
		return eta * sinTheta > 1.0;

	}

	// https://google.github.io/filament/Filament.md.html#materialsystem/diffusebrdf
	float schlickFresnel( float cosine, float f0 ) {

		return f0 + ( 1.0 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

	vec3 schlickFresnel( float cosine, vec3 f0 ) {

		return f0 + ( 1.0 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

	vec3 schlickFresnel( float cosine, vec3 f0, vec3 f90 ) {

		return f0 + ( f90 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

	float dielectricFresnel( float cosThetaI, float eta ) {

		// https://schuttejoe.github.io/post/disneybsdf/
		float ni = eta;
		float nt = 1.0;

		// Check for total internal reflection
		float sinThetaISq = 1.0f - cosThetaI * cosThetaI;
		float sinThetaTSq = eta * eta * sinThetaISq;
		if( sinThetaTSq >= 1.0 ) {

			return 1.0;

		}

		float sinThetaT = sqrt( sinThetaTSq );

		float cosThetaT = sqrt( max( 0.0, 1.0f - sinThetaT * sinThetaT ) );
		float rParallel = ( ( nt * cosThetaI ) - ( ni * cosThetaT ) ) / ( ( nt * cosThetaI ) + ( ni * cosThetaT ) );
		float rPerpendicular = ( ( ni * cosThetaI ) - ( nt * cosThetaT ) ) / ( ( ni * cosThetaI ) + ( nt * cosThetaT ) );
		return ( rParallel * rParallel + rPerpendicular * rPerpendicular ) / 2.0;

	}

	// https://raytracing.github.io/books/RayTracingInOneWeekend.html#dielectrics/schlickapproximation
	float iorRatioToF0( float eta ) {

		return pow( ( 1.0 - eta ) / ( 1.0 + eta ), 2.0 );

	}

	vec3 evaluateFresnel( float cosTheta, float eta, vec3 f0, vec3 f90 ) {

		if ( totalInternalReflection( cosTheta, eta ) ) {

			return f90;

		}

		return schlickFresnel( cosTheta, f0, f90 );

	}

	// TODO: disney fresnel was removed and replaced with this fresnel function to better align with
	// the glTF but is causing blown out pixels. Should be revisited
	// float evaluateFresnelWeight( float cosTheta, float eta, float f0 ) {

	// 	if ( totalInternalReflection( cosTheta, eta ) ) {

	// 		return 1.0;

	// 	}

	// 	return schlickFresnel( cosTheta, f0 );

	// }

	// https://schuttejoe.github.io/post/disneybsdf/
	float disneyFresnel( vec3 wo, vec3 wi, vec3 wh, float f0, float eta, float metalness ) {

		float dotHV = dot( wo, wh );
		if ( totalInternalReflection( dotHV, eta ) ) {

			return 1.0;

		}

		float dotHL = dot( wi, wh );
		float dielectricFresnel = dielectricFresnel( abs( dotHV ), eta );
		float metallicFresnel = schlickFresnel( dotHL, f0 );

		return mix( dielectricFresnel, metallicFresnel, metalness );

	}

`;var vv=`

	// Fast arccos approximation used to remove banding artifacts caused by numerical errors in acos.
	// This is a cubic Lagrange interpolating polynomial for x = [-1, -1/2, 0, 1/2, 1].
	// For more information see: https://github.com/gkjohnson/three-gpu-pathtracer/pull/171#issuecomment-1152275248
	float acosApprox( float x ) {

		x = clamp( x, -1.0, 1.0 );
		return ( - 0.69813170079773212 * x * x - 0.87266462599716477 ) * x + 1.5707963267948966;

	}

	// An acos with input values bound to the range [-1, 1].
	float acosSafe( float x ) {

		return acos( clamp( x, -1.0, 1.0 ) );

	}

	float saturateCos( float val ) {

		return clamp( val, 0.001, 1.0 );

	}

	float square( float t ) {

		return t * t;

	}

	vec2 square( vec2 t ) {

		return t * t;

	}

	vec3 square( vec3 t ) {

		return t * t;

	}

	vec4 square( vec4 t ) {

		return t * t;

	}

	vec2 rotateVector( vec2 v, float t ) {

		float ac = cos( t );
		float as = sin( t );
		return vec2(
			v.x * ac - v.y * as,
			v.x * as + v.y * ac
		);

	}

	// forms a basis with the normal vector as Z
	mat3 getBasisFromNormal( vec3 normal ) {

		vec3 other;
		if ( abs( normal.x ) > 0.5 ) {

			other = vec3( 0.0, 1.0, 0.0 );

		} else {

			other = vec3( 1.0, 0.0, 0.0 );

		}

		vec3 ortho = normalize( cross( normal, other ) );
		vec3 ortho2 = normalize( cross( normal, ortho ) );
		return mat3( ortho2, ortho, normal );

	}

`;var _v=`

	// Finds the point where the ray intersects the plane defined by u and v and checks if this point
	// falls in the bounds of the rectangle on that same plane.
	// Plane intersection: https://lousodrome.net/blog/light/2020/07/03/intersection-of-a-ray-and-a-plane/
	bool intersectsRectangle( vec3 center, vec3 normal, vec3 u, vec3 v, vec3 rayOrigin, vec3 rayDirection, inout float dist ) {

		float t = dot( center - rayOrigin, normal ) / dot( rayDirection, normal );

		if ( t > EPSILON ) {

			vec3 p = rayOrigin + rayDirection * t;
			vec3 vi = p - center;

			// check if p falls inside the rectangle
			float a1 = dot( u, vi );
			if ( abs( a1 ) <= 0.5 ) {

				float a2 = dot( v, vi );
				if ( abs( a2 ) <= 0.5 ) {

					dist = t;
					return true;

				}

			}

		}

		return false;

	}

	// Finds the point where the ray intersects the plane defined by u and v and checks if this point
	// falls in the bounds of the circle on that same plane. See above URL for a description of the plane intersection algorithm.
	bool intersectsCircle( vec3 position, vec3 normal, vec3 u, vec3 v, vec3 rayOrigin, vec3 rayDirection, inout float dist ) {

		float t = dot( position - rayOrigin, normal ) / dot( rayDirection, normal );

		if ( t > EPSILON ) {

			vec3 hit = rayOrigin + rayDirection * t;
			vec3 vi = hit - position;

			float a1 = dot( u, vi );
			float a2 = dot( v, vi );

			if( length( vec2( a1, a2 ) ) <= 0.5 ) {

				dist = t;
				return true;

			}

		}

		return false;

	}

`;var yv=`

	// add texel fetch functions for texture arrays
	vec4 texelFetch1D( sampler2DArray tex, int layer, uint index ) {

		uint width = uint( textureSize( tex, 0 ).x );
		uvec2 uv;
		uv.x = index % width;
		uv.y = index / width;

		return texelFetch( tex, ivec3( uv, layer ), 0 );

	}

	vec4 textureSampleBarycoord( sampler2DArray tex, int layer, vec3 barycoord, uvec3 faceIndices ) {

		return
			barycoord.x * texelFetch1D( tex, layer, faceIndices.x ) +
			barycoord.y * texelFetch1D( tex, layer, faceIndices.y ) +
			barycoord.z * texelFetch1D( tex, layer, faceIndices.z );

	}

`;var Rh=`

	// TODO: possibly this should be renamed something related to material or path tracing logic

	#ifndef RAY_OFFSET
	#define RAY_OFFSET 1e-4
	#endif

	// adjust the hit point by the surface normal by a factor of some offset and the
	// maximum component-wise value of the current point to accommodate floating point
	// error as values increase.
	vec3 stepRayOrigin( vec3 rayOrigin, vec3 rayDirection, vec3 offset, float dist ) {

		vec3 point = rayOrigin + rayDirection * dist;
		vec3 absPoint = abs( point );
		float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
		return point + offset * ( maxPoint + 1.0 ) * RAY_OFFSET;

	}

	// https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_volume/README.md#attenuation
	vec3 transmissionAttenuation( float dist, vec3 attColor, float attDist ) {

		vec3 ot = - log( attColor ) / attDist;
		return exp( - ot * dist );

	}

	vec3 getHalfVector( vec3 wi, vec3 wo, float eta ) {

		// get the half vector - assuming if the light incident vector is on the other side
		// of the that it's transmissive.
		vec3 h;
		if ( wi.z > 0.0 ) {

			h = normalize( wi + wo );

		} else {

			// Scale by the ior ratio to retrieve the appropriate half vector
			// From Section 2.2 on computing the transmission half vector:
			// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
			h = normalize( wi + wo * eta );

		}

		h *= sign( h.z );
		return h;

	}

	vec3 getHalfVector( vec3 a, vec3 b ) {

		return normalize( a + b );

	}

	// The discrepancy between interpolated surface normal and geometry normal can cause issues when a ray
	// is cast that is on the top side of the geometry normal plane but below the surface normal plane. If
	// we find a ray like that we ignore it to avoid artifacts.
	// This function returns if the direction is on the same side of both planes.
	bool isDirectionValid( vec3 direction, vec3 surfaceNormal, vec3 geometryNormal ) {

		bool aboveSurfaceNormal = dot( direction, surfaceNormal ) > 0.0;
		bool aboveGeometryNormal = dot( direction, geometryNormal ) > 0.0;
		return aboveSurfaceNormal == aboveGeometryNormal;

	}

	// ray sampling x and z are swapped to align with expected background view
	vec2 equirectDirectionToUv( vec3 direction ) {

		// from Spherical.setFromCartesianCoords
		vec2 uv = vec2( atan( direction.z, direction.x ), acos( direction.y ) );
		uv /= vec2( 2.0 * PI, PI );

		// apply adjustments to get values in range [0, 1] and y right side up
		uv.x += 0.5;
		uv.y = 1.0 - uv.y;
		return uv;

	}

	vec3 equirectUvToDirection( vec2 uv ) {

		// undo above adjustments
		uv.x -= 0.5;
		uv.y = 1.0 - uv.y;

		// from Vector3.setFromSphericalCoords
		float theta = uv.x * 2.0 * PI;
		float phi = uv.y * PI;

		float sinPhi = sin( phi );

		return vec3( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

	}

	// power heuristic for multiple importance sampling
	float misHeuristic( float a, float b ) {

		float aa = a * a;
		float bb = b * b;
		return aa / ( aa + bb );

	}

	// tentFilter from Peter Shirley's 'Realistic Ray Tracing (2nd Edition)' book, pg. 60
	// erichlof/THREE.js-PathTracing-Renderer/
	float tentFilter( float x ) {

		return x < 0.5 ? sqrt( 2.0 * x ) - 1.0 : 1.0 - sqrt( 2.0 - ( 2.0 * x ) );

	}
`;var Jp=`

	// https://www.shadertoy.com/view/wltcRS
	uvec4 WHITE_NOISE_SEED;

	void rng_initialize( vec2 p, int frame ) {

		// white noise seed
		WHITE_NOISE_SEED = uvec4( p, uint( frame ), uint( p.x ) + uint( p.y ) );

	}

	// https://www.pcg-random.org/
	void pcg4d( inout uvec4 v ) {

		v = v * 1664525u + 1013904223u;
		v.x += v.y * v.w;
		v.y += v.z * v.x;
		v.z += v.x * v.y;
		v.w += v.y * v.z;
		v = v ^ ( v >> 16u );
		v.x += v.y*v.w;
		v.y += v.z*v.x;
		v.z += v.x*v.y;
		v.w += v.y*v.z;

	}

	// returns [ 0, 1 ]
	float pcgRand() {

		pcg4d( WHITE_NOISE_SEED );
		return float( WHITE_NOISE_SEED.x ) / float( 0xffffffffu );

	}

	vec2 pcgRand2() {

		pcg4d( WHITE_NOISE_SEED );
		return vec2( WHITE_NOISE_SEED.xy ) / float(0xffffffffu);

	}

	vec3 pcgRand3() {

		pcg4d( WHITE_NOISE_SEED );
		return vec3( WHITE_NOISE_SEED.xyz ) / float( 0xffffffffu );

	}

	vec4 pcgRand4() {

		pcg4d( WHITE_NOISE_SEED );
		return vec4( WHITE_NOISE_SEED ) / float( 0xffffffffu );

	}
`;var bv=`

	uniform sampler2D stratifiedTexture;
	uniform sampler2D stratifiedOffsetTexture;

	uint sobolPixelIndex = 0u;
	uint sobolPathIndex = 0u;
	uint sobolBounceIndex = 0u;
	vec4 pixelSeed = vec4( 0 );

	vec4 rand4( int v ) {

		ivec2 uv = ivec2( v, sobolBounceIndex );
		vec4 stratifiedSample = texelFetch( stratifiedTexture, uv, 0 );
		return fract( stratifiedSample + pixelSeed.r ); // blue noise + stratified samples

	}

	vec3 rand3( int v ) {

		return rand4( v ).xyz;

	}

	vec2 rand2( int v ) {

		return rand4( v ).xy;

	}

	float rand( int v ) {

		return rand4( v ).x;

	}

	void rng_initialize( vec2 screenCoord, int frame ) {

		// tile the small noise texture across the entire screen
		ivec2 noiseSize = ivec2( textureSize( stratifiedOffsetTexture, 0 ) );
		ivec2 pixel = ivec2( screenCoord.xy ) % noiseSize;
		vec2 pixelWidth = 1.0 / vec2( noiseSize );
		vec2 uv = vec2( pixel ) * pixelWidth + pixelWidth * 0.5;

		// note that using "texelFetch" here seems to break Android for some reason
		pixelSeed = texture( stratifiedOffsetTexture, uv );

	}

`;var Sv=`

	// diffuse
	float diffuseEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		// https://schuttejoe.github.io/post/disneybsdf/
		float fl = schlickFresnel( wi.z, 0.0 );
		float fv = schlickFresnel( wo.z, 0.0 );

		float metalFactor = ( 1.0 - surf.metalness );
		float transFactor = ( 1.0 - surf.transmission );
		float rr = 0.5 + 2.0 * surf.roughness * fl * fl;
		float retro = rr * ( fl + fv + fl * fv * ( rr - 1.0f ) );
		float lambert = ( 1.0f - 0.5f * fl ) * ( 1.0f - 0.5f * fv );

		// TODO: subsurface approx?

		// float F = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		float F = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );
		color = ( 1.0 - F ) * transFactor * metalFactor * wi.z * surf.color * ( retro + lambert ) / PI;

		return wi.z / PI;

	}

	vec3 diffuseDirection( vec3 wo, SurfaceRecord surf ) {

		vec3 lightDirection = sampleSphere( rand2( 11 ) );
		lightDirection.z += 1.0;
		lightDirection = normalize( lightDirection );

		return lightDirection;

	}

	// specular
	float specularEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		// if roughness is set to 0 then D === NaN which results in black pixels
		float metalness = surf.metalness;
		float roughness = surf.filteredRoughness;

		float eta = surf.eta;
		float f0 = surf.f0;

		vec3 f0Color = mix( f0 * surf.specularColor * surf.specularIntensity, surf.color, surf.metalness );
		vec3 f90Color = vec3( mix( surf.specularIntensity, 1.0, surf.metalness ) );
		vec3 F = evaluateFresnel( dot( wo, wh ), eta, f0Color, f90Color );

		vec3 iridescenceF = evalIridescence( 1.0, surf.iridescenceIor, dot( wi, wh ), surf.iridescenceThickness, f0Color );
		F = mix( F, iridescenceF,  surf.iridescence );

		// PDF
		// See 14.1.1 Microfacet BxDFs in https://www.pbr-book.org/
		float incidentTheta = acos( wo.z );
		float G = ggxShadowMaskG2( wi, wo, roughness );
		float D = ggxDistribution( wh, roughness );
		float G1 = ggxShadowMaskG1( incidentTheta, roughness );
		float ggxPdf = D * G1 * max( 0.0, abs( dot( wo, wh ) ) ) / abs ( wo.z );

		color = wi.z * F * G * D / ( 4.0 * abs( wi.z * wo.z ) );
		return ggxPdf / ( 4.0 * dot( wo, wh ) );

	}

	vec3 specularDirection( vec3 wo, SurfaceRecord surf ) {

		// sample ggx vndf distribution which gives a new normal
		float roughness = surf.filteredRoughness;
		vec3 halfVector = ggxDirection(
			wo,
			vec2( roughness ),
			rand2( 12 )
		);

		// apply to new ray by reflecting off the new normal
		return - reflect( wo, halfVector );

	}


	// transmission
	/*
	float transmissionEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		// See section 4.2 in https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf

		float filteredRoughness = surf.filteredRoughness;
		float eta = surf.eta;
		bool frontFace = surf.frontFace;
		bool thinFilm = surf.thinFilm;

		color = surf.transmission * surf.color;

		float denom = pow( eta * dot( wi, wh ) + dot( wo, wh ), 2.0 );
		return ggxPDF( wo, wh, filteredRoughness ) / denom;

	}

	vec3 transmissionDirection( vec3 wo, SurfaceRecord surf ) {

		float filteredRoughness = surf.filteredRoughness;
		float eta = surf.eta;
		bool frontFace = surf.frontFace;

		// sample ggx vndf distribution which gives a new normal
		vec3 halfVector = ggxDirection(
			wo,
			vec2( filteredRoughness ),
			rand2( 13 )
		);

		vec3 lightDirection = refract( normalize( - wo ), halfVector, eta );
		if ( surf.thinFilm ) {

			lightDirection = - refract( normalize( - lightDirection ), - vec3( 0.0, 0.0, 1.0 ), 1.0 / eta );

		}

		return normalize( lightDirection );

	}
	*/

	// TODO: This is just using a basic cosine-weighted specular distribution with an
	// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
	float transmissionEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		color = surf.transmission * surf.color;

		// PDF
		// float F = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		// float F = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );
		// if ( F >= 1.0 ) {

		// 	return 0.0;

		// }

		// return 1.0 / ( 1.0 - F );

		// reverted to previous to transmission. The above was causing black pixels
		float eta = surf.eta;
		float f0 = surf.f0;
		float cosTheta = min( wo.z, 1.0 );
		float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
		float reflectance = schlickFresnel( cosTheta, f0 );
		bool cannotRefract = eta * sinTheta > 1.0;
		if ( cannotRefract ) {

			return 0.0;

		}

		return 1.0 / ( 1.0 - reflectance );

	}

	vec3 transmissionDirection( vec3 wo, SurfaceRecord surf ) {

		float roughness = surf.filteredRoughness;
		float eta = surf.eta;
		vec3 halfVector = normalize( vec3( 0.0, 0.0, 1.0 ) + sampleSphere( rand2( 13 ) ) * roughness );
		vec3 lightDirection = refract( normalize( - wo ), halfVector, eta );

		if ( surf.thinFilm ) {

			lightDirection = - refract( normalize( - lightDirection ), - vec3( 0.0, 0.0, 1.0 ), 1.0 / eta );

		}
		return normalize( lightDirection );

	}

	// clearcoat
	float clearcoatEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		float ior = 1.5;
		float f0 = iorRatioToF0( ior );
		bool frontFace = surf.frontFace;
		float roughness = surf.filteredClearcoatRoughness;

		float eta = frontFace ? 1.0 / ior : ior;
		float G = ggxShadowMaskG2( wi, wo, roughness );
		float D = ggxDistribution( wh, roughness );
		float F = schlickFresnel( dot( wi, wh ), f0 );

		float fClearcoat = F * D * G / ( 4.0 * abs( wi.z * wo.z ) );
		color = color * ( 1.0 - surf.clearcoat * F ) + fClearcoat * surf.clearcoat * wi.z;

		// PDF
		// See equation (27) in http://jcgt.org/published/0003/02/03/
		return ggxPDF( wo, wh, roughness ) / ( 4.0 * dot( wi, wh ) );

	}

	vec3 clearcoatDirection( vec3 wo, SurfaceRecord surf ) {

		// sample ggx vndf distribution which gives a new normal
		float roughness = surf.filteredClearcoatRoughness;
		vec3 halfVector = ggxDirection(
			wo,
			vec2( roughness ),
			rand2( 14 )
		);

		// apply to new ray by reflecting off the new normal
		return - reflect( wo, halfVector );

	}

	// sheen
	vec3 sheenColor( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf ) {

		float cosThetaO = saturateCos( wo.z );
		float cosThetaI = saturateCos( wi.z );
		float cosThetaH = wh.z;

		float D = velvetD( cosThetaH, surf.sheenRoughness );
		float G = velvetG( cosThetaO, cosThetaI, surf.sheenRoughness );

		// See equation (1) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
		vec3 color = surf.sheenColor;
		color *= D * G / ( 4.0 * abs( cosThetaO * cosThetaI ) );
		color *= wi.z;

		return color;

	}

	// bsdf
	void getLobeWeights(
		vec3 wo, vec3 wi, vec3 wh, vec3 clearcoatWo, SurfaceRecord surf,
		inout float diffuseWeight, inout float specularWeight, inout float transmissionWeight, inout float clearcoatWeight
	) {

		float metalness = surf.metalness;
		float transmission = surf.transmission;
		// float fEstimate = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		float fEstimate = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );

		float transSpecularProb = mix( max( 0.25, fEstimate ), 1.0, metalness );
		float diffSpecularProb = 0.5 + 0.5 * metalness;

		diffuseWeight = ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb );
		specularWeight = transmission * transSpecularProb + ( 1.0 - transmission ) * diffSpecularProb;
		transmissionWeight = transmission * ( 1.0 - transSpecularProb );
		clearcoatWeight = surf.clearcoat * schlickFresnel( clearcoatWo.z, 0.04 );

		float totalWeight = diffuseWeight + specularWeight + transmissionWeight + clearcoatWeight;
		diffuseWeight /= totalWeight;
		specularWeight /= totalWeight;
		transmissionWeight /= totalWeight;
		clearcoatWeight /= totalWeight;
	}

	float bsdfEval(
		vec3 wo, vec3 clearcoatWo, vec3 wi, vec3 clearcoatWi, SurfaceRecord surf,
		float diffuseWeight, float specularWeight, float transmissionWeight, float clearcoatWeight, inout float specularPdf, inout vec3 color
	) {

		float metalness = surf.metalness;
		float transmission = surf.transmission;

		float spdf = 0.0;
		float dpdf = 0.0;
		float tpdf = 0.0;
		float cpdf = 0.0;
		color = vec3( 0.0 );

		vec3 halfVector = getHalfVector( wi, wo, surf.eta );

		// diffuse
		if ( diffuseWeight > 0.0 && wi.z > 0.0 ) {

			dpdf = diffuseEval( wo, wi, halfVector, surf, color );
			color *= 1.0 - surf.transmission;

		}

		// ggx specular
		if ( specularWeight > 0.0 && wi.z > 0.0 ) {

			vec3 outColor;
			spdf = specularEval( wo, wi, getHalfVector( wi, wo ), surf, outColor );
			color += outColor;

		}

		// transmission
		if ( transmissionWeight > 0.0 && wi.z < 0.0 ) {

			tpdf = transmissionEval( wo, wi, halfVector, surf, color );

		}

		// sheen
		color *= mix( 1.0, sheenAlbedoScaling( wo, wi, surf ), surf.sheen );
		color += sheenColor( wo, wi, halfVector, surf ) * surf.sheen;

		// clearcoat
		if ( clearcoatWi.z >= 0.0 && clearcoatWeight > 0.0 ) {

			vec3 clearcoatHalfVector = getHalfVector( clearcoatWo, clearcoatWi );
			cpdf = clearcoatEval( clearcoatWo, clearcoatWi, clearcoatHalfVector, surf, color );

		}

		float pdf =
			dpdf * diffuseWeight
			+ spdf * specularWeight
			+ tpdf * transmissionWeight
			+ cpdf * clearcoatWeight;

		// retrieve specular rays for the shadows flag
		specularPdf = spdf * specularWeight + cpdf * clearcoatWeight;

		return pdf;

	}

	float bsdfResult( vec3 worldWo, vec3 worldWi, SurfaceRecord surf, inout vec3 color ) {

		if ( surf.volumeParticle ) {

			color = surf.color / ( 4.0 * PI );
			return 1.0 / ( 4.0 * PI );

		}

		vec3 wo = normalize( surf.normalInvBasis * worldWo );
		vec3 wi = normalize( surf.normalInvBasis * worldWi );

		vec3 clearcoatWo = normalize( surf.clearcoatInvBasis * worldWo );
		vec3 clearcoatWi = normalize( surf.clearcoatInvBasis * worldWi );

		vec3 wh = getHalfVector( wo, wi, surf.eta );
		float diffuseWeight;
		float specularWeight;
		float transmissionWeight;
		float clearcoatWeight;
		getLobeWeights( wo, wi, wh, clearcoatWo, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );

		float specularPdf;
		return bsdfEval( wo, clearcoatWo, wi, clearcoatWi, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight, specularPdf, color );

	}

	ScatterRecord bsdfSample( vec3 worldWo, SurfaceRecord surf ) {

		if ( surf.volumeParticle ) {

			ScatterRecord sampleRec;
			sampleRec.specularPdf = 0.0;
			sampleRec.pdf = 1.0 / ( 4.0 * PI );
			sampleRec.direction = sampleSphere( rand2( 16 ) );
			sampleRec.color = surf.color / ( 4.0 * PI );
			return sampleRec;

		}

		vec3 wo = normalize( surf.normalInvBasis * worldWo );
		vec3 clearcoatWo = normalize( surf.clearcoatInvBasis * worldWo );
		mat3 normalBasis = surf.normalBasis;
		mat3 invBasis = surf.normalInvBasis;
		mat3 clearcoatNormalBasis = surf.clearcoatBasis;
		mat3 clearcoatInvBasis = surf.clearcoatInvBasis;

		float diffuseWeight;
		float specularWeight;
		float transmissionWeight;
		float clearcoatWeight;
		// using normal and basically-reflected ray since we don't have proper half vector here
		getLobeWeights( wo, wo, vec3( 0, 0, 1 ), clearcoatWo, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );

		float pdf[4];
		pdf[0] = diffuseWeight;
		pdf[1] = specularWeight;
		pdf[2] = transmissionWeight;
		pdf[3] = clearcoatWeight;

		float cdf[4];
		cdf[0] = pdf[0];
		cdf[1] = pdf[1] + cdf[0];
		cdf[2] = pdf[2] + cdf[1];
		cdf[3] = pdf[3] + cdf[2];

		if( cdf[3] != 0.0 ) {

			float invMaxCdf = 1.0 / cdf[3];
			cdf[0] *= invMaxCdf;
			cdf[1] *= invMaxCdf;
			cdf[2] *= invMaxCdf;
			cdf[3] *= invMaxCdf;

		} else {

			cdf[0] = 1.0;
			cdf[1] = 0.0;
			cdf[2] = 0.0;
			cdf[3] = 0.0;

		}

		vec3 wi;
		vec3 clearcoatWi;

		float r = rand( 15 );
		if ( r <= cdf[0] ) { // diffuse

			wi = diffuseDirection( wo, surf );
			clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

		} else if ( r <= cdf[1] ) { // specular

			wi = specularDirection( wo, surf );
			clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

		} else if ( r <= cdf[2] ) { // transmission / refraction

			wi = transmissionDirection( wo, surf );
			clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

		} else if ( r <= cdf[3] ) { // clearcoat

			clearcoatWi = clearcoatDirection( clearcoatWo, surf );
			wi = normalize( invBasis * normalize( clearcoatNormalBasis * clearcoatWi ) );

		}

		ScatterRecord result;
		result.pdf = bsdfEval( wo, clearcoatWo, wi, clearcoatWi, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight, result.specularPdf, result.color );
		result.direction = normalize( surf.normalBasis * wi );

		return result;

	}

`;var Mv=`

	// returns the hit distance given the material density
	float intersectFogVolume( Material material, float u ) {

		// https://raytracing.github.io/books/RayTracingTheNextWeek.html#volumes/constantdensitymediums
		return material.opacity == 0.0 ? INFINITY : ( - 1.0 / material.opacity ) * log( u );

	}

	ScatterRecord sampleFogVolume( SurfaceRecord surf, vec2 uv ) {

		ScatterRecord sampleRec;
		sampleRec.specularPdf = 0.0;
		sampleRec.pdf = 1.0 / ( 2.0 * PI );
		sampleRec.direction = sampleSphere( uv );
		sampleRec.color = surf.color;
		return sampleRec;

	}

`;var Tv=`

	// The GGX functions provide sampling and distribution information for normals as output so
	// in order to get probability of scatter direction the half vector must be computed and provided.
	// [0] https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf
	// [1] https://hal.archives-ouvertes.fr/hal-01509746/document
	// [2] http://jcgt.org/published/0007/04/01/
	// [4] http://jcgt.org/published/0003/02/03/

	// trowbridge-reitz === GGX === GTR

	vec3 ggxDirection( vec3 incidentDir, vec2 roughness, vec2 uv ) {

		// TODO: try GGXVNDF implementation from reference [2], here. Needs to update ggxDistribution
		// function below, as well

		// Implementation from reference [1]
		// stretch view
		vec3 V = normalize( vec3( roughness * incidentDir.xy, incidentDir.z ) );

		// orthonormal basis
		vec3 T1 = ( V.z < 0.9999 ) ? normalize( cross( V, vec3( 0.0, 0.0, 1.0 ) ) ) : vec3( 1.0, 0.0, 0.0 );
		vec3 T2 = cross( T1, V );

		// sample point with polar coordinates (r, phi)
		float a = 1.0 / ( 1.0 + V.z );
		float r = sqrt( uv.x );
		float phi = ( uv.y < a ) ? uv.y / a * PI : PI + ( uv.y - a ) / ( 1.0 - a ) * PI;
		float P1 = r * cos( phi );
		float P2 = r * sin( phi ) * ( ( uv.y < a ) ? 1.0 : V.z );

		// compute normal
		vec3 N = P1 * T1 + P2 * T2 + V * sqrt( max( 0.0, 1.0 - P1 * P1 - P2 * P2 ) );

		// unstretch
		N = normalize( vec3( roughness * N.xy, max( 0.0, N.z ) ) );

		return N;

	}

	// Below are PDF and related functions for use in a Monte Carlo path tracer
	// as specified in Appendix B of the following paper
	// See equation (34) from reference [0]
	float ggxLamda( float theta, float roughness ) {

		float tanTheta = tan( theta );
		float tanTheta2 = tanTheta * tanTheta;
		float alpha2 = roughness * roughness;

		float numerator = - 1.0 + sqrt( 1.0 + alpha2 * tanTheta2 );
		return numerator / 2.0;

	}

	// See equation (34) from reference [0]
	float ggxShadowMaskG1( float theta, float roughness ) {

		return 1.0 / ( 1.0 + ggxLamda( theta, roughness ) );

	}

	// See equation (125) from reference [4]
	float ggxShadowMaskG2( vec3 wi, vec3 wo, float roughness ) {

		float incidentTheta = acos( wi.z );
		float scatterTheta = acos( wo.z );
		return 1.0 / ( 1.0 + ggxLamda( incidentTheta, roughness ) + ggxLamda( scatterTheta, roughness ) );

	}

	// See equation (33) from reference [0]
	float ggxDistribution( vec3 halfVector, float roughness ) {

		float a2 = roughness * roughness;
		a2 = max( EPSILON, a2 );
		float cosTheta = halfVector.z;
		float cosTheta4 = pow( cosTheta, 4.0 );

		if ( cosTheta == 0.0 ) return 0.0;

		float theta = acosSafe( halfVector.z );
		float tanTheta = tan( theta );
		float tanTheta2 = pow( tanTheta, 2.0 );

		float denom = PI * cosTheta4 * pow( a2 + tanTheta2, 2.0 );
		return ( a2 / denom );

	}

	// See equation (3) from reference [2]
	float ggxPDF( vec3 wi, vec3 halfVector, float roughness ) {

		float incidentTheta = acos( wi.z );
		float D = ggxDistribution( halfVector, roughness );
		float G1 = ggxShadowMaskG1( incidentTheta, roughness );

		return D * G1 * max( 0.0, dot( wi, halfVector ) ) / wi.z;

	}

`;var wv=`

	// XYZ to sRGB color space
	const mat3 XYZ_TO_REC709 = mat3(
		3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);

	vec3 fresnel0ToIor( vec3 fresnel0 ) {

		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );

	}

	// Conversion FO/IOR
	vec3 iorToFresnel0( vec3 transmittedIor, float incidentIor ) {

		return square( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );

	}

	// ior is a value between 1.0 and 3.0. 1.0 is air interface
	float iorToFresnel0( float transmittedIor, float incidentIor ) {

		return square( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ) );

	}

	// Fresnel equations for dielectric/dielectric interfaces. See https://belcour.github.io/blog/research/2017/05/01/brdf-thin-film.html
	vec3 evalSensitivity( float OPD, vec3 shift ) {

		float phase = 2.0 * PI * OPD * 1.0e-9;

		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );

		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - square( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * square( phase ) );
		xyz /= 1.0685e-7;

		vec3 srgb = XYZ_TO_REC709 * xyz;
		return srgb;

	}

	// See Section 4. Analytic Spectral Integration, A Practical Extension to Microfacet Theory for the Modeling of Varying Iridescence, https://hal.archives-ouvertes.fr/hal-01518344/document
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {

		vec3 I;

		// Force iridescenceIor -> outsideIOR when thinFilmThickness -> 0.0
		float iridescenceIor = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );

		// Evaluate the cosTheta on the base layer (Snell law)
		float sinTheta2Sq = square( outsideIOR / iridescenceIor ) * ( 1.0 - square( cosTheta1 ) );

		// Handle TIR:
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {

			return vec3( 1.0 );

		}

		float cosTheta2 = sqrt( cosTheta2Sq );

		// First interface
		float R0 = iorToFresnel0( iridescenceIor, outsideIOR );
		float R12 = schlickFresnel( cosTheta1, R0 );
		float R21 = R12;
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIor < outsideIOR ) {

			phi12 = PI;

		}

		float phi21 = PI - phi12;

		// Second interface
		vec3 baseIOR = fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) ); // guard against 1.0
		vec3 R1 = iorToFresnel0( baseIOR, iridescenceIor );
		vec3 R23 = schlickFresnel( cosTheta2, R1 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[0] < iridescenceIor ) {

			phi23[ 0 ] = PI;

		}

		if ( baseIOR[1] < iridescenceIor ) {

			phi23[ 1 ] = PI;

		}

		if ( baseIOR[2] < iridescenceIor ) {

			phi23[ 2 ] = PI;

		}

		// Phase shift
		float OPD = 2.0 * iridescenceIor * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;

		// Compound terms
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = square( T121 ) * R23 / ( vec3( 1.0 ) - R123 );

		// Reflectance term for m = 0 (DC term amplitude)
		vec3 C0 = R12 + Rs;
		I = C0;

		// Reflectance term for m > 0 (pairs of diracs)
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {

			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;

		}

		// Since out of gamut colors might be produced, negative color values are clamped to 0.
		return max( I, vec3( 0.0 ) );

	}

`;var Av=`

	// See equation (2) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
	float velvetD( float cosThetaH, float roughness ) {

		float alpha = max( roughness, 0.07 );
		alpha = alpha * alpha;

		float invAlpha = 1.0 / alpha;

		float sqrCosThetaH = cosThetaH * cosThetaH;
		float sinThetaH = max( 1.0 - sqrCosThetaH, 0.001 );

		return ( 2.0 + invAlpha ) * pow( sinThetaH, 0.5 * invAlpha ) / ( 2.0 * PI );

	}

	float velvetParamsInterpolate( int i, float oneMinusAlphaSquared ) {

		const float p0[5] = float[5]( 25.3245, 3.32435, 0.16801, -1.27393, -4.85967 );
		const float p1[5] = float[5]( 21.5473, 3.82987, 0.19823, -1.97760, -4.32054 );

		return mix( p1[i], p0[i], oneMinusAlphaSquared );

	}

	float velvetL( float x, float alpha ) {

		float oneMinusAlpha = 1.0 - alpha;
		float oneMinusAlphaSquared = oneMinusAlpha * oneMinusAlpha;

		float a = velvetParamsInterpolate( 0, oneMinusAlphaSquared );
		float b = velvetParamsInterpolate( 1, oneMinusAlphaSquared );
		float c = velvetParamsInterpolate( 2, oneMinusAlphaSquared );
		float d = velvetParamsInterpolate( 3, oneMinusAlphaSquared );
		float e = velvetParamsInterpolate( 4, oneMinusAlphaSquared );

		return a / ( 1.0 + b * pow( abs( x ), c ) ) + d * x + e;

	}

	// See equation (3) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
	float velvetLambda( float cosTheta, float alpha ) {

		return abs( cosTheta ) < 0.5 ? exp( velvetL( cosTheta, alpha ) ) : exp( 2.0 * velvetL( 0.5, alpha ) - velvetL( 1.0 - cosTheta, alpha ) );

	}

	// See Section 3, Shadowing Term, in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
	float velvetG( float cosThetaO, float cosThetaI, float roughness ) {

		float alpha = max( roughness, 0.07 );
		alpha = alpha * alpha;

		return 1.0 / ( 1.0 + velvetLambda( cosThetaO, alpha ) + velvetLambda( cosThetaI, alpha ) );

	}

	float directionalAlbedoSheen( float cosTheta, float alpha ) {

		cosTheta = saturate( cosTheta );

		float c = 1.0 - cosTheta;
		float c3 = c * c * c;

		return 0.65584461 * c3 + 1.0 / ( 4.16526551 + exp( -7.97291361 * sqrt( alpha ) + 6.33516894 ) );

	}

	float sheenAlbedoScaling( vec3 wo, vec3 wi, SurfaceRecord surf ) {

		float alpha = max( surf.sheenRoughness, 0.07 );
		alpha = alpha * alpha;

		float maxSheenColor = max( max( surf.sheenColor.r, surf.sheenColor.g ), surf.sheenColor.b );

		float eWo = directionalAlbedoSheen( saturateCos( wo.z ), alpha );
		float eWi = directionalAlbedoSheen( saturateCos( wi.z ), alpha );

		return min( 1.0 - maxSheenColor * eWo, 1.0 - maxSheenColor * eWi );

	}

	// See Section 5, Layering, in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
	float sheenAlbedoScaling( vec3 wo, SurfaceRecord surf ) {

		float alpha = max( surf.sheenRoughness, 0.07 );
		alpha = alpha * alpha;

		float maxSheenColor = max( max( surf.sheenColor.r, surf.sheenColor.g ), surf.sheenColor.b );

		float eWo = directionalAlbedoSheen( saturateCos( wo.z ), alpha );

		return 1.0 - maxSheenColor * eWo;

	}

`;var Ev=`

#ifndef FOG_CHECK_ITERATIONS
#define FOG_CHECK_ITERATIONS 30
#endif

// returns whether the given material is a fog material or not
bool isMaterialFogVolume( sampler2D materials, uint materialIndex ) {

	uint i = materialIndex * uint( MATERIAL_PIXELS );
	vec4 s14 = texelFetch1D( materials, i + 14u );
	return bool( int( s14.b ) & 4 );

}

// returns true if we're within the first fog volume we hit
bool bvhIntersectFogVolumeHit(
	vec3 rayOrigin, vec3 rayDirection,
	usampler2D materialIndexAttribute, sampler2D materials,
	inout Material material
) {

	material.fogVolume = false;

	for ( int i = 0; i < FOG_CHECK_ITERATIONS; i ++ ) {

		// find nearest hit
		uvec4 faceIndices = uvec4( 0u );
		vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
		vec3 barycoord = vec3( 0.0 );
		float side = 1.0;
		float dist = 0.0;
		bool hit = bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
		if ( hit ) {

			// if it's a fog volume return whether we hit the front or back face
			uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
			if ( isMaterialFogVolume( materials, materialIndex ) ) {

				material = readMaterialInfo( materials, materialIndex );
				return side == - 1.0;

			} else {

				// move the ray forward
				rayOrigin = stepRayOrigin( rayOrigin, rayDirection, - faceNormal, dist );

			}

		} else {

			return false;

		}

	}

	return false;

}

`;var Rv=`

	// step through multiple surface hits and accumulate color attenuation based on transmissive surfaces
	// returns true if a solid surface was hit
	bool attenuateHit(
		RenderState state,
		Ray ray, float rayDist,
		out vec3 color
	) {

		// store the original bounce index so we can reset it after
		uint originalBounceIndex = sobolBounceIndex;

		int traversals = state.traversals;
		int transmissiveTraversals = state.transmissiveTraversals;
		bool isShadowRay = state.isShadowRay;
		Material fogMaterial = state.fogMaterial;

		vec3 startPoint = ray.origin;

		// hit results
		SurfaceHit surfaceHit;

		color = vec3( 1.0 );

		bool result = true;
		for ( int i = 0; i < traversals; i ++ ) {

			sobolBounceIndex ++;

			int hitType = traceScene( ray, fogMaterial, surfaceHit );

			if ( hitType == FOG_HIT ) {

				result = true;
				break;

			} else if ( hitType == SURFACE_HIT ) {

				float totalDist = distance( startPoint, ray.origin + ray.direction * surfaceHit.dist );
				if ( totalDist > rayDist ) {

					result = false;
					break;

				}

				// TODO: attenuate the contribution based on the PDF of the resulting ray including refraction values
				// Should be able to work using the material BSDF functions which will take into account specularity, etc.
				// TODO: should we account for emissive surfaces here?

				uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
				Material material = readMaterialInfo( materials, materialIndex );

				// adjust the ray to the new surface
				bool isEntering = surfaceHit.side == 1.0;
				ray.origin = stepRayOrigin( ray.origin, ray.direction, - surfaceHit.faceNormal, surfaceHit.dist );

				#if FEATURE_FOG

				if ( material.fogVolume ) {

					fogMaterial = material;
					fogMaterial.fogVolume = surfaceHit.side == 1.0;
					i -= sign( transmissiveTraversals );
					transmissiveTraversals --;
					continue;

				}

				#endif

				if ( ! material.castShadow && isShadowRay ) {

					continue;

				}

				vec2 uv = textureSampleBarycoord( attributesArray, ATTR_UV, surfaceHit.barycoord, surfaceHit.faceIndices.xyz ).xy;
				vec4 vertexColor = textureSampleBarycoord( attributesArray, ATTR_COLOR, surfaceHit.barycoord, surfaceHit.faceIndices.xyz );

				// albedo
				vec4 albedo = vec4( material.color, material.opacity );
				if ( material.map != - 1 ) {

					vec3 uvPrime = material.mapTransform * vec3( uv, 1 );
					albedo *= texture2D( textures, vec3( uvPrime.xy, material.map ) );

				}

				if ( material.vertexColors ) {

					albedo *= vertexColor;

				}

				// alphaMap
				if ( material.alphaMap != - 1 ) {

					vec3 uvPrime = material.alphaMapTransform * vec3( uv, 1 );
					albedo.a *= texture2D( textures, vec3( uvPrime.xy, material.alphaMap ) ).x;

				}

				// transmission
				float transmission = material.transmission;
				if ( material.transmissionMap != - 1 ) {

					vec3 uvPrime = material.transmissionMapTransform * vec3( uv, 1 );
					transmission *= texture2D( textures, vec3( uvPrime.xy, material.transmissionMap ) ).r;

				}

				// metalness
				float metalness = material.metalness;
				if ( material.metalnessMap != - 1 ) {

					vec3 uvPrime = material.metalnessMapTransform * vec3( uv, 1 );
					metalness *= texture2D( textures, vec3( uvPrime.xy, material.metalnessMap ) ).b;

				}

				float alphaTest = material.alphaTest;
				bool useAlphaTest = alphaTest != 0.0;
				float transmissionFactor = ( 1.0 - metalness ) * transmission;
				if (
					transmissionFactor < rand( 9 ) && ! (
						// material sidedness
						material.side != 0.0 && surfaceHit.side == material.side

						// alpha test
						|| useAlphaTest && albedo.a < alphaTest

						// opacity
						|| material.transparent && ! useAlphaTest && albedo.a < rand( 10 )
					)
				) {

					result = true;
					break;

				}

				if ( surfaceHit.side == 1.0 && isEntering ) {

					// only attenuate by surface color on the way in
					color *= mix( vec3( 1.0 ), albedo.rgb, transmissionFactor );

				} else if ( surfaceHit.side == - 1.0 ) {

					// attenuate by medium once we hit the opposite side of the model
					color *= transmissionAttenuation( surfaceHit.dist, material.attenuationColor, material.attenuationDistance );

				}

				bool isTransmissiveRay = dot( ray.direction, surfaceHit.faceNormal * surfaceHit.side ) < 0.0;
				if ( ( isTransmissiveRay || isEntering ) && transmissiveTraversals > 0 ) {

					i -= sign( transmissiveTraversals );
					transmissiveTraversals --;

				}

			} else {

				result = false;
				break;

			}

		}

		// reset the bounce index
		sobolBounceIndex = originalBounceIndex;
		return result;

	}

`;var Cv=`

	vec3 ndcToRayOrigin( vec2 coord ) {

		vec4 rayOrigin4 = cameraWorldMatrix * invProjectionMatrix * vec4( coord, - 1.0, 1.0 );
		return rayOrigin4.xyz / rayOrigin4.w;
	}

	Ray getCameraRay() {

		vec2 ssd = vec2( 1.0 ) / resolution;

		// Jitter the camera ray by finding a uv coordinate at a random sample
		// around this pixel's UV coordinate for AA
		vec2 ruv = rand2( 0 );
		vec2 jitteredUv = vUv + vec2( tentFilter( ruv.x ) * ssd.x, tentFilter( ruv.y ) * ssd.y );
		Ray ray;

		#if CAMERA_TYPE == 2

			// Equirectangular projection
			vec4 rayDirection4 = vec4( equirectUvToDirection( jitteredUv ), 0.0 );
			vec4 rayOrigin4 = vec4( 0.0, 0.0, 0.0, 1.0 );

			rayDirection4 = cameraWorldMatrix * rayDirection4;
			rayOrigin4 = cameraWorldMatrix * rayOrigin4;

			ray.direction = normalize( rayDirection4.xyz );
			ray.origin = rayOrigin4.xyz / rayOrigin4.w;

		#else

			// get [- 1, 1] normalized device coordinates
			vec2 ndc = 2.0 * jitteredUv - vec2( 1.0 );
			ray.origin = ndcToRayOrigin( ndc );

			#if CAMERA_TYPE == 1

				// Orthographic projection
				ray.direction = ( cameraWorldMatrix * vec4( 0.0, 0.0, - 1.0, 0.0 ) ).xyz;
				ray.direction = normalize( ray.direction );

			#else

				// Perspective projection
				ray.direction = normalize( mat3( cameraWorldMatrix ) * ( invProjectionMatrix * vec4( ndc, 0.0, 1.0 ) ).xyz );

			#endif

		#endif

		#if FEATURE_DOF
		{

			// depth of field
			vec3 focalPoint = ray.origin + normalize( ray.direction ) * physicalCamera.focusDistance;

			// get the aperture sample
			// if blades === 0 then we assume a circle
			vec3 shapeUVW= rand3( 1 );
			int blades = physicalCamera.apertureBlades;
			float anamorphicRatio = physicalCamera.anamorphicRatio;
			vec2 apertureSample = sampleAperture( blades, shapeUVW );
			apertureSample *= physicalCamera.bokehSize * 0.5 * 1e-3;

			// rotate the aperture shape
			apertureSample =
				rotateVector( apertureSample, physicalCamera.apertureRotation ) *
				saturate( vec2( anamorphicRatio, 1.0 / anamorphicRatio ) );

			// create the new ray
			ray.origin += ( cameraWorldMatrix * vec4( apertureSample, 0.0, 0.0 ) ).xyz;
			ray.direction = focalPoint - ray.origin;

		}
		#endif

		ray.direction = normalize( ray.direction );

		return ray;

	}

`;var Iv=`

	vec3 directLightContribution( vec3 worldWo, SurfaceRecord surf, RenderState state, vec3 rayOrigin ) {

		vec3 result = vec3( 0.0 );

		// uniformly pick a light or environment map
		if( lightsDenom != 0.0 && rand( 5 ) < float( lights.count ) / lightsDenom ) {

			// sample a light or environment
			LightRecord lightRec = randomLightSample( lights.tex, iesProfiles, lights.count, rayOrigin, rand3( 6 ) );

			bool isSampleBelowSurface = ! surf.volumeParticle && dot( surf.faceNormal, lightRec.direction ) < 0.0;
			if ( isSampleBelowSurface ) {

				lightRec.pdf = 0.0;

			}

			// check if a ray could even reach the light area
			Ray lightRay;
			lightRay.origin = rayOrigin;
			lightRay.direction = lightRec.direction;
			vec3 attenuatedColor;
			if (
				lightRec.pdf > 0.0 &&
				isDirectionValid( lightRec.direction, surf.normal, surf.faceNormal ) &&
				! attenuateHit( state, lightRay, lightRec.dist, attenuatedColor )
			) {

				// get the material pdf
				vec3 sampleColor;
				float lightMaterialPdf = bsdfResult( worldWo, lightRec.direction, surf, sampleColor );
				bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
				if ( lightMaterialPdf > 0.0 && isValidSampleColor ) {

					// weight the direct light contribution
					float lightPdf = lightRec.pdf / lightsDenom;
					float misWeight = lightRec.type == SPOT_LIGHT_TYPE || lightRec.type == DIR_LIGHT_TYPE || lightRec.type == POINT_LIGHT_TYPE ? 1.0 : misHeuristic( lightPdf, lightMaterialPdf );
					result = attenuatedColor * lightRec.emission * state.throughputColor * sampleColor * misWeight / lightPdf;

				}

			}

		} else if ( envMapInfo.totalSum != 0.0 && environmentIntensity != 0.0 ) {

			// find a sample in the environment map to include in the contribution
			vec3 envColor, envDirection;
			float envPdf = sampleEquirectProbability( rand2( 7 ), envColor, envDirection );
			envDirection = invEnvRotation3x3 * envDirection;

			// this env sampling is not set up for transmissive sampling and yields overly bright
			// results so we ignore the sample in this case.
			// TODO: this should be improved but how? The env samples could traverse a few layers?
			bool isSampleBelowSurface = ! surf.volumeParticle && dot( surf.faceNormal, envDirection ) < 0.0;
			if ( isSampleBelowSurface ) {

				envPdf = 0.0;

			}

			// check if a ray could even reach the surface
			Ray envRay;
			envRay.origin = rayOrigin;
			envRay.direction = envDirection;
			vec3 attenuatedColor;
			if (
				envPdf > 0.0 &&
				isDirectionValid( envDirection, surf.normal, surf.faceNormal ) &&
				! attenuateHit( state, envRay, INFINITY, attenuatedColor )
			) {

				// get the material pdf
				vec3 sampleColor;
				float envMaterialPdf = bsdfResult( worldWo, envDirection, surf, sampleColor );
				bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
				if ( envMaterialPdf > 0.0 && isValidSampleColor ) {

					// weight the direct light contribution
					envPdf /= lightsDenom;
					float misWeight = misHeuristic( envPdf, envMaterialPdf );
					result = attenuatedColor * environmentIntensity * envColor * state.throughputColor * sampleColor * misWeight / envPdf;

				}

			}

		}

		// Function changed to have a single return statement to potentially help with crashes on Mac OS.
		// See issue #470
		return result;

	}

`;var Pv=`

	#define SKIP_SURFACE 0
	#define HIT_SURFACE 1
	int getSurfaceRecord(
		Material material, SurfaceHit surfaceHit, sampler2DArray attributesArray,
		float accumulatedRoughness,
		inout SurfaceRecord surf
	) {

		if ( material.fogVolume ) {

			vec3 normal = vec3( 0, 0, 1 );

			SurfaceRecord fogSurface;
			fogSurface.volumeParticle = true;
			fogSurface.color = material.color;
			fogSurface.emission = material.emissiveIntensity * material.emissive;
			fogSurface.normal = normal;
			fogSurface.faceNormal = normal;
			fogSurface.clearcoatNormal = normal;

			surf = fogSurface;
			return HIT_SURFACE;

		}

		// uv coord for textures
		vec2 uv = textureSampleBarycoord( attributesArray, ATTR_UV, surfaceHit.barycoord, surfaceHit.faceIndices.xyz ).xy;
		vec4 vertexColor = textureSampleBarycoord( attributesArray, ATTR_COLOR, surfaceHit.barycoord, surfaceHit.faceIndices.xyz );

		// albedo
		vec4 albedo = vec4( material.color, material.opacity );
		if ( material.map != - 1 ) {

			vec3 uvPrime = material.mapTransform * vec3( uv, 1 );
			albedo *= texture2D( textures, vec3( uvPrime.xy, material.map ) );

		}

		if ( material.vertexColors ) {

			albedo *= vertexColor;

		}

		// alphaMap
		if ( material.alphaMap != - 1 ) {

			vec3 uvPrime = material.alphaMapTransform * vec3( uv, 1 );
			albedo.a *= texture2D( textures, vec3( uvPrime.xy, material.alphaMap ) ).x;

		}

		// possibly skip this sample if it's transparent, alpha test is enabled, or we hit the wrong material side
		// and it's single sided.
		// - alpha test is disabled when it === 0
		// - the material sidedness test is complicated because we want light to pass through the back side but still
		// be able to see the front side. This boolean checks if the side we hit is the front side on the first ray
		// and we're rendering the other then we skip it. Do the opposite on subsequent bounces to get incoming light.
		float alphaTest = material.alphaTest;
		bool useAlphaTest = alphaTest != 0.0;
		if (
			// material sidedness
			material.side != 0.0 && surfaceHit.side != material.side

			// alpha test
			|| useAlphaTest && albedo.a < alphaTest

			// opacity
			|| material.transparent && ! useAlphaTest && albedo.a < rand( 3 )
		) {

			return SKIP_SURFACE;

		}

		// fetch the interpolated smooth normal
		vec3 normal = normalize( textureSampleBarycoord(
			attributesArray,
			ATTR_NORMAL,
			surfaceHit.barycoord,
			surfaceHit.faceIndices.xyz
		).xyz );

		// roughness
		float roughness = material.roughness;
		if ( material.roughnessMap != - 1 ) {

			vec3 uvPrime = material.roughnessMapTransform * vec3( uv, 1 );
			roughness *= texture2D( textures, vec3( uvPrime.xy, material.roughnessMap ) ).g;

		}

		// metalness
		float metalness = material.metalness;
		if ( material.metalnessMap != - 1 ) {

			vec3 uvPrime = material.metalnessMapTransform * vec3( uv, 1 );
			metalness *= texture2D( textures, vec3( uvPrime.xy, material.metalnessMap ) ).b;

		}

		// emission
		vec3 emission = material.emissiveIntensity * material.emissive;
		if ( material.emissiveMap != - 1 ) {

			vec3 uvPrime = material.emissiveMapTransform * vec3( uv, 1 );
			emission *= texture2D( textures, vec3( uvPrime.xy, material.emissiveMap ) ).xyz;

		}

		// transmission
		float transmission = material.transmission;
		if ( material.transmissionMap != - 1 ) {

			vec3 uvPrime = material.transmissionMapTransform * vec3( uv, 1 );
			transmission *= texture2D( textures, vec3( uvPrime.xy, material.transmissionMap ) ).r;

		}

		// normal
		if ( material.flatShading ) {

			// if we're rendering a flat shaded object then use the face normals - the face normal
			// is provided based on the side the ray hits the mesh so flip it to align with the
			// interpolated vertex normals.
			normal = surfaceHit.faceNormal * surfaceHit.side;

		}

		vec3 baseNormal = normal;
		if ( material.normalMap != - 1 ) {

			vec4 tangentSample = textureSampleBarycoord(
				attributesArray,
				ATTR_TANGENT,
				surfaceHit.barycoord,
				surfaceHit.faceIndices.xyz
			);

			// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
			// resulting in NaNs and slow path tracing.
			if ( length( tangentSample.xyz ) > 0.0 ) {

				vec3 tangent = normalize( tangentSample.xyz );
				vec3 bitangent = normalize( cross( normal, tangent ) * tangentSample.w );
				mat3 vTBN = mat3( tangent, bitangent, normal );

				vec3 uvPrime = material.normalMapTransform * vec3( uv, 1 );
				vec3 texNormal = texture2D( textures, vec3( uvPrime.xy, material.normalMap ) ).xyz * 2.0 - 1.0;
				texNormal.xy *= material.normalScale;
				normal = vTBN * texNormal;

			}

		}

		normal *= surfaceHit.side;

		// clearcoat
		float clearcoat = material.clearcoat;
		if ( material.clearcoatMap != - 1 ) {

			vec3 uvPrime = material.clearcoatMapTransform * vec3( uv, 1 );
			clearcoat *= texture2D( textures, vec3( uvPrime.xy, material.clearcoatMap ) ).r;

		}

		// clearcoatRoughness
		float clearcoatRoughness = material.clearcoatRoughness;
		if ( material.clearcoatRoughnessMap != - 1 ) {

			vec3 uvPrime = material.clearcoatRoughnessMapTransform * vec3( uv, 1 );
			clearcoatRoughness *= texture2D( textures, vec3( uvPrime.xy, material.clearcoatRoughnessMap ) ).g;

		}

		// clearcoatNormal
		vec3 clearcoatNormal = baseNormal;
		if ( material.clearcoatNormalMap != - 1 ) {

			vec4 tangentSample = textureSampleBarycoord(
				attributesArray,
				ATTR_TANGENT,
				surfaceHit.barycoord,
				surfaceHit.faceIndices.xyz
			);

			// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
			// resulting in NaNs and slow path tracing.
			if ( length( tangentSample.xyz ) > 0.0 ) {

				vec3 tangent = normalize( tangentSample.xyz );
				vec3 bitangent = normalize( cross( clearcoatNormal, tangent ) * tangentSample.w );
				mat3 vTBN = mat3( tangent, bitangent, clearcoatNormal );

				vec3 uvPrime = material.clearcoatNormalMapTransform * vec3( uv, 1 );
				vec3 texNormal = texture2D( textures, vec3( uvPrime.xy, material.clearcoatNormalMap ) ).xyz * 2.0 - 1.0;
				texNormal.xy *= material.clearcoatNormalScale;
				clearcoatNormal = vTBN * texNormal;

			}

		}

		clearcoatNormal *= surfaceHit.side;

		// sheenColor
		vec3 sheenColor = material.sheenColor;
		if ( material.sheenColorMap != - 1 ) {

			vec3 uvPrime = material.sheenColorMapTransform * vec3( uv, 1 );
			sheenColor *= texture2D( textures, vec3( uvPrime.xy, material.sheenColorMap ) ).rgb;

		}

		// sheenRoughness
		float sheenRoughness = material.sheenRoughness;
		if ( material.sheenRoughnessMap != - 1 ) {

			vec3 uvPrime = material.sheenRoughnessMapTransform * vec3( uv, 1 );
			sheenRoughness *= texture2D( textures, vec3( uvPrime.xy, material.sheenRoughnessMap ) ).a;

		}

		// iridescence
		float iridescence = material.iridescence;
		if ( material.iridescenceMap != - 1 ) {

			vec3 uvPrime = material.iridescenceMapTransform * vec3( uv, 1 );
			iridescence *= texture2D( textures, vec3( uvPrime.xy, material.iridescenceMap ) ).r;

		}

		// iridescence thickness
		float iridescenceThickness = material.iridescenceThicknessMaximum;
		if ( material.iridescenceThicknessMap != - 1 ) {

			vec3 uvPrime = material.iridescenceThicknessMapTransform * vec3( uv, 1 );
			float iridescenceThicknessSampled = texture2D( textures, vec3( uvPrime.xy, material.iridescenceThicknessMap ) ).g;
			iridescenceThickness = mix( material.iridescenceThicknessMinimum, material.iridescenceThicknessMaximum, iridescenceThicknessSampled );

		}

		iridescence = iridescenceThickness == 0.0 ? 0.0 : iridescence;

		// specular color
		vec3 specularColor = material.specularColor;
		if ( material.specularColorMap != - 1 ) {

			vec3 uvPrime = material.specularColorMapTransform * vec3( uv, 1 );
			specularColor *= texture2D( textures, vec3( uvPrime.xy, material.specularColorMap ) ).rgb;

		}

		// specular intensity
		float specularIntensity = material.specularIntensity;
		if ( material.specularIntensityMap != - 1 ) {

			vec3 uvPrime = material.specularIntensityMapTransform * vec3( uv, 1 );
			specularIntensity *= texture2D( textures, vec3( uvPrime.xy, material.specularIntensityMap ) ).a;

		}

		surf.volumeParticle = false;

		surf.faceNormal = surfaceHit.faceNormal;
		surf.normal = normal;

		surf.metalness = metalness;
		surf.color = albedo.rgb;
		surf.emission = emission;

		surf.ior = material.ior;
		surf.transmission = transmission;
		surf.thinFilm = material.thinFilm;
		surf.attenuationColor = material.attenuationColor;
		surf.attenuationDistance = material.attenuationDistance;

		surf.clearcoatNormal = clearcoatNormal;
		surf.clearcoat = clearcoat;

		surf.sheen = material.sheen;
		surf.sheenColor = sheenColor;

		surf.iridescence = iridescence;
		surf.iridescenceIor = material.iridescenceIor;
		surf.iridescenceThickness = iridescenceThickness;

		surf.specularColor = specularColor;
		surf.specularIntensity = specularIntensity;

		// apply perceptual roughness factor from gltf. sheen perceptual roughness is
		// applied by its brdf function
		// https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#microfacet-surfaces
		surf.roughness = roughness * roughness;
		surf.clearcoatRoughness = clearcoatRoughness * clearcoatRoughness;
		surf.sheenRoughness = sheenRoughness;

		// frontFace is used to determine transmissive properties and PDF. If no transmission is used
		// then we can just always assume this is a front face.
		surf.frontFace = surfaceHit.side == 1.0 || transmission == 0.0;
		surf.eta = material.thinFilm || surf.frontFace ? 1.0 / material.ior : material.ior;
		surf.f0 = iorRatioToF0( surf.eta );

		// Compute the filtered roughness value to use during specular reflection computations.
		// The accumulated roughness value is scaled by a user setting and a "magic value" of 5.0.
		// If we're exiting something transmissive then scale the factor down significantly so we can retain
		// sharp internal reflections
		surf.filteredRoughness = applyFilteredGlossy( surf.roughness, accumulatedRoughness );
		surf.filteredClearcoatRoughness = applyFilteredGlossy( surf.clearcoatRoughness, accumulatedRoughness );

		// get the normal frames
		surf.normalBasis = getBasisFromNormal( surf.normal );
		surf.normalInvBasis = inverse( surf.normalBasis );

		surf.clearcoatBasis = getBasisFromNormal( surf.clearcoatNormal );
		surf.clearcoatInvBasis = inverse( surf.clearcoatBasis );

		return HIT_SURFACE;

	}
`;var Dv=`

	struct Ray {

		vec3 origin;
		vec3 direction;

	};

	struct SurfaceHit {

		uvec4 faceIndices;
		vec3 barycoord;
		vec3 faceNormal;
		float side;
		float dist;

	};

	struct RenderState {

		bool firstRay;
		bool transmissiveRay;
		bool isShadowRay;
		float accumulatedRoughness;
		int transmissiveTraversals;
		int traversals;
		uint depth;
		vec3 throughputColor;
		Material fogMaterial;

	};

	RenderState initRenderState() {

		RenderState result;
		result.firstRay = true;
		result.transmissiveRay = true;
		result.isShadowRay = false;
		result.accumulatedRoughness = 0.0;
		result.transmissiveTraversals = 0;
		result.traversals = 0;
		result.throughputColor = vec3( 1.0 );
		result.depth = 0u;
		result.fogMaterial.fogVolume = false;
		return result;

	}

`;var Fv=`

	#define NO_HIT 0
	#define SURFACE_HIT 1
	#define LIGHT_HIT 2
	#define FOG_HIT 3

	// Passing the global variable 'lights' into this function caused shader program errors.
	// So global variables like 'lights' and 'bvh' were moved out of the function parameters.
	// For more information, refer to: https://github.com/gkjohnson/three-gpu-pathtracer/pull/457
	int traceScene(
		Ray ray, Material fogMaterial, inout SurfaceHit surfaceHit
	) {

		int result = NO_HIT;
		bool hit = bvhIntersectFirstHit( bvh, ray.origin, ray.direction, surfaceHit.faceIndices, surfaceHit.faceNormal, surfaceHit.barycoord, surfaceHit.side, surfaceHit.dist );

		#if FEATURE_FOG

		if ( fogMaterial.fogVolume ) {

			// offset the distance so we don't run into issues with particles on the same surface
			// as other objects
			float particleDist = intersectFogVolume( fogMaterial, rand( 1 ) );
			if ( particleDist + RAY_OFFSET < surfaceHit.dist ) {

				surfaceHit.side = 1.0;
				surfaceHit.faceNormal = normalize( - ray.direction );
				surfaceHit.dist = particleDist;
				return FOG_HIT;

			}

		}

		#endif

		if ( hit ) {

			result = SURFACE_HIT;

		}

		return result;

	}

`;var Ch=class extends li{onBeforeRender(){this.setDefine("FEATURE_DOF",this.physicalCamera.bokehSize===0?0:1),this.setDefine("FEATURE_BACKGROUND_MAP",this.backgroundMap?1:0),this.setDefine("FEATURE_FOG",this.materials.features.isUsed("FOG")?1:0)}constructor(t){super({transparent:!0,depthWrite:!1,defines:{FEATURE_MIS:1,FEATURE_RUSSIAN_ROULETTE:1,FEATURE_DOF:1,FEATURE_BACKGROUND_MAP:0,FEATURE_FOG:1,RANDOM_TYPE:2,CAMERA_TYPE:0,DEBUG_MODE:0,ATTR_NORMAL:0,ATTR_TANGENT:1,ATTR_UV:2,ATTR_COLOR:3,MATERIAL_PIXELS:Sh},uniforms:{resolution:{value:new q},opacity:{value:1},bounces:{value:10},transmissiveBounces:{value:10},filterGlossyFactor:{value:0},physicalCamera:{value:new ph},cameraWorldMatrix:{value:new gt},invProjectionMatrix:{value:new gt},bvh:{value:new th},attributesArray:{value:new _h},materialIndexAttribute:{value:new eo},materials:{value:new bh},textures:{value:new Da().texture},lights:{value:new xh},iesProfiles:{value:new Da(360,180,{type:Ge,wrapS:we,wrapT:we}).texture},environmentIntensity:{value:1},environmentRotation:{value:new gt},envMapInfo:{value:new gh},backgroundBlur:{value:0},backgroundMap:{value:null},backgroundAlpha:{value:1},backgroundIntensity:{value:1},backgroundRotation:{value:new gt},seed:{value:0},sobolTexture:{value:null},stratifiedTexture:{value:new wh},stratifiedOffsetTexture:{value:new Eh(64,1)}},vertexShader:`

				varying vec2 vUv;
				void main() {

					vec4 mvPosition = vec4( position, 1.0 );
					mvPosition = modelViewMatrix * mvPosition;
					gl_Position = projectionMatrix * mvPosition;

					vUv = uv;

				}

			`,fragmentShader:`
				#define RAY_OFFSET 1e-4
				#define INFINITY 1e20

				precision highp isampler2D;
				precision highp usampler2D;
				precision highp sampler2DArray;
				vec4 envMapTexelToLinear( vec4 a ) { return a; }
				#include <common>

				// bvh intersection
				${Hr.common_functions}
				${Hr.bvh_struct_definitions}
				${Hr.bvh_ray_functions}

				// uniform structs
				${lv}
				${hv}
				${uv}
				${fv}
				${dv}

				// random
				#if RANDOM_TYPE == 2 	// Stratified List

					${bv}

				#elif RANDOM_TYPE == 1 	// Sobol

					${Jp}
					${fh}
					${Kx}

					#define rand(v) sobol(v)
					#define rand2(v) sobol2(v)
					#define rand3(v) sobol3(v)
					#define rand4(v) sobol4(v)

				#else 					// PCG

				${Jp}

					// Using the sobol functions seems to break the the compiler on MacOS
					// - specifically the "sobolReverseBits" function.
					uint sobolPixelIndex = 0u;
					uint sobolPathIndex = 0u;
					uint sobolBounceIndex = 0u;

					#define rand(v) pcgRand()
					#define rand2(v) pcgRand2()
					#define rand3(v) pcgRand3()
					#define rand4(v) pcgRand4()

				#endif

				// common
				${yv}
				${xv}
				${Rh}
				${vv}
				${_v}

				// environment
				uniform EquirectHdrInfo envMapInfo;
				uniform mat4 environmentRotation;
				uniform float environmentIntensity;

				// lighting
				uniform sampler2DArray iesProfiles;
				uniform LightsInfo lights;

				// background
				uniform float backgroundBlur;
				uniform float backgroundAlpha;
				#if FEATURE_BACKGROUND_MAP

				uniform sampler2D backgroundMap;
				uniform mat4 backgroundRotation;
				uniform float backgroundIntensity;

				#endif

				// camera
				uniform mat4 cameraWorldMatrix;
				uniform mat4 invProjectionMatrix;
				#if FEATURE_DOF

				uniform PhysicalCamera physicalCamera;

				#endif

				// geometry
				uniform sampler2DArray attributesArray;
				uniform usampler2D materialIndexAttribute;
				uniform sampler2D materials;
				uniform sampler2DArray textures;
				uniform BVH bvh;

				// path tracer
				uniform int bounces;
				uniform int transmissiveBounces;
				uniform float filterGlossyFactor;
				uniform int seed;

				// image
				uniform vec2 resolution;
				uniform float opacity;

				varying vec2 vUv;

				// globals
				mat3 envRotation3x3;
				mat3 invEnvRotation3x3;
				float lightsDenom;

				// sampling
				${gv}
				${pv}
				${mv}

				${Ev}
				${Tv}
				${Av}
				${wv}
				${Mv}
				${Sv}

				float applyFilteredGlossy( float roughness, float accumulatedRoughness ) {

					return clamp(
						max(
							roughness,
							accumulatedRoughness * filterGlossyFactor * 5.0 ),
						0.0,
						1.0
					);

				}

				vec3 sampleBackground( vec3 direction, vec2 uv ) {

					vec3 sampleDir = sampleHemisphere( direction, uv ) * 0.5 * backgroundBlur;

					#if FEATURE_BACKGROUND_MAP

					sampleDir = normalize( mat3( backgroundRotation ) * direction + sampleDir );
					return backgroundIntensity * sampleEquirectColor( backgroundMap, sampleDir );

					#else

					sampleDir = normalize( envRotation3x3 * direction + sampleDir );
					return environmentIntensity * sampleEquirectColor( envMapInfo.map, sampleDir );

					#endif

				}

				${Dv}
				${Cv}
				${Fv}
				${Rv}
				${Iv}
				${Pv}

				void main() {

					// init
					rng_initialize( gl_FragCoord.xy, seed );
					sobolPixelIndex = ( uint( gl_FragCoord.x ) << 16 ) | uint( gl_FragCoord.y );
					sobolPathIndex = uint( seed );

					// get camera ray
					Ray ray = getCameraRay();

					// inverse environment rotation
					envRotation3x3 = mat3( environmentRotation );
					invEnvRotation3x3 = inverse( envRotation3x3 );
					lightsDenom =
						( environmentIntensity == 0.0 || envMapInfo.totalSum == 0.0 ) && lights.count != 0u ?
							float( lights.count ) :
							float( lights.count + 1u );

					// final color
					gl_FragColor = vec4( 0, 0, 0, 1 );

					// surface results
					SurfaceHit surfaceHit;
					ScatterRecord scatterRec;

					// path tracing state
					RenderState state = initRenderState();
					state.transmissiveTraversals = transmissiveBounces;
					#if FEATURE_FOG

					state.fogMaterial.fogVolume = bvhIntersectFogVolumeHit(
						ray.origin, - ray.direction,
						materialIndexAttribute, materials,
						state.fogMaterial
					);

					#endif

					for ( int i = 0; i < bounces; i ++ ) {

						sobolBounceIndex ++;

						state.depth ++;
						state.traversals = bounces - i;
						state.firstRay = i == 0 && state.transmissiveTraversals == transmissiveBounces;

						int hitType = traceScene( ray, state.fogMaterial, surfaceHit );

						// check if we intersect any lights and accumulate the light contribution
						// TODO: we can add support for light surface rendering in the else condition if we
						// add the ability to toggle visibility of the the light
						if ( ! state.firstRay && ! state.transmissiveRay ) {

							LightRecord lightRec;
							float lightDist = hitType == NO_HIT ? INFINITY : surfaceHit.dist;
							for ( uint i = 0u; i < lights.count; i ++ ) {

								if (
									intersectLightAtIndex( lights.tex, ray.origin, ray.direction, i, lightRec ) &&
									lightRec.dist < lightDist
								) {

									#if FEATURE_MIS

									// weight the contribution
									// NOTE: Only area lights are supported for forward sampling and can be hit
									float misWeight = misHeuristic( scatterRec.pdf, lightRec.pdf / lightsDenom );
									gl_FragColor.rgb += lightRec.emission * state.throughputColor * misWeight;

									#else

									gl_FragColor.rgb += lightRec.emission * state.throughputColor;

									#endif

								}

							}

						}

						if ( hitType == NO_HIT ) {

							if ( state.firstRay || state.transmissiveRay ) {

								gl_FragColor.rgb += sampleBackground( ray.direction, rand2( 2 ) ) * state.throughputColor;
								gl_FragColor.a = backgroundAlpha;

							} else {

								#if FEATURE_MIS

								// get the PDF of the hit envmap point
								vec3 envColor;
								float envPdf = sampleEquirect( envRotation3x3 * ray.direction, envColor );
								envPdf /= lightsDenom;

								// and weight the contribution
								float misWeight = misHeuristic( scatterRec.pdf, envPdf );
								gl_FragColor.rgb += environmentIntensity * envColor * state.throughputColor * misWeight;

								#else

								gl_FragColor.rgb +=
									environmentIntensity *
									sampleEquirectColor( envMapInfo.map, envRotation3x3 * ray.direction ) *
									state.throughputColor;

								#endif

							}
							break;

						}

						uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
						Material material = readMaterialInfo( materials, materialIndex );

						#if FEATURE_FOG

						if ( hitType == FOG_HIT ) {

							material = state.fogMaterial;
							state.accumulatedRoughness += 0.2;

						} else if ( material.fogVolume ) {

							state.fogMaterial = material;
							state.fogMaterial.fogVolume = surfaceHit.side == 1.0;

							ray.origin = stepRayOrigin( ray.origin, ray.direction, - surfaceHit.faceNormal, surfaceHit.dist );

							i -= sign( state.transmissiveTraversals );
							state.transmissiveTraversals -= sign( state.transmissiveTraversals );
							continue;

						}

						#endif

						// early out if this is a matte material
						if ( material.matte && state.firstRay ) {

							gl_FragColor = vec4( 0.0 );
							break;

						}

						// if we've determined that this is a shadow ray and we've hit an item with no shadow casting
						// then skip it
						if ( ! material.castShadow && state.isShadowRay ) {

							ray.origin = stepRayOrigin( ray.origin, ray.direction, - surfaceHit.faceNormal, surfaceHit.dist );
							continue;

						}

						SurfaceRecord surf;
						if (
							getSurfaceRecord(
								material, surfaceHit, attributesArray, state.accumulatedRoughness,
								surf
							) == SKIP_SURFACE
						) {

							// only allow a limited number of transparency discards otherwise we could
							// crash the context with too long a loop.
							i -= sign( state.transmissiveTraversals );
							state.transmissiveTraversals -= sign( state.transmissiveTraversals );

							ray.origin = stepRayOrigin( ray.origin, ray.direction, - surfaceHit.faceNormal, surfaceHit.dist );
							continue;

						}

						scatterRec = bsdfSample( - ray.direction, surf );
						state.isShadowRay = scatterRec.specularPdf < rand( 4 );

						bool isBelowSurface = ! surf.volumeParticle && dot( scatterRec.direction, surf.faceNormal ) < 0.0;
						vec3 hitPoint = stepRayOrigin( ray.origin, ray.direction, isBelowSurface ? - surf.faceNormal : surf.faceNormal, surfaceHit.dist );

						// next event estimation
						#if FEATURE_MIS

						gl_FragColor.rgb += directLightContribution( - ray.direction, surf, state, hitPoint );

						#endif

						// accumulate a roughness value to offset diffuse, specular, diffuse rays that have high contribution
						// to a single pixel resulting in fireflies
						// TODO: handle transmissive surfaces
						if ( ! surf.volumeParticle && ! isBelowSurface ) {

							// determine if this is a rough normal or not by checking how far off straight up it is
							vec3 halfVector = normalize( - ray.direction + scatterRec.direction );
							state.accumulatedRoughness += max(
								sin( acosApprox( dot( halfVector, surf.normal ) ) ),
								sin( acosApprox( dot( halfVector, surf.clearcoatNormal ) ) )
							);

							state.transmissiveRay = false;

						}

						// accumulate emissive color
						gl_FragColor.rgb += ( surf.emission * state.throughputColor );

						// skip the sample if our PDF or ray is impossible
						if ( scatterRec.pdf <= 0.0 || ! isDirectionValid( scatterRec.direction, surf.normal, surf.faceNormal ) ) {

							break;

						}

						// if we're bouncing around the inside a transmissive material then decrement
						// perform this separate from a bounce
						bool isTransmissiveRay = ! surf.volumeParticle && dot( scatterRec.direction, surf.faceNormal * surfaceHit.side ) < 0.0;
						if ( ( isTransmissiveRay || isBelowSurface ) && state.transmissiveTraversals > 0 ) {

							state.transmissiveTraversals --;
							i --;

						}

						//

						// handle throughput color transformation
						// attenuate the throughput color by the medium color
						if ( ! surf.frontFace ) {

							state.throughputColor *= transmissionAttenuation( surfaceHit.dist, surf.attenuationColor, surf.attenuationDistance );

						}

						#if FEATURE_RUSSIAN_ROULETTE

						// russian roulette path termination
						// https://www.arnoldrenderer.com/research/physically_based_shader_design_in_arnold.pdf
						uint minBounces = 3u;
						float depthProb = float( state.depth < minBounces );

						float rrProb = luminance( state.throughputColor * scatterRec.color / scatterRec.pdf );
						rrProb /= luminance( state.throughputColor );
						rrProb = sqrt( rrProb );
						rrProb = max( rrProb, depthProb );
						rrProb = min( rrProb, 1.0 );
						if ( rand( 8 ) > rrProb ) {

							break;

						}

						// perform sample clamping here to avoid bright pixels
						state.throughputColor *= min( 1.0 / rrProb, 20.0 );

						#endif

						// adjust the throughput and discard and exit if we find discard the sample if there are any NaNs
						state.throughputColor *= scatterRec.color / scatterRec.pdf;
						if ( any( isnan( state.throughputColor ) ) || any( isinf( state.throughputColor ) ) ) {

							break;

						}

						//

						// prepare for next ray
						ray.direction = scatterRec.direction;
						ray.origin = hitPoint;

					}

					gl_FragColor.a *= opacity;

					#if DEBUG_MODE == 1

					// output the number of rays checked in the path and number of
					// transmissive rays encountered.
					gl_FragColor.rgb = vec3(
						float( state.depth ),
						transmissiveBounces - state.transmissiveTraversals,
						0.0
					);
					gl_FragColor.a = 1.0;

					#endif

				}

			`}),this.setValues(t)}};function*jA(){let{_renderer:r,_fsQuad:t,_blendQuad:e,_primaryTarget:n,_blendTargets:i,_sobolTarget:s,_subframe:o,alpha:a,material:c}=this,l=new Kt,f=new Kt,h=e.material,[u,d]=i;for(;;){a?(h.opacity=this._opacityFactor/(this.samples+1),c.blending=ke,c.opacity=1):(c.opacity=this._opacityFactor/(this.samples+1),c.blending=Yn);let[g,x,p,m]=o,v=n.width,_=n.height;c.resolution.set(v*p,_*m),c.sobolTexture=s.texture,c.stratifiedTexture.init(20,c.bounces+c.transmissiveBounces+5),c.stratifiedTexture.next(),c.seed++;let y=this.tiles.x||1,b=this.tiles.y||1,T=y*b,w=Math.ceil(v*p),E=Math.ceil(_*m),M=Math.floor(g*v),S=Math.floor(x*_),I=Math.ceil(w/y),P=Math.ceil(E/b);for(let L=0;L<b;L++)for(let N=0;N<y;N++){let z=r.getRenderTarget(),V=r.autoClear,j=r.getScissorTest();r.getScissor(l),r.getViewport(f);let W=N,ct=L;if(!this.stableTiles){let _t=this._currentTile%(y*b);W=_t%y,ct=~~(_t/y),this._currentTile=_t+1}let pt=b-ct-1;n.scissor.set(M+W*I,S+pt*P,Math.min(I,w-W*I),Math.min(P,E-pt*P)),n.viewport.set(M,S,w,E),r.setRenderTarget(n),r.setScissorTest(!0),r.autoClear=!1,t.render(r),r.setViewport(f),r.setScissor(l),r.setScissorTest(j),r.setRenderTarget(z),r.autoClear=V,a&&(h.target1=u.texture,h.target2=n.texture,r.setRenderTarget(d),e.render(r),r.setRenderTarget(z)),this.samples+=1/T,N===y-1&&L===b-1&&(this.samples=Math.round(this.samples)),yield}[u,d]=[d,u]}}var Lv=new ft,La=class{get material(){return this._fsQuad.material}set material(t){this._fsQuad.material.removeEventListener("recompilation",this._compileFunction),t.addEventListener("recompilation",this._compileFunction),this._fsQuad.material=t}get target(){return this._alpha?this._blendTargets[1]:this._primaryTarget}set alpha(t){this._alpha!==t&&(t||(this._blendTargets[0].dispose(),this._blendTargets[1].dispose()),this._alpha=t,this.reset())}get alpha(){return this._alpha}get isCompiling(){return!!this._compilePromise}constructor(t){this.camera=null,this.tiles=new q(3,3),this.stableNoise=!1,this.stableTiles=!0,this.samples=0,this._subframe=new Kt(0,0,1,1),this._opacityFactor=1,this._renderer=t,this._alpha=!1,this._fsQuad=new Fn(new Ch),this._blendQuad=new Fn(new lh),this._task=null,this._currentTile=0,this._compilePromise=null,this._sobolTarget=new dh().generate(t),this._primaryTarget=new ze(1,1,{format:Gt,type:$t,magFilter:Vt,minFilter:Vt}),this._blendTargets=[new ze(1,1,{format:Gt,type:$t,magFilter:Vt,minFilter:Vt}),new ze(1,1,{format:Gt,type:$t,magFilter:Vt,minFilter:Vt})],this._compileFunction=()=>{let e=this.compileMaterial(this._fsQuad._mesh);e.then(()=>{this._compilePromise===e&&(this._compilePromise=null)}),this._compilePromise=e},this.material.addEventListener("recompilation",this._compileFunction)}compileMaterial(){return this._renderer.compileAsync(this._fsQuad._mesh)}setCamera(t){let{material:e}=this;e.cameraWorldMatrix.copy(t.matrixWorld),e.invProjectionMatrix.copy(t.projectionMatrixInverse),e.physicalCamera.updateFrom(t);let n=0;t.projectionMatrix.elements[15]>0&&(n=1),t.isEquirectCamera&&(n=2),e.setDefine("CAMERA_TYPE",n),this.camera=t}setSize(t,e){t=Math.ceil(t),e=Math.ceil(e),!(this._primaryTarget.width===t&&this._primaryTarget.height===e)&&(this._primaryTarget.setSize(t,e),this._blendTargets[0].setSize(t,e),this._blendTargets[1].setSize(t,e),this.reset())}getSize(t){t.x=this._primaryTarget.width,t.y=this._primaryTarget.height}dispose(){this._primaryTarget.dispose(),this._blendTargets[0].dispose(),this._blendTargets[1].dispose(),this._sobolTarget.dispose(),this._fsQuad.dispose(),this._blendQuad.dispose(),this._task=null}reset(){let{_renderer:t,_primaryTarget:e,_blendTargets:n}=this,i=t.getRenderTarget(),s=t.getClearAlpha();t.getClearColor(Lv),t.setRenderTarget(e),t.setClearColor(0,0),t.clearColor(),t.setRenderTarget(n[0]),t.setClearColor(0,0),t.clearColor(),t.setRenderTarget(n[1]),t.setClearColor(0,0),t.clearColor(),t.setClearColor(Lv,s),t.setRenderTarget(i),this.samples=0,this._task=null,this.material.stratifiedTexture.stableNoise=this.stableNoise,this.stableNoise&&(this.material.seed=0,this.material.stratifiedTexture.reset())}update(){this.material.onBeforeRender(),!this.isCompiling&&(this._task||(this._task=jA.call(this)),this._task.next())}};var Yr=new q,Nv=new q,Ih=new aa,Ph=new ft,Dh=class extends oe{constructor(t=512,e=512){super(new Float32Array(t*e*4),t,e,Gt,$t,Mi,Ke,we,re,re),this.generationCallback=null}update(){this.dispose(),this.needsUpdate=!0;let{data:t,width:e,height:n}=this.image;for(let i=0;i<e;i++)for(let s=0;s<n;s++){Nv.set(e,n),Yr.set(i/e,s/n),Yr.x-=.5,Yr.y=1-Yr.y,Ih.theta=Yr.x*2*Math.PI,Ih.phi=Yr.y*Math.PI,Ih.radius=1,this.generationCallback(Ih,Yr,Nv,Ph);let a=4*(s*e+i);t[a+0]=Ph.r,t[a+1]=Ph.g,t[a+2]=Ph.b,t[a+3]=1}}copy(t){return super.copy(t),this.generationCallback=t.generationCallback,this}};var Uv=new R,Na=class extends Dh{constructor(t=512){super(t,t),this.topColor=new ft().set(16777215),this.bottomColor=new ft().set(0),this.exponent=2,this.generationCallback=(e,n,i,s)=>{Uv.setFromSpherical(e);let o=Uv.y*.5+.5;s.lerpColors(this.bottomColor,this.topColor,o**this.exponent)}}copy(t){return super.copy(t),this.topColor.copy(t.topColor),this.bottomColor.copy(t.bottomColor),this}};var Fh=class extends Ue{get map(){return this.uniforms.map.value}set map(t){this.uniforms.map.value=t}get opacity(){return this.uniforms.opacity.value}set opacity(t){this.uniforms&&(this.uniforms.opacity.value=t)}constructor(t){super({uniforms:{map:{value:null},opacity:{value:1}},vertexShader:`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,fragmentShader:`
				uniform sampler2D map;
				uniform float opacity;
				varying vec2 vUv;

				vec4 clampedTexelFatch( sampler2D map, ivec2 px, int lod ) {

					vec4 res = texelFetch( map, ivec2( px.x, px.y ), 0 );

					#if defined( TONE_MAPPING )

					res.xyz = toneMapping( res.xyz );

					#endif

			  		return linearToOutputTexel( res );

				}

				void main() {

					vec2 size = vec2( textureSize( map, 0 ) );
					vec2 pxUv = vUv * size;
					vec2 pxCurr = floor( pxUv );
					vec2 pxFrac = fract( pxUv ) - 0.5;
					vec2 pxOffset;
					pxOffset.x = pxFrac.x > 0.0 ? 1.0 : - 1.0;
					pxOffset.y = pxFrac.y > 0.0 ? 1.0 : - 1.0;

					vec2 pxNext = clamp( pxOffset + pxCurr, vec2( 0.0 ), size - 1.0 );
					vec2 alpha = abs( pxFrac );

					vec4 p1 = mix(
						clampedTexelFatch( map, ivec2( pxCurr.x, pxCurr.y ), 0 ),
						clampedTexelFatch( map, ivec2( pxNext.x, pxCurr.y ), 0 ),
						alpha.x
					);

					vec4 p2 = mix(
						clampedTexelFatch( map, ivec2( pxCurr.x, pxNext.y ), 0 ),
						clampedTexelFatch( map, ivec2( pxNext.x, pxNext.y ), 0 ),
						alpha.x
					);

					gl_FragColor = mix( p1, p2, alpha.y );
					gl_FragColor.a *= opacity;
					#include <premultiplied_alpha_fragment>

				}
			`}),this.setValues(t)}};var Kp=class extends Ue{constructor(){super({uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`
				#define ENVMAP_TYPE_CUBE_UV

				uniform samplerCube envMap;
				uniform float flipEnvMap;
				varying vec2 vUv;

				#include <common>
				#include <cube_uv_reflection_fragment>

				${Rh}

				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					rayDirection.x *= flipEnvMap;
					gl_FragColor = textureCube( envMap, rayDirection );

				}`}),this.depthWrite=!1,this.depthTest=!1}},Ua=class{constructor(t){this._renderer=t,this._quad=new Fn(new Kp)}generate(t,e=null,n=null){if(!t.isCubeTexture)throw new Error("CubeToEquirectMaterial: Source can only be cube textures.");let i=t.images[0],s=this._renderer,o=this._quad;e===null&&(e=4*i.height),n===null&&(n=2*i.height);let a=new ze(e,n,{type:$t,colorSpace:i.colorSpace}),c=i.height,l=Math.log2(c)-2,f=1/c,h=1/(3*Math.max(Math.pow(2,l),112));o.material.defines.CUBEUV_MAX_MIP=`${l}.0`,o.material.defines.CUBEUV_TEXEL_WIDTH=h,o.material.defines.CUBEUV_TEXEL_HEIGHT=f,o.material.uniforms.envMap.value=t,o.material.uniforms.flipEnvMap.value=t.isRenderTargetTexture?1:-1,o.material.needsUpdate=!0;let u=s.getRenderTarget(),d=s.autoClear;s.autoClear=!0,s.setRenderTarget(a),o.render(s),s.setRenderTarget(u),s.autoClear=d;let g=new Uint16Array(e*n*4),x=new Float32Array(e*n*4);s.readRenderTargetPixels(a,0,0,e,n,x),a.dispose();for(let m=0,v=x.length;m<v;m++)g[m]=fn.toHalfFloat(x[m]);let p=new oe(g,e,n,Gt,Ge);return p.minFilter=zd,p.magFilter=re,p.wrapS=Ke,p.wrapT=Ke,p.mapping=Mi,p.needsUpdate=!0,p}dispose(){this._quad.dispose()}};function t1(r){return r.extensions.get("EXT_float_blend")}var oo=new q,Qp=class{get multipleImportanceSampling(){return!!this._pathTracer.material.defines.FEATURE_MIS}set multipleImportanceSampling(t){this._pathTracer.material.setDefine("FEATURE_MIS",t?1:0)}get transmissiveBounces(){return this._pathTracer.material.transmissiveBounces}set transmissiveBounces(t){this._pathTracer.material.transmissiveBounces=t}get bounces(){return this._pathTracer.material.bounces}set bounces(t){this._pathTracer.material.bounces=t}get filterGlossyFactor(){return this._pathTracer.material.filterGlossyFactor}set filterGlossyFactor(t){this._pathTracer.material.filterGlossyFactor=t}get samples(){return this._pathTracer.samples}get target(){return this._pathTracer.target}get tiles(){return this._pathTracer.tiles}get stableNoise(){return this._pathTracer.stableNoise}set stableNoise(t){this._pathTracer.stableNoise=t}get isCompiling(){return!!this._pathTracer.isCompiling}constructor(t){this._renderer=t,this._generator=new ch,this._pathTracer=new La(t),this._queueReset=!1,this._clock=new Ls,this._compilePromise=null,this._lowResPathTracer=new La(t),this._lowResPathTracer.tiles.set(1,1),this._quad=new Fn(new Fh({map:null,transparent:!0,blending:ke,premultipliedAlpha:t.getContextAttributes().premultipliedAlpha})),this._materials=null,this._previousEnvironment=null,this._previousBackground=null,this._internalBackground=null,this.renderDelay=100,this.minSamples=5,this.fadeDuration=500,this.enablePathTracing=!0,this.pausePathTracing=!1,this.dynamicLowRes=!1,this.lowResScale=.25,this.renderScale=1,this.synchronizeRenderSize=!0,this.rasterizeScene=!0,this.renderToCanvas=!0,this.textureSize=new q(1024,1024),this.rasterizeSceneCallback=(e,n)=>{this._renderer.render(e,n)},this.renderToCanvasCallback=(e,n,i)=>{let s=n.autoClear;n.autoClear=!1,i.render(n),n.autoClear=s},this.setScene(new ws,new Re)}setBVHWorker(t){this._generator.setBVHWorker(t)}setScene(t,e,n={}){t.updateMatrixWorld(!0),e.updateMatrixWorld();let i=this._generator;if(i.setObjects(t),this._buildAsync)return i.generateAsync(n.onProgress).then(s=>this._updateFromResults(t,e,s));{let s=i.generate();return this._updateFromResults(t,e,s)}}setSceneAsync(...t){this._buildAsync=!0;let e=this.setScene(...t);return this._buildAsync=!1,e}setCamera(t){this.camera=t,this.updateCamera()}updateCamera(){let t=this.camera;t.updateMatrixWorld(),this._pathTracer.setCamera(t),this._lowResPathTracer.setCamera(t),this.reset()}updateMaterials(){let t=this._pathTracer.material,e=this._renderer,n=this._materials,i=this.textureSize,s=iv(n);t.textures.setTextures(e,s,i.x,i.y),t.materials.updateFrom(n,s),this.reset()}updateLights(){let t=this.scene,e=this._renderer,n=this._pathTracer.material,i=rv(t),s=nv(i);n.lights.updateFrom(i,s),n.iesProfiles.setTextures(e,s),this.reset()}updateEnvironment(){let t=this.scene,e=this._pathTracer.material;if(this._internalBackground&&(this._internalBackground.dispose(),this._internalBackground=null),e.backgroundBlur=t.backgroundBlurriness,e.backgroundIntensity=t.backgroundIntensity??1,e.backgroundRotation.makeRotationFromEuler(t.backgroundRotation).invert(),t.background===null)e.backgroundMap=null,e.backgroundAlpha=0;else if(t.background.isColor){this._colorBackground=this._colorBackground||new Na(16);let n=this._colorBackground;n.topColor.equals(t.background)||(n.topColor.set(t.background),n.bottomColor.set(t.background),n.update()),e.backgroundMap=n,e.backgroundAlpha=1}else if(t.background.isCubeTexture){if(t.background!==this._previousBackground){let n=new Ua(this._renderer).generate(t.background);this._internalBackground=n,e.backgroundMap=n,e.backgroundAlpha=1}}else e.backgroundMap=t.background,e.backgroundAlpha=1;if(e.environmentIntensity=t.environment!==null?t.environmentIntensity??1:0,e.environmentRotation.makeRotationFromEuler(t.environmentRotation).invert(),this._previousEnvironment!==t.environment&&t.environment!==null)if(t.environment.isCubeTexture){let n=new Ua(this._renderer).generate(t.environment);e.envMapInfo.updateFrom(n)}else e.envMapInfo.updateFrom(t.environment);this._previousEnvironment=t.environment,this._previousBackground=t.background,this.reset()}_updateFromResults(t,e,n){let{materials:i,geometry:s,bvh:o,bvhChanged:a,needsMaterialIndexUpdate:c}=n;this._materials=i;let f=this._pathTracer.material;return a&&(f.bvh.updateFrom(o),f.attributesArray.updateFrom(s.attributes.normal,s.attributes.tangent,s.attributes.uv,s.attributes.color)),c&&f.materialIndexAttribute.updateFrom(s.attributes.materialIndex),this._previousScene=t,this.scene=t,this.camera=e,this.updateCamera(),this.updateMaterials(),this.updateEnvironment(),this.updateLights(),n}renderSample(){let t=this._lowResPathTracer,e=this._pathTracer,n=this._renderer,i=this._clock,s=this._quad;this._updateScale(),this._queueReset&&(e.reset(),t.reset(),this._queueReset=!1,s.material.opacity=0,i.start());let o=i.getDelta()*1e3,a=i.getElapsedTime()*1e3;if(!this.pausePathTracing&&this.enablePathTracing&&this.renderDelay<=a&&!this.isCompiling&&e.update(),e.alpha=e.material.backgroundAlpha!==1||!t1(n),t.alpha=e.alpha,this.renderToCanvas){let c=this._renderer,l=this.minSamples;if(a>=this.renderDelay&&this.samples>=this.minSamples&&(this.fadeDuration!==0?s.material.opacity=Math.min(s.material.opacity+o/this.fadeDuration,1):s.material.opacity=1),!this.enablePathTracing||this.samples<l||s.material.opacity<1){if(this.dynamicLowRes&&!this.isCompiling){t.samples<1&&(t.material=e.material,t.update());let f=s.material.opacity;s.material.opacity=1-s.material.opacity,s.material.map=t.target.texture,s.render(c),s.material.opacity=f}(!this.dynamicLowRes&&this.rasterizeScene||this.dynamicLowRes&&this.isCompiling)&&this.rasterizeSceneCallback(this.scene,this.camera)}this.enablePathTracing&&s.material.opacity>0&&(s.material.opacity<1&&(s.material.blending=this.dynamicLowRes?la:Yn),s.material.map=e.target.texture,this.renderToCanvasCallback(e.target,c,s),s.material.blending=ke)}}reset(){this._queueReset=!0,this._pathTracer.samples=0}dispose(){this._quad.dispose(),this._quad.material.dispose(),this._pathTracer.dispose()}_updateScale(){if(this.synchronizeRenderSize){this._renderer.getDrawingBufferSize(oo);let t=Math.floor(this.renderScale*oo.x),e=Math.floor(this.renderScale*oo.y);if(this._pathTracer.getSize(oo),oo.x!==t||oo.y!==e){let n=this.lowResScale;this._pathTracer.setSize(t,e),this._lowResPathTracer.setSize(Math.floor(t*n),Math.floor(e*n))}}}};var jp=class extends Ds{constructor(...t){super(...t),this.iesMap=null,this.radius=0}copy(t,e){return super.copy(t,e),this.iesMap=t.iesMap,this.radius=t.radius,this}};var tm=class extends Fs{constructor(...t){super(...t),this.isCircular=!1}copy(t,e){return super.copy(t,e),this.isCircular=t.isCircular,this}};var em=class extends li{constructor(t){super({blending:ke,transparent:!1,depthWrite:!1,depthTest:!1,defines:{USE_SLIDER:0},uniforms:{sigma:{value:5},threshold:{value:.03},kSigma:{value:1},map:{value:null},opacity:{value:1}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,fragmentShader:`

				//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				//  Copyright (c) 2018-2019 Michele Morrone
				//  All rights reserved.
				//
				//  https://michelemorrone.eu - https://BrutPitt.com
				//
				//  me@michelemorrone.eu - brutpitt@gmail.com
				//  twitter: @BrutPitt - github: BrutPitt
				//
				//  https://github.com/BrutPitt/glslSmartDeNoise/
				//
				//  This software is distributed under the terms of the BSD 2-Clause license
				//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

				uniform sampler2D map;

				uniform float sigma;
				uniform float threshold;
				uniform float kSigma;
				uniform float opacity;

				varying vec2 vUv;

				#define INV_SQRT_OF_2PI 0.39894228040143267793994605993439
				#define INV_PI 0.31830988618379067153776752674503

				// Parameters:
				//	 sampler2D tex	 - sampler image / texture
				//	 vec2 uv		   - actual fragment coord
				//	 float sigma  >  0 - sigma Standard Deviation
				//	 float kSigma >= 0 - sigma coefficient
				//		 kSigma * sigma  -->  radius of the circular kernel
				//	 float threshold   - edge sharpening threshold
				vec4 smartDeNoise( sampler2D tex, vec2 uv, float sigma, float kSigma, float threshold ) {

					float radius = round( kSigma * sigma );
					float radQ = radius * radius;

					float invSigmaQx2 = 0.5 / ( sigma * sigma );
					float invSigmaQx2PI = INV_PI * invSigmaQx2;

					float invThresholdSqx2 = 0.5 / ( threshold * threshold );
					float invThresholdSqrt2PI = INV_SQRT_OF_2PI / threshold;

					vec4 centrPx = texture2D( tex, uv );
					centrPx.rgb *= centrPx.a;

					float zBuff = 0.0;
					vec4 aBuff = vec4( 0.0 );
					vec2 size = vec2( textureSize( tex, 0 ) );

					vec2 d;
					for ( d.x = - radius; d.x <= radius; d.x ++ ) {

						float pt = sqrt( radQ - d.x * d.x );

						for ( d.y = - pt; d.y <= pt; d.y ++ ) {

							float blurFactor = exp( - dot( d, d ) * invSigmaQx2 ) * invSigmaQx2PI;

							vec4 walkPx = texture2D( tex, uv + d / size );
							walkPx.rgb *= walkPx.a;

							vec4 dC = walkPx - centrPx;
							float deltaFactor = exp( - dot( dC.rgba, dC.rgba ) * invThresholdSqx2 ) * invThresholdSqrt2PI * blurFactor;

							zBuff += deltaFactor;
							aBuff += deltaFactor * walkPx;

						}

					}

					return aBuff / zBuff;

				}

				void main() {

					gl_FragColor = smartDeNoise( map, vec2( vUv.x, vUv.y ), sigma, kSigma, threshold );
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
					#include <premultiplied_alpha_fragment>

					gl_FragColor.a *= opacity;

				}

			`}),this.setValues(t)}};export{Vg as ACESFilmicToneMapping,Ni as AddEquation,Bg as AddOperation,Wd as AdditiveAnimationBlendMode,la as AdditiveBlending,Gg as AgXToneMapping,Hd as AlphaFormat,r0 as AlwaysCompare,kl as AlwaysDepth,Sf as AlwaysStencilFunc,Cl as AmbientLight,Ol as AnimationAction,Ir as AnimationClip,Gf as AnimationLoader,od as AnimationMixer,sd as AnimationObjectGroup,Vf as AnimationUtils,Qc as ArcCurve,Nl as ArrayCamera,Cd as ArrowHelper,bf as AttachedBindMode,Ul as Audio,id as AudioAnalyser,oa as AudioContext,ed as AudioListener,jf as AudioLoader,Id as AxesHelper,He as BackSide,Zg as BasicDepthPacking,$v as BasicShadowMap,Hc as BatchedMesh,Uo as Bone,yi as BooleanKeyframeTrack,xd as Box2,se as Box3,Ed as Box3Helper,Sr as BoxGeometry,Ad as BoxHelper,Ot as BufferAttribute,Ft as BufferGeometry,Ll as BufferGeometryLoader,Bs as ByteType,ni as Cache,Ms as Camera,wd as CameraHelper,Uf as CanvasTexture,$c as CapsuleGeometry,jc as CatmullRomCurve3,kg as CineonToneMapping,Zc as CircleGeometry,we as ClampToEdgeWrapping,Ls as Clock,ft as Color,na as ColorKeyframeTrack,ie as ColorManagement,Lf as CompressedArrayTexture,Nf as CompressedCubeTexture,Es as CompressedTexture,Wf as CompressedTextureLoader,Vo as ConeGeometry,Lg as ConstantAlphaFactor,Dg as ConstantColorFactor,Dd as Controls,Dc as CubeCamera,Si as CubeReflectionMapping,Vi as CubeRefractionMapping,Mr as CubeTexture,Xf as CubeTextureLoader,Ns as CubeUVReflectionMapping,Ho as CubicBezierCurve,tl as CubicBezierCurve3,Ml as CubicInterpolant,Ld as CullFaceBack,gg as CullFaceFront,Yv as CullFaceFrontBack,mg as CullFaceNone,Pn as Curve,il as CurvePath,vg as CustomBlending,Hg as CustomToneMapping,ko as CylinderGeometry,md as Cylindrical,bs as Data3DTexture,Ui as DataArrayTexture,oe as DataTexture,qf as DataTextureLoader,fn as DataUtils,a_ as DecrementStencilOp,l_ as DecrementWrapStencilOp,g0 as DefaultLoadingManager,em as DenoiseMaterial,xs as DepthFormat,zs as DepthStencilFormat,Oo as DepthTexture,Xg as DetachedBindMode,Rl as DirectionalLight,Td as DirectionalLightHelper,Tl as DiscreteInterpolant,Jc as DodecahedronGeometry,Sn as DoubleSide,Eg as DstAlphaFactor,Cg as DstColorFactor,T_ as DynamicCopyUsage,v_ as DynamicDrawUsage,b_ as DynamicReadUsage,Kc as EdgesGeometry,Rs as EllipseCurve,t0 as EqualCompare,Hl as EqualDepth,d_ as EqualStencilFunc,Mi as EquirectangularReflectionMapping,ha as EquirectangularRefractionMapping,In as Euler,On as EventDispatcher,zo as ExternalTexture,rl as ExtrudeGeometry,$n as FileLoader,Cf as Float16BufferAttribute,bt as Float32BufferAttribute,$t as FloatType,Nc as Fog,Lc as FogExp2,Ff as FramebufferTexture,yn as FrontSide,Oi as Frustum,Vc as FrustumArray,hd as GLBufferAttribute,A_ as GLSL1,qd as GLSL3,Na as GradientEquirectTexture,e0 as GreaterCompare,Wl as GreaterDepth,i0 as GreaterEqualCompare,Gl as GreaterEqualDepth,x_ as GreaterEqualStencilFunc,m_ as GreaterStencilFunc,Sd as GridHelper,Li as Group,Ge as HalfFloatType,Al as HemisphereLight,bd as HemisphereLightHelper,sl as IcosahedronGeometry,Qf as ImageBitmapLoader,Pr as ImageLoader,Pc as ImageUtils,o_ as IncrementStencilOp,c_ as IncrementWrapStencilOp,Bi as InstancedBufferAttribute,Fl as InstancedBufferGeometry,ud as InstancedInterleavedBuffer,kc as InstancedMesh,Ef as Int16BufferAttribute,Rf as Int32BufferAttribute,Tf as Int8BufferAttribute,Gi as IntType,As as InterleavedBuffer,Tr as InterleavedBufferAttribute,Ar as Interpolant,Eo as InterpolateDiscrete,Ic as InterpolateLinear,Ec as InterpolateSmooth,C_ as InterpolationSamplingMode,R_ as InterpolationSamplingType,u_ as InvertStencilOp,pr as KeepStencilOp,bn as KeyframeTrack,Bc as LOD,ol as LatheGeometry,Ss as Layers,jg as LessCompare,Vl as LessDepth,Xd as LessEqualCompare,_r as LessEqualDepth,p_ as LessEqualStencilFunc,f_ as LessStencilFunc,si as Light,Pl as LightProbe,ri as Line,dn as Line3,Qe as LineBasicMaterial,Go as LineCurve,el as LineCurve3,Sl as LineDashedMaterial,Xc as LineLoop,kn as LineSegments,re as LinearFilter,ea as LinearInterpolant,zd as LinearMipMapLinearFilter,Kv as LinearMipMapNearestFilter,ai as LinearMipmapLinearFilter,fa as LinearMipmapNearestFilter,yr as LinearSRGBColorSpace,Og as LinearToneMapping,Co as LinearTransfer,sn as Loader,sa as LoaderUtils,ia as LoadingManager,qg as LoopOnce,$g as LoopPingPong,Yg as LoopRepeat,Xv as MOUSE,Je as Material,Dl as MaterialLoader,q_ as MathUtils,gd as Matrix2,Xt as Matrix3,gt as Matrix4,Sg as MaxEquation,Me as Mesh,zn as MeshBasicMaterial,jo as MeshDepthMaterial,ta as MeshDistanceMaterial,yl as MeshLambertMaterial,bl as MeshMatcapMaterial,_l as MeshNormalMaterial,xl as MeshPhongMaterial,gl as MeshPhysicalMaterial,Qo as MeshStandardMaterial,vl as MeshToonMaterial,bg as MinEquation,Ao as MirroredRepeatWrapping,Ug as MixOperation,Bd as MultiplyBlending,ua as MultiplyOperation,Vt as NearestFilter,Jv as NearestMipMapLinearFilter,Zv as NearestMipMapNearestFilter,Us as NearestMipmapLinearFilter,Od as NearestMipmapNearestFilter,Wg as NeutralToneMapping,Qg as NeverCompare,zl as NeverDepth,h_ as NeverStencilFunc,ke as NoBlending,Ti as NoColorSpace,Zn as NoToneMapping,Mu as NormalAnimationBlendMode,Yn as NormalBlending,n0 as NotEqualCompare,Xl as NotEqualDepth,g_ as NotEqualStencilFunc,Er as NumberKeyframeTrack,ue as Object3D,Kf as ObjectLoader,Kg as ObjectSpaceNormalMap,Jo as OctahedronGeometry,Tg as OneFactor,Ng as OneMinusConstantAlphaFactor,Fg as OneMinusConstantColorFactor,Rg as OneMinusDstAlphaFactor,Ig as OneMinusDstColorFactor,Cc as OneMinusSrcAlphaFactor,Ag as OneMinusSrcColorFactor,ki as OrthographicCamera,Nd as PCFShadowMap,xg as PCFSoftShadowMap,Ru as PMREMGenerator,Cs as Path,Re as PerspectiveCamera,Pa as PhysicalCamera,jp as PhysicalSpotLight,_n as Plane,Ps as PlaneGeometry,Rd as PlaneHelper,El as PointLight,yd as PointLightHelper,qc as Points,Bo as PointsMaterial,Md as PolarGridHelper,zi as PolyhedronGeometry,nd as PositionalAudio,pe as PropertyBinding,Bl as PropertyMixer,Wo as QuadraticBezierCurve,Xo as QuadraticBezierCurve3,Ze as Quaternion,Rr as QuaternionKeyframeTrack,wl as QuaternionLinearInterpolant,bu as RED_GREEN_RGTC2_Format,_u as RED_RGTC1_Format,ca as REVISION,Jg as RGBADepthPacking,Gt as RGBAFormat,Xi as RGBAIntegerFormat,du as RGBA_ASTC_10x10_Format,uu as RGBA_ASTC_10x5_Format,hu as RGBA_ASTC_10x6_Format,fu as RGBA_ASTC_10x8_Format,pu as RGBA_ASTC_12x10_Format,mu as RGBA_ASTC_12x12_Format,nu as RGBA_ASTC_4x4_Format,iu as RGBA_ASTC_5x4_Format,ru as RGBA_ASTC_5x5_Format,su as RGBA_ASTC_6x5_Format,ou as RGBA_ASTC_6x6_Format,au as RGBA_ASTC_8x5_Format,cu as RGBA_ASTC_8x6_Format,lu as RGBA_ASTC_8x8_Format,gu as RGBA_BPTC_Format,eu as RGBA_ETC2_EAC_Format,Ql as RGBA_PVRTC_2BPPV1_Format,Kl as RGBA_PVRTC_4BPPV1_Format,ma as RGBA_S3TC_DXT1_Format,ga as RGBA_S3TC_DXT3_Format,xa as RGBA_S3TC_DXT5_Format,n_ as RGBDepthPacking,Gd as RGBFormat,Qv as RGBIntegerFormat,xu as RGB_BPTC_SIGNED_Format,vu as RGB_BPTC_UNSIGNED_Format,jl as RGB_ETC1_Format,tu as RGB_ETC2_Format,Jl as RGB_PVRTC_2BPPV1_Format,Zl as RGB_PVRTC_4BPPV1_Format,pa as RGB_S3TC_DXT1_Format,i_ as RGDepthPacking,Fr as RGFormat,Wi as RGIntegerFormat,ml as RawShaderMaterial,ii as Ray,fd as Raycaster,Fs as RectAreaLight,Jn as RedFormat,Dr as RedIntegerFormat,zg as ReinhardToneMapping,Po as RenderTarget,ad as RenderTarget3D,Ke as RepeatWrapping,s_ as ReplaceStencilOp,yg as ReverseSubtractEquation,al as RingGeometry,Su as SIGNED_RED_GREEN_RGTC2_Format,yu as SIGNED_RED_RGTC1_Format,vn as SRGBColorSpace,me as SRGBTransfer,ws as Scene,jt as ShaderChunk,ci as ShaderLib,Ue as ShaderMaterial,pl as ShadowMaterial,_i as Shape,cl as ShapeGeometry,Pd as ShapePath,qn as ShapeUtils,tm as ShapedAreaLight,da as ShortType,zc as Skeleton,_d as SkeletonHelper,Oc as SkinnedMesh,Bn as Source,Ve as Sphere,Ko as SphereGeometry,aa as Spherical,Il as SphericalHarmonics3,qo as SplineCurve,Ds as SpotLight,vd as SpotLightHelper,Uc as Sprite,No as SpriteMaterial,Rc as SrcAlphaFactor,Pg as SrcAlphaSaturateFactor,wg as SrcColorFactor,M_ as StaticCopyUsage,Io as StaticDrawUsage,y_ as StaticReadUsage,td as StereoCamera,w_ as StreamCopyUsage,__ as StreamDrawUsage,S_ as StreamReadUsage,bi as StringKeyframeTrack,_g as SubtractEquation,Ud as SubtractiveBlending,qv as TOUCH,qi as TangentSpaceNormalMap,ll as TetrahedronGeometry,Oe as Texture,Yf as TextureLoader,Fd as TextureUtils,pd as Timer,E_ as TimestampQuery,ul as TorusGeometry,hl as TorusKnotGeometry,$e as Triangle,e_ as TriangleFanDrawMode,t_ as TriangleStripDrawMode,jv as TrianglesDrawMode,fl as TubeGeometry,ql as UVMapping,Fo as Uint16BufferAttribute,Lo as Uint32BufferAttribute,wf as Uint8BufferAttribute,Af as Uint8ClampedBufferAttribute,cd as Uniform,ld as UniformsGroup,mt as UniformsLib,c0 as UniformsUtils,on as UnsignedByteType,Vd as UnsignedInt101111Type,Os as UnsignedInt248Type,kd as UnsignedInt5999Type,an as UnsignedIntType,Yl as UnsignedShort4444Type,$l as UnsignedShort5551Type,Hi as UnsignedShortType,oi as VSMShadowMap,q as Vector2,R as Vector3,Kt as Vector4,Cr as VectorKeyframeTrack,Df as VideoFrameTexture,Yc as VideoTexture,Mf as WebGL3DRenderTarget,Do as WebGLArrayRenderTarget,Rn as WebGLCoordinateSystem,Fc as WebGLCubeRenderTarget,Qp as WebGLPathTracer,ze as WebGLRenderTarget,V0 as WebGLRenderer,Xw as WebGLUtils,vs as WebGPUCoordinateSystem,Ts as WebXRController,dl as WireframeGeometry,Ro as WrapAroundEnding,mr as ZeroCurvatureEnding,Mg as ZeroFactor,gr as ZeroSlopeEnding,r_ as ZeroStencilOp,s0 as createCanvasElement};
/*! Bundled license information:

three/build/three.core.js:
three/build/three.module.js:
  (**
   * @license
   * Copyright 2010-2025 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)
*/
