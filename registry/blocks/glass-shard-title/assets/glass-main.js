(()=>{var $l=0,Ys=1,Ql=2,Js=1,eh=2,nr=3,yr=0,Rt=1,Wt=2,sr=0,Kr=1,Za=2,Ks=3,Zs=4,th=5,Or=100,rh=101,ih=102,ah=103,nh=104,sh=200,oh=201,lh=202,hh=203,$a=204,Qa=205,ch=206,uh=207,dh=208,ph=209,fh=210,mh=211,gh=212,_h=213,vh=214,en=0,tn=1,rn=2,Zr=3,an=4,nn=5,sn=6,on=7,$s=0,xh=1,Mh=2,Sr=0,yh=1,Sh=2,Th=3,Qs=4,Eh=5,bh=6,wh=7,eo=300,$r=301,Qr=302,ln=303,hn=304,oa=306,Ni=1e3,Xt=1001,cn=1002,Dt=1003,Ah=1004,la=1005,St=1006,un=1007,Tr=1008,$t=1009,to=1010,ro=1011,Ui=1012,dn=1013,Fr=1014,Vt=1015,Qt=1016,pn=1017,fn=1018,Di=1020,io=35902,ao=35899,no=1021,so=1022,qt=1023,Ii=1026,Oi=1027,oo=1028,mn=1029,gn=1030,_n=1031,vn=1033,ha=33776,ca=33777,ua=33778,da=33779,xn=35840,Mn=35841,yn=35842,Sn=35843,Tn=36196,En=37492,bn=37496,wn=37808,An=37809,Cn=37810,Rn=37811,Pn=37812,Ln=37813,Nn=37814,Un=37815,Dn=37816,In=37817,On=37818,Fn=37819,Bn=37820,zn=37821,Vn=36492,kn=36494,Gn=36495,Hn=36283,Wn=36284,Xn=36285,qn=36286,pa=2300,jn=2301,Yn=2302,lo=2400,ho=2401,co=2402,Ch=3200,Rh=3201,Jn=0,Ph=1,Er="",Pt="srgb",Br="srgb-linear",fa="linear",lt="srgb",ei=7680,uo=519,Lh=512,Nh=513,Uh=514,po=515,Dh=516,Ih=517,Oh=518,Fh=519,fo=35044,mo="300 es",er=2e3,ma=2001;function go(e){for(let t=e.length-1;t>=0;--t)if(e[t]>=65535)return!0;return!1}function Fi(e){return document.createElementNS("http://www.w3.org/1999/xhtml",e)}function Bh(){let e=Fi("canvas");return e.style.display="block",e}var _o={},ti=null;function vo(...e){let t="THREE."+e.shift();ti?ti("log",t,...e):console.log(t,...e)}function ke(...e){let t="THREE."+e.shift();ti?ti("warn",t,...e):console.warn(t,...e)}function $e(...e){let t="THREE."+e.shift();ti?ti("error",t,...e):console.error(t,...e)}function Bi(...e){let t=e.join(" ");t in _o||(_o[t]=!0,ke(...e))}function zh(e,t,r){return new Promise(function(i,a){function n(){switch(e.clientWaitSync(t,e.SYNC_FLUSH_COMMANDS_BIT,0)){case e.WAIT_FAILED:a();break;case e.TIMEOUT_EXPIRED:setTimeout(n,r);break;default:i()}}setTimeout(n,r)})}var ri=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let r=this._listeners;r[e]===void 0&&(r[e]=[]),r[e].indexOf(t)===-1&&r[e].push(t)}hasEventListener(e,t){let r=this._listeners;return r===void 0?!1:r[e]!==void 0&&r[e].indexOf(t)!==-1}removeEventListener(e,t){let r=this._listeners;if(r===void 0)return;let i=r[e];if(i!==void 0){let a=i.indexOf(t);a!==-1&&i.splice(a,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let r=t[e.type];if(r!==void 0){e.target=this;let i=r.slice(0);for(let a=0,n=i.length;a<n;a++)i[a].call(this,e);e.target=null}}},Tt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Kn=Math.PI/180,ga=180/Math.PI;function ii(){let e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,r=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(Tt[e&255]+Tt[e>>8&255]+Tt[e>>16&255]+Tt[e>>24&255]+"-"+Tt[t&255]+Tt[t>>8&255]+"-"+Tt[t>>16&15|64]+Tt[t>>24&255]+"-"+Tt[r&63|128]+Tt[r>>8&255]+"-"+Tt[r>>16&255]+Tt[r>>24&255]+Tt[i&255]+Tt[i>>8&255]+Tt[i>>16&255]+Tt[i>>24&255]).toLowerCase()}function Ke(e,t,r){return Math.max(t,Math.min(r,e))}function Vh(e,t){return(e%t+t)%t}function Zn(e,t,r){return(1-r)*e+r*t}function zi(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return e/4294967295;case Uint16Array:return e/65535;case Uint8Array:return e/255;case Int32Array:return Math.max(e/2147483647,-1);case Int16Array:return Math.max(e/32767,-1);case Int8Array:return Math.max(e/127,-1);default:throw new Error("Invalid component type.")}}function Lt(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return Math.round(e*4294967295);case Uint16Array:return Math.round(e*65535);case Uint8Array:return Math.round(e*255);case Int32Array:return Math.round(e*2147483647);case Int16Array:return Math.round(e*32767);case Int8Array:return Math.round(e*127);default:throw new Error("Invalid component type.")}}var ye=class Gl{constructor(t=0,r=0){Gl.prototype.isVector2=!0,this.x=t,this.y=r}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,r){return this.x=t,this.y=r,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,r){switch(t){case 0:this.x=r;break;case 1:this.y=r;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,r){return this.x=t.x+r.x,this.y=t.y+r.y,this}addScaledVector(t,r){return this.x+=t.x*r,this.y+=t.y*r,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,r){return this.x=t.x-r.x,this.y=t.y-r.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){let r=this.x,i=this.y,a=t.elements;return this.x=a[0]*r+a[3]*i+a[6],this.y=a[1]*r+a[4]*i+a[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,r){return this.x=Ke(this.x,t.x,r.x),this.y=Ke(this.y,t.y,r.y),this}clampScalar(t,r){return this.x=Ke(this.x,t,r),this.y=Ke(this.y,t,r),this}clampLength(t,r){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ke(i,t,r))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){let r=Math.sqrt(this.lengthSq()*t.lengthSq());if(r===0)return Math.PI/2;let i=this.dot(t)/r;return Math.acos(Ke(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let r=this.x-t.x,i=this.y-t.y;return r*r+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,r){return this.x+=(t.x-this.x)*r,this.y+=(t.y-this.y)*r,this}lerpVectors(t,r,i){return this.x=t.x+(r.x-t.x)*i,this.y=t.y+(r.y-t.y)*i,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,r=0){return this.x=t[r],this.y=t[r+1],this}toArray(t=[],r=0){return t[r]=this.x,t[r+1]=this.y,t}fromBufferAttribute(t,r){return this.x=t.getX(r),this.y=t.getY(r),this}rotateAround(t,r){let i=Math.cos(r),a=Math.sin(r),n=this.x-t.x,s=this.y-t.y;return this.x=n*i-s*a+t.x,this.y=n*a+s*i+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},ai=class{constructor(e=0,t=0,r=0,i=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=r,this._w=i}static slerpFlat(e,t,r,i,a,n,s){let o=r[i+0],l=r[i+1],h=r[i+2],c=r[i+3],u=a[n+0],d=a[n+1],m=a[n+2],x=a[n+3];if(s<=0){e[t+0]=o,e[t+1]=l,e[t+2]=h,e[t+3]=c;return}if(s>=1){e[t+0]=u,e[t+1]=d,e[t+2]=m,e[t+3]=x;return}if(c!==x||o!==u||l!==d||h!==m){let _=o*u+l*d+h*m+c*x;_<0&&(u=-u,d=-d,m=-m,x=-x,_=-_);let f=1-s;if(_<.9995){let p=Math.acos(_),A=Math.sin(p);f=Math.sin(f*p)/A,s=Math.sin(s*p)/A,o=o*f+u*s,l=l*f+d*s,h=h*f+m*s,c=c*f+x*s}else{o=o*f+u*s,l=l*f+d*s,h=h*f+m*s,c=c*f+x*s;let p=1/Math.sqrt(o*o+l*l+h*h+c*c);o*=p,l*=p,h*=p,c*=p}}e[t]=o,e[t+1]=l,e[t+2]=h,e[t+3]=c}static multiplyQuaternionsFlat(e,t,r,i,a,n){let s=r[i],o=r[i+1],l=r[i+2],h=r[i+3],c=a[n],u=a[n+1],d=a[n+2],m=a[n+3];return e[t]=s*m+h*c+o*d-l*u,e[t+1]=o*m+h*u+l*c-s*d,e[t+2]=l*m+h*d+s*u-o*c,e[t+3]=h*m-s*c-o*u-l*d,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,r,i){return this._x=e,this._y=t,this._z=r,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let r=e._x,i=e._y,a=e._z,n=e._order,s=Math.cos,o=Math.sin,l=s(r/2),h=s(i/2),c=s(a/2),u=o(r/2),d=o(i/2),m=o(a/2);switch(n){case"XYZ":this._x=u*h*c+l*d*m,this._y=l*d*c-u*h*m,this._z=l*h*m+u*d*c,this._w=l*h*c-u*d*m;break;case"YXZ":this._x=u*h*c+l*d*m,this._y=l*d*c-u*h*m,this._z=l*h*m-u*d*c,this._w=l*h*c+u*d*m;break;case"ZXY":this._x=u*h*c-l*d*m,this._y=l*d*c+u*h*m,this._z=l*h*m+u*d*c,this._w=l*h*c-u*d*m;break;case"ZYX":this._x=u*h*c-l*d*m,this._y=l*d*c+u*h*m,this._z=l*h*m-u*d*c,this._w=l*h*c+u*d*m;break;case"YZX":this._x=u*h*c+l*d*m,this._y=l*d*c+u*h*m,this._z=l*h*m-u*d*c,this._w=l*h*c-u*d*m;break;case"XZY":this._x=u*h*c-l*d*m,this._y=l*d*c-u*h*m,this._z=l*h*m+u*d*c,this._w=l*h*c+u*d*m;break;default:ke("Quaternion: .setFromEuler() encountered an unknown order: "+n)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let r=t/2,i=Math.sin(r);return this._x=e.x*i,this._y=e.y*i,this._z=e.z*i,this._w=Math.cos(r),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,r=t[0],i=t[4],a=t[8],n=t[1],s=t[5],o=t[9],l=t[2],h=t[6],c=t[10],u=r+s+c;if(u>0){let d=.5/Math.sqrt(u+1);this._w=.25/d,this._x=(h-o)*d,this._y=(a-l)*d,this._z=(n-i)*d}else if(r>s&&r>c){let d=2*Math.sqrt(1+r-s-c);this._w=(h-o)/d,this._x=.25*d,this._y=(i+n)/d,this._z=(a+l)/d}else if(s>c){let d=2*Math.sqrt(1+s-r-c);this._w=(a-l)/d,this._x=(i+n)/d,this._y=.25*d,this._z=(o+h)/d}else{let d=2*Math.sqrt(1+c-r-s);this._w=(n-i)/d,this._x=(a+l)/d,this._y=(o+h)/d,this._z=.25*d}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let r=e.dot(t)+1;return r<1e-8?(r=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=r):(this._x=0,this._y=-e.z,this._z=e.y,this._w=r)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=r),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ke(this.dot(e),-1,1)))}rotateTowards(e,t){let r=this.angleTo(e);if(r===0)return this;let i=Math.min(1,t/r);return this.slerp(e,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let r=e._x,i=e._y,a=e._z,n=e._w,s=t._x,o=t._y,l=t._z,h=t._w;return this._x=r*h+n*s+i*l-a*o,this._y=i*h+n*o+a*s-r*l,this._z=a*h+n*l+r*o-i*s,this._w=n*h-r*s-i*o-a*l,this._onChangeCallback(),this}slerp(e,t){if(t<=0)return this;if(t>=1)return this.copy(e);let r=e._x,i=e._y,a=e._z,n=e._w,s=this.dot(e);s<0&&(r=-r,i=-i,a=-a,n=-n,s=-s);let o=1-t;if(s<.9995){let l=Math.acos(s),h=Math.sin(l);o=Math.sin(o*l)/h,t=Math.sin(t*l)/h,this._x=this._x*o+r*t,this._y=this._y*o+i*t,this._z=this._z*o+a*t,this._w=this._w*o+n*t,this._onChangeCallback()}else this._x=this._x*o+r*t,this._y=this._y*o+i*t,this._z=this._z*o+a*t,this._w=this._w*o+n*t,this.normalize();return this}slerpQuaternions(e,t,r){return this.copy(e).slerp(t,r)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),r=Math.random(),i=Math.sqrt(1-r),a=Math.sqrt(r);return this.set(i*Math.sin(e),i*Math.cos(e),a*Math.sin(t),a*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},z=class Hl{constructor(t=0,r=0,i=0){Hl.prototype.isVector3=!0,this.x=t,this.y=r,this.z=i}set(t,r,i){return i===void 0&&(i=this.z),this.x=t,this.y=r,this.z=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,r){switch(t){case 0:this.x=r;break;case 1:this.y=r;break;case 2:this.z=r;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,r){return this.x=t.x+r.x,this.y=t.y+r.y,this.z=t.z+r.z,this}addScaledVector(t,r){return this.x+=t.x*r,this.y+=t.y*r,this.z+=t.z*r,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,r){return this.x=t.x-r.x,this.y=t.y-r.y,this.z=t.z-r.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,r){return this.x=t.x*r.x,this.y=t.y*r.y,this.z=t.z*r.z,this}applyEuler(t){return this.applyQuaternion(xo.setFromEuler(t))}applyAxisAngle(t,r){return this.applyQuaternion(xo.setFromAxisAngle(t,r))}applyMatrix3(t){let r=this.x,i=this.y,a=this.z,n=t.elements;return this.x=n[0]*r+n[3]*i+n[6]*a,this.y=n[1]*r+n[4]*i+n[7]*a,this.z=n[2]*r+n[5]*i+n[8]*a,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){let r=this.x,i=this.y,a=this.z,n=t.elements,s=1/(n[3]*r+n[7]*i+n[11]*a+n[15]);return this.x=(n[0]*r+n[4]*i+n[8]*a+n[12])*s,this.y=(n[1]*r+n[5]*i+n[9]*a+n[13])*s,this.z=(n[2]*r+n[6]*i+n[10]*a+n[14])*s,this}applyQuaternion(t){let r=this.x,i=this.y,a=this.z,n=t.x,s=t.y,o=t.z,l=t.w,h=2*(s*a-o*i),c=2*(o*r-n*a),u=2*(n*i-s*r);return this.x=r+l*h+s*u-o*c,this.y=i+l*c+o*h-n*u,this.z=a+l*u+n*c-s*h,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){let r=this.x,i=this.y,a=this.z,n=t.elements;return this.x=n[0]*r+n[4]*i+n[8]*a,this.y=n[1]*r+n[5]*i+n[9]*a,this.z=n[2]*r+n[6]*i+n[10]*a,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,r){return this.x=Ke(this.x,t.x,r.x),this.y=Ke(this.y,t.y,r.y),this.z=Ke(this.z,t.z,r.z),this}clampScalar(t,r){return this.x=Ke(this.x,t,r),this.y=Ke(this.y,t,r),this.z=Ke(this.z,t,r),this}clampLength(t,r){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ke(i,t,r))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,r){return this.x+=(t.x-this.x)*r,this.y+=(t.y-this.y)*r,this.z+=(t.z-this.z)*r,this}lerpVectors(t,r,i){return this.x=t.x+(r.x-t.x)*i,this.y=t.y+(r.y-t.y)*i,this.z=t.z+(r.z-t.z)*i,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,r){let i=t.x,a=t.y,n=t.z,s=r.x,o=r.y,l=r.z;return this.x=a*l-n*o,this.y=n*s-i*l,this.z=i*o-a*s,this}projectOnVector(t){let r=t.lengthSq();if(r===0)return this.set(0,0,0);let i=t.dot(this)/r;return this.copy(t).multiplyScalar(i)}projectOnPlane(t){return $n.copy(this).projectOnVector(t),this.sub($n)}reflect(t){return this.sub($n.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){let r=Math.sqrt(this.lengthSq()*t.lengthSq());if(r===0)return Math.PI/2;let i=this.dot(t)/r;return Math.acos(Ke(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let r=this.x-t.x,i=this.y-t.y,a=this.z-t.z;return r*r+i*i+a*a}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,r,i){let a=Math.sin(r)*t;return this.x=a*Math.sin(i),this.y=Math.cos(r)*t,this.z=a*Math.cos(i),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,r,i){return this.x=t*Math.sin(r),this.y=i,this.z=t*Math.cos(r),this}setFromMatrixPosition(t){let r=t.elements;return this.x=r[12],this.y=r[13],this.z=r[14],this}setFromMatrixScale(t){let r=this.setFromMatrixColumn(t,0).length(),i=this.setFromMatrixColumn(t,1).length(),a=this.setFromMatrixColumn(t,2).length();return this.x=r,this.y=i,this.z=a,this}setFromMatrixColumn(t,r){return this.fromArray(t.elements,r*4)}setFromMatrix3Column(t,r){return this.fromArray(t.elements,r*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,r=0){return this.x=t[r],this.y=t[r+1],this.z=t[r+2],this}toArray(t=[],r=0){return t[r]=this.x,t[r+1]=this.y,t[r+2]=this.z,t}fromBufferAttribute(t,r){return this.x=t.getX(r),this.y=t.getY(r),this.z=t.getZ(r),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let t=Math.random()*Math.PI*2,r=Math.random()*2-1,i=Math.sqrt(1-r*r);return this.x=i*Math.cos(t),this.y=r,this.z=i*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},$n=new z,xo=new ai,Ze=class Wl{constructor(t,r,i,a,n,s,o,l,h){Wl.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,r,i,a,n,s,o,l,h)}set(t,r,i,a,n,s,o,l,h){let c=this.elements;return c[0]=t,c[1]=a,c[2]=o,c[3]=r,c[4]=n,c[5]=l,c[6]=i,c[7]=s,c[8]=h,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){let r=this.elements,i=t.elements;return r[0]=i[0],r[1]=i[1],r[2]=i[2],r[3]=i[3],r[4]=i[4],r[5]=i[5],r[6]=i[6],r[7]=i[7],r[8]=i[8],this}extractBasis(t,r,i){return t.setFromMatrix3Column(this,0),r.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(t){let r=t.elements;return this.set(r[0],r[4],r[8],r[1],r[5],r[9],r[2],r[6],r[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,r){let i=t.elements,a=r.elements,n=this.elements,s=i[0],o=i[3],l=i[6],h=i[1],c=i[4],u=i[7],d=i[2],m=i[5],x=i[8],_=a[0],f=a[3],p=a[6],A=a[1],S=a[4],b=a[7],C=a[2],L=a[5],U=a[8];return n[0]=s*_+o*A+l*C,n[3]=s*f+o*S+l*L,n[6]=s*p+o*b+l*U,n[1]=h*_+c*A+u*C,n[4]=h*f+c*S+u*L,n[7]=h*p+c*b+u*U,n[2]=d*_+m*A+x*C,n[5]=d*f+m*S+x*L,n[8]=d*p+m*b+x*U,this}multiplyScalar(t){let r=this.elements;return r[0]*=t,r[3]*=t,r[6]*=t,r[1]*=t,r[4]*=t,r[7]*=t,r[2]*=t,r[5]*=t,r[8]*=t,this}determinant(){let t=this.elements,r=t[0],i=t[1],a=t[2],n=t[3],s=t[4],o=t[5],l=t[6],h=t[7],c=t[8];return r*s*c-r*o*h-i*n*c+i*o*l+a*n*h-a*s*l}invert(){let t=this.elements,r=t[0],i=t[1],a=t[2],n=t[3],s=t[4],o=t[5],l=t[6],h=t[7],c=t[8],u=c*s-o*h,d=o*l-c*n,m=h*n-s*l,x=r*u+i*d+a*m;if(x===0)return this.set(0,0,0,0,0,0,0,0,0);let _=1/x;return t[0]=u*_,t[1]=(a*h-c*i)*_,t[2]=(o*i-a*s)*_,t[3]=d*_,t[4]=(c*r-a*l)*_,t[5]=(a*n-o*r)*_,t[6]=m*_,t[7]=(i*l-h*r)*_,t[8]=(s*r-i*n)*_,this}transpose(){let t,r=this.elements;return t=r[1],r[1]=r[3],r[3]=t,t=r[2],r[2]=r[6],r[6]=t,t=r[5],r[5]=r[7],r[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){let r=this.elements;return t[0]=r[0],t[1]=r[3],t[2]=r[6],t[3]=r[1],t[4]=r[4],t[5]=r[7],t[6]=r[2],t[7]=r[5],t[8]=r[8],this}setUvTransform(t,r,i,a,n,s,o){let l=Math.cos(n),h=Math.sin(n);return this.set(i*l,i*h,-i*(l*s+h*o)+s+t,-a*h,a*l,-a*(-h*s+l*o)+o+r,0,0,1),this}scale(t,r){return this.premultiply(Qn.makeScale(t,r)),this}rotate(t){return this.premultiply(Qn.makeRotation(-t)),this}translate(t,r){return this.premultiply(Qn.makeTranslation(t,r)),this}makeTranslation(t,r){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,r,0,0,1),this}makeRotation(t){let r=Math.cos(t),i=Math.sin(t);return this.set(r,-i,0,i,r,0,0,0,1),this}makeScale(t,r){return this.set(t,0,0,0,r,0,0,0,1),this}equals(t){let r=this.elements,i=t.elements;for(let a=0;a<9;a++)if(r[a]!==i[a])return!1;return!0}fromArray(t,r=0){for(let i=0;i<9;i++)this.elements[i]=t[i+r];return this}toArray(t=[],r=0){let i=this.elements;return t[r]=i[0],t[r+1]=i[1],t[r+2]=i[2],t[r+3]=i[3],t[r+4]=i[4],t[r+5]=i[5],t[r+6]=i[6],t[r+7]=i[7],t[r+8]=i[8],t}clone(){return new this.constructor().fromArray(this.elements)}},Qn=new Ze,Mo=new Ze().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),yo=new Ze().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function kh(){let e={enabled:!0,workingColorSpace:Br,spaces:{},convert:function(a,n,s){return this.enabled===!1||n===s||!n||!s||(this.spaces[n].transfer===lt&&(a.r=or(a.r),a.g=or(a.g),a.b=or(a.b)),this.spaces[n].primaries!==this.spaces[s].primaries&&(a.applyMatrix3(this.spaces[n].toXYZ),a.applyMatrix3(this.spaces[s].fromXYZ)),this.spaces[s].transfer===lt&&(a.r=ni(a.r),a.g=ni(a.g),a.b=ni(a.b))),a},workingToColorSpace:function(a,n){return this.convert(a,this.workingColorSpace,n)},colorSpaceToWorking:function(a,n){return this.convert(a,n,this.workingColorSpace)},getPrimaries:function(a){return this.spaces[a].primaries},getTransfer:function(a){return a===Er?fa:this.spaces[a].transfer},getToneMappingMode:function(a){return this.spaces[a].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(a,n=this.workingColorSpace){return a.fromArray(this.spaces[n].luminanceCoefficients)},define:function(a){Object.assign(this.spaces,a)},_getMatrix:function(a,n,s){return a.copy(this.spaces[n].toXYZ).multiply(this.spaces[s].fromXYZ)},_getDrawingBufferColorSpace:function(a){return this.spaces[a].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(a=this.workingColorSpace){return this.spaces[a].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(a,n){return Bi("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),e.workingToColorSpace(a,n)},toWorkingColorSpace:function(a,n){return Bi("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),e.colorSpaceToWorking(a,n)}},t=[.64,.33,.3,.6,.15,.06],r=[.2126,.7152,.0722],i=[.3127,.329];return e.define({[Br]:{primaries:t,whitePoint:i,transfer:fa,toXYZ:Mo,fromXYZ:yo,luminanceCoefficients:r,workingColorSpaceConfig:{unpackColorSpace:Pt},outputColorSpaceConfig:{drawingBufferColorSpace:Pt}},[Pt]:{primaries:t,whitePoint:i,transfer:lt,toXYZ:Mo,fromXYZ:yo,luminanceCoefficients:r,outputColorSpaceConfig:{drawingBufferColorSpace:Pt}}}),e}var at=kh();function or(e){return e<.04045?e*.0773993808:Math.pow(e*.9478672986+.0521327014,2.4)}function ni(e){return e<.0031308?e*12.92:1.055*Math.pow(e,.41666)-.055}var si,Gh=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let r;if(e instanceof HTMLCanvasElement)r=e;else{si===void 0&&(si=Fi("canvas")),si.width=e.width,si.height=e.height;let i=si.getContext("2d");e instanceof ImageData?i.putImageData(e,0,0):i.drawImage(e,0,0,e.width,e.height),r=si}return r.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=Fi("canvas");t.width=e.width,t.height=e.height;let r=t.getContext("2d");r.drawImage(e,0,0,e.width,e.height);let i=r.getImageData(0,0,e.width,e.height),a=i.data;for(let n=0;n<a.length;n++)a[n]=or(a[n]/255)*255;return r.putImageData(i,0,0),t}else if(e.data){let t=e.data.slice(0);for(let r=0;r<t.length;r++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[r]=Math.floor(or(t[r]/255)*255):t[r]=or(t[r]);return{data:t,width:e.width,height:e.height}}else return ke("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},Hh=0,es=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Hh++}),this.uuid=ii(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):t instanceof VideoFrame?e.set(t.displayHeight,t.displayWidth,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let r={uuid:this.uuid,url:""},i=this.data;if(i!==null){let a;if(Array.isArray(i)){a=[];for(let n=0,s=i.length;n<s;n++)i[n].isDataTexture?a.push(ts(i[n].image)):a.push(ts(i[n]))}else a=ts(i);r.url=a}return t||(e.images[this.uuid]=r),r}};function ts(e){return typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap?Gh.getDataURL(e):e.data?{data:Array.from(e.data),width:e.width,height:e.height,type:e.data.constructor.name}:(ke("Texture: Unable to serialize Texture."),{})}var Wh=0,rs=new z,It=class Ja extends ri{constructor(t=Ja.DEFAULT_IMAGE,r=Ja.DEFAULT_MAPPING,i=Xt,a=Xt,n=St,s=Tr,o=qt,l=$t,h=Ja.DEFAULT_ANISOTROPY,c=Er){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Wh++}),this.uuid=ii(),this.name="",this.source=new es(t),this.mipmaps=[],this.mapping=r,this.channel=0,this.wrapS=i,this.wrapT=a,this.magFilter=n,this.minFilter=s,this.anisotropy=h,this.format=o,this.internalFormat=null,this.type=l,this.offset=new ye(0,0),this.repeat=new ye(1,1),this.center=new ye(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ze,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=c,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(rs).x}get height(){return this.source.getSize(rs).y}get depth(){return this.source.getSize(rs).z}get image(){return this.source.data}set image(t=null){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,r){this.updateRanges.push({start:t,count:r})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(let r in t){let i=t[r];if(i===void 0){ke(`Texture.setValues(): parameter '${r}' has value of undefined.`);continue}let a=this[r];if(a===void 0){ke(`Texture.setValues(): property '${r}' does not exist.`);continue}a&&i&&a.isVector2&&i.isVector2||a&&i&&a.isVector3&&i.isVector3||a&&i&&a.isMatrix3&&i.isMatrix3?a.copy(i):this[r]=i}}toJSON(t){let r=t===void 0||typeof t=="string";if(!r&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),r||(t.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==eo)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Ni:t.x=t.x-Math.floor(t.x);break;case Xt:t.x=t.x<0?0:1;break;case cn:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Ni:t.y=t.y-Math.floor(t.y);break;case Xt:t.y=t.y<0?0:1;break;case cn:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}};It.DEFAULT_IMAGE=null,It.DEFAULT_MAPPING=eo,It.DEFAULT_ANISOTROPY=1;var ct=class Xl{constructor(t=0,r=0,i=0,a=1){Xl.prototype.isVector4=!0,this.x=t,this.y=r,this.z=i,this.w=a}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,r,i,a){return this.x=t,this.y=r,this.z=i,this.w=a,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,r){switch(t){case 0:this.x=r;break;case 1:this.y=r;break;case 2:this.z=r;break;case 3:this.w=r;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,r){return this.x=t.x+r.x,this.y=t.y+r.y,this.z=t.z+r.z,this.w=t.w+r.w,this}addScaledVector(t,r){return this.x+=t.x*r,this.y+=t.y*r,this.z+=t.z*r,this.w+=t.w*r,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,r){return this.x=t.x-r.x,this.y=t.y-r.y,this.z=t.z-r.z,this.w=t.w-r.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){let r=this.x,i=this.y,a=this.z,n=this.w,s=t.elements;return this.x=s[0]*r+s[4]*i+s[8]*a+s[12]*n,this.y=s[1]*r+s[5]*i+s[9]*a+s[13]*n,this.z=s[2]*r+s[6]*i+s[10]*a+s[14]*n,this.w=s[3]*r+s[7]*i+s[11]*a+s[15]*n,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);let r=Math.sqrt(1-t.w*t.w);return r<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/r,this.y=t.y/r,this.z=t.z/r),this}setAxisAngleFromRotationMatrix(t){let r,i,a,n,s=t.elements,o=s[0],l=s[4],h=s[8],c=s[1],u=s[5],d=s[9],m=s[2],x=s[6],_=s[10];if(Math.abs(l-c)<.01&&Math.abs(h-m)<.01&&Math.abs(d-x)<.01){if(Math.abs(l+c)<.1&&Math.abs(h+m)<.1&&Math.abs(d+x)<.1&&Math.abs(o+u+_-3)<.1)return this.set(1,0,0,0),this;r=Math.PI;let p=(o+1)/2,A=(u+1)/2,S=(_+1)/2,b=(l+c)/4,C=(h+m)/4,L=(d+x)/4;return p>A&&p>S?p<.01?(i=0,a=.707106781,n=.707106781):(i=Math.sqrt(p),a=b/i,n=C/i):A>S?A<.01?(i=.707106781,a=0,n=.707106781):(a=Math.sqrt(A),i=b/a,n=L/a):S<.01?(i=.707106781,a=.707106781,n=0):(n=Math.sqrt(S),i=C/n,a=L/n),this.set(i,a,n,r),this}let f=Math.sqrt((x-d)*(x-d)+(h-m)*(h-m)+(c-l)*(c-l));return Math.abs(f)<.001&&(f=1),this.x=(x-d)/f,this.y=(h-m)/f,this.z=(c-l)/f,this.w=Math.acos((o+u+_-1)/2),this}setFromMatrixPosition(t){let r=t.elements;return this.x=r[12],this.y=r[13],this.z=r[14],this.w=r[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,r){return this.x=Ke(this.x,t.x,r.x),this.y=Ke(this.y,t.y,r.y),this.z=Ke(this.z,t.z,r.z),this.w=Ke(this.w,t.w,r.w),this}clampScalar(t,r){return this.x=Ke(this.x,t,r),this.y=Ke(this.y,t,r),this.z=Ke(this.z,t,r),this.w=Ke(this.w,t,r),this}clampLength(t,r){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ke(i,t,r))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,r){return this.x+=(t.x-this.x)*r,this.y+=(t.y-this.y)*r,this.z+=(t.z-this.z)*r,this.w+=(t.w-this.w)*r,this}lerpVectors(t,r,i){return this.x=t.x+(r.x-t.x)*i,this.y=t.y+(r.y-t.y)*i,this.z=t.z+(r.z-t.z)*i,this.w=t.w+(r.w-t.w)*i,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,r=0){return this.x=t[r],this.y=t[r+1],this.z=t[r+2],this.w=t[r+3],this}toArray(t=[],r=0){return t[r]=this.x,t[r+1]=this.y,t[r+2]=this.z,t[r+3]=this.w,t}fromBufferAttribute(t,r){return this.x=t.getX(r),this.y=t.getY(r),this.z=t.getZ(r),this.w=t.getW(r),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Xh=class extends ri{constructor(e=1,t=1,r={}){super(),r=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:St,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},r),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=r.depth,this.scissor=new ct(0,0,e,t),this.scissorTest=!1,this.viewport=new ct(0,0,e,t);let i={width:e,height:t,depth:r.depth},a=new It(i);this.textures=[];let n=r.count;for(let s=0;s<n;s++)this.textures[s]=a.clone(),this.textures[s].isRenderTargetTexture=!0,this.textures[s].renderTarget=this;this._setTextureOptions(r),this.depthBuffer=r.depthBuffer,this.stencilBuffer=r.stencilBuffer,this.resolveDepthBuffer=r.resolveDepthBuffer,this.resolveStencilBuffer=r.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=r.depthTexture,this.samples=r.samples,this.multiview=r.multiview}_setTextureOptions(e={}){let t={minFilter:St,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let r=0;r<this.textures.length;r++)this.textures[r].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,r=1){if(this.width!==e||this.height!==t||this.depth!==r){this.width=e,this.height=t,this.depth=r;for(let i=0,a=this.textures.length;i<a;i++)this.textures[i].image.width=e,this.textures[i].image.height=t,this.textures[i].image.depth=r,this.textures[i].isData3DTexture!==!0&&(this.textures[i].isArrayTexture=this.textures[i].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,r=e.textures.length;t<r;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let i=Object.assign({},e.textures[t].image);this.textures[t].source=new es(i)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}},zr=class extends Xh{constructor(e=1,t=1,r={}){super(e,t,r),this.isWebGLRenderTarget=!0}},So=class extends It{constructor(e=null,t=1,r=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:r,depth:i},this.magFilter=Dt,this.minFilter=Dt,this.wrapR=Xt,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}},qh=class extends It{constructor(e=null,t=1,r=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:r,depth:i},this.magFilter=Dt,this.minFilter=Dt,this.wrapR=Xt,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Vi=class{constructor(e=new z(1/0,1/0,1/0),t=new z(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,r=e.length;t<r;t+=3)this.expandByPoint(jt.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,r=e.count;t<r;t++)this.expandByPoint(jt.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,r=e.length;t<r;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let r=jt.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(r),this.max.copy(e).add(r),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let r=e.geometry;if(r!==void 0){let a=r.getAttribute("position");if(t===!0&&a!==void 0&&e.isInstancedMesh!==!0)for(let n=0,s=a.count;n<s;n++)e.isMesh===!0?e.getVertexPosition(n,jt):jt.fromBufferAttribute(a,n),jt.applyMatrix4(e.matrixWorld),this.expandByPoint(jt);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),_a.copy(e.boundingBox)):(r.boundingBox===null&&r.computeBoundingBox(),_a.copy(r.boundingBox)),_a.applyMatrix4(e.matrixWorld),this.union(_a)}let i=e.children;for(let a=0,n=i.length;a<n;a++)this.expandByObject(i[a],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,jt),jt.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,r;return e.normal.x>0?(t=e.normal.x*this.min.x,r=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,r=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,r+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,r+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,r+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,r+=e.normal.z*this.min.z),t<=-e.constant&&r>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(ki),va.subVectors(this.max,ki),oi.subVectors(e.a,ki),li.subVectors(e.b,ki),hi.subVectors(e.c,ki),br.subVectors(li,oi),wr.subVectors(hi,li),Vr.subVectors(oi,hi);let t=[0,-br.z,br.y,0,-wr.z,wr.y,0,-Vr.z,Vr.y,br.z,0,-br.x,wr.z,0,-wr.x,Vr.z,0,-Vr.x,-br.y,br.x,0,-wr.y,wr.x,0,-Vr.y,Vr.x,0];return!is(t,oi,li,hi,va)||(t=[1,0,0,0,1,0,0,0,1],!is(t,oi,li,hi,va))?!1:(xa.crossVectors(br,wr),t=[xa.x,xa.y,xa.z],is(t,oi,li,hi,va))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,jt).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(jt).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(lr[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),lr[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),lr[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),lr[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),lr[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),lr[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),lr[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),lr[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(lr),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},lr=[new z,new z,new z,new z,new z,new z,new z,new z],jt=new z,_a=new Vi,oi=new z,li=new z,hi=new z,br=new z,wr=new z,Vr=new z,ki=new z,va=new z,xa=new z,kr=new z;function is(e,t,r,i,a){for(let n=0,s=e.length-3;n<=s;n+=3){kr.fromArray(e,n);let o=a.x*Math.abs(kr.x)+a.y*Math.abs(kr.y)+a.z*Math.abs(kr.z),l=t.dot(kr),h=r.dot(kr),c=i.dot(kr);if(Math.max(-Math.max(l,h,c),Math.min(l,h,c))>o)return!1}return!0}var jh=new Vi,Gi=new z,as=new z,ns=class{constructor(e=new z,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let r=this.center;t!==void 0?r.copy(t):jh.setFromPoints(e).getCenter(r);let i=0;for(let a=0,n=e.length;a<n;a++)i=Math.max(i,r.distanceToSquared(e[a]));return this.radius=Math.sqrt(i),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let r=this.center.distanceToSquared(e);return t.copy(e),r>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Gi.subVectors(e,this.center);let t=Gi.lengthSq();if(t>this.radius*this.radius){let r=Math.sqrt(t),i=(r-this.radius)*.5;this.center.addScaledVector(Gi,i/r),this.radius+=i}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(as.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Gi.copy(e.center).add(as)),this.expandByPoint(Gi.copy(e.center).sub(as))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},hr=new z,ss=new z,Ma=new z,Ar=new z,os=new z,ya=new z,ls=new z,Yh=class{constructor(e=new z,t=new z(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,hr)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let r=t.dot(this.direction);return r<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,r)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=hr.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(hr.copy(this.origin).addScaledVector(this.direction,t),hr.distanceToSquared(e))}distanceSqToSegment(e,t,r,i){ss.copy(e).add(t).multiplyScalar(.5),Ma.copy(t).sub(e).normalize(),Ar.copy(this.origin).sub(ss);let a=e.distanceTo(t)*.5,n=-this.direction.dot(Ma),s=Ar.dot(this.direction),o=-Ar.dot(Ma),l=Ar.lengthSq(),h=Math.abs(1-n*n),c,u,d,m;if(h>0)if(c=n*o-s,u=n*s-o,m=a*h,c>=0)if(u>=-m)if(u<=m){let x=1/h;c*=x,u*=x,d=c*(c+n*u+2*s)+u*(n*c+u+2*o)+l}else u=a,c=Math.max(0,-(n*u+s)),d=-c*c+u*(u+2*o)+l;else u=-a,c=Math.max(0,-(n*u+s)),d=-c*c+u*(u+2*o)+l;else u<=-m?(c=Math.max(0,-(-n*a+s)),u=c>0?-a:Math.min(Math.max(-a,-o),a),d=-c*c+u*(u+2*o)+l):u<=m?(c=0,u=Math.min(Math.max(-a,-o),a),d=u*(u+2*o)+l):(c=Math.max(0,-(n*a+s)),u=c>0?a:Math.min(Math.max(-a,-o),a),d=-c*c+u*(u+2*o)+l);else u=n>0?-a:a,c=Math.max(0,-(n*u+s)),d=-c*c+u*(u+2*o)+l;return r&&r.copy(this.origin).addScaledVector(this.direction,c),i&&i.copy(ss).addScaledVector(Ma,u),d}intersectSphere(e,t){hr.subVectors(e.center,this.origin);let r=hr.dot(this.direction),i=hr.dot(hr)-r*r,a=e.radius*e.radius;if(i>a)return null;let n=Math.sqrt(a-i),s=r-n,o=r+n;return o<0?null:s<0?this.at(o,t):this.at(s,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let r=-(this.origin.dot(e.normal)+e.constant)/t;return r>=0?r:null}intersectPlane(e,t){let r=this.distanceToPlane(e);return r===null?null:this.at(r,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let r,i,a,n,s,o,l=1/this.direction.x,h=1/this.direction.y,c=1/this.direction.z,u=this.origin;return l>=0?(r=(e.min.x-u.x)*l,i=(e.max.x-u.x)*l):(r=(e.max.x-u.x)*l,i=(e.min.x-u.x)*l),h>=0?(a=(e.min.y-u.y)*h,n=(e.max.y-u.y)*h):(a=(e.max.y-u.y)*h,n=(e.min.y-u.y)*h),r>n||a>i||((a>r||isNaN(r))&&(r=a),(n<i||isNaN(i))&&(i=n),c>=0?(s=(e.min.z-u.z)*c,o=(e.max.z-u.z)*c):(s=(e.max.z-u.z)*c,o=(e.min.z-u.z)*c),r>o||s>i)||((s>r||r!==r)&&(r=s),(o<i||i!==i)&&(i=o),i<0)?null:this.at(r>=0?r:i,t)}intersectsBox(e){return this.intersectBox(e,hr)!==null}intersectTriangle(e,t,r,i,a){os.subVectors(t,e),ya.subVectors(r,e),ls.crossVectors(os,ya);let n=this.direction.dot(ls),s;if(n>0){if(i)return null;s=1}else if(n<0)s=-1,n=-n;else return null;Ar.subVectors(this.origin,e);let o=s*this.direction.dot(ya.crossVectors(Ar,ya));if(o<0)return null;let l=s*this.direction.dot(os.cross(Ar));if(l<0||o+l>n)return null;let h=-s*Ar.dot(ls);return h<0?null:this.at(h/n,a)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},ft=class js{constructor(t,r,i,a,n,s,o,l,h,c,u,d,m,x,_,f){js.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,r,i,a,n,s,o,l,h,c,u,d,m,x,_,f)}set(t,r,i,a,n,s,o,l,h,c,u,d,m,x,_,f){let p=this.elements;return p[0]=t,p[4]=r,p[8]=i,p[12]=a,p[1]=n,p[5]=s,p[9]=o,p[13]=l,p[2]=h,p[6]=c,p[10]=u,p[14]=d,p[3]=m,p[7]=x,p[11]=_,p[15]=f,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new js().fromArray(this.elements)}copy(t){let r=this.elements,i=t.elements;return r[0]=i[0],r[1]=i[1],r[2]=i[2],r[3]=i[3],r[4]=i[4],r[5]=i[5],r[6]=i[6],r[7]=i[7],r[8]=i[8],r[9]=i[9],r[10]=i[10],r[11]=i[11],r[12]=i[12],r[13]=i[13],r[14]=i[14],r[15]=i[15],this}copyPosition(t){let r=this.elements,i=t.elements;return r[12]=i[12],r[13]=i[13],r[14]=i[14],this}setFromMatrix3(t){let r=t.elements;return this.set(r[0],r[3],r[6],0,r[1],r[4],r[7],0,r[2],r[5],r[8],0,0,0,0,1),this}extractBasis(t,r,i){return t.setFromMatrixColumn(this,0),r.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this}makeBasis(t,r,i){return this.set(t.x,r.x,i.x,0,t.y,r.y,i.y,0,t.z,r.z,i.z,0,0,0,0,1),this}extractRotation(t){let r=this.elements,i=t.elements,a=1/ci.setFromMatrixColumn(t,0).length(),n=1/ci.setFromMatrixColumn(t,1).length(),s=1/ci.setFromMatrixColumn(t,2).length();return r[0]=i[0]*a,r[1]=i[1]*a,r[2]=i[2]*a,r[3]=0,r[4]=i[4]*n,r[5]=i[5]*n,r[6]=i[6]*n,r[7]=0,r[8]=i[8]*s,r[9]=i[9]*s,r[10]=i[10]*s,r[11]=0,r[12]=0,r[13]=0,r[14]=0,r[15]=1,this}makeRotationFromEuler(t){let r=this.elements,i=t.x,a=t.y,n=t.z,s=Math.cos(i),o=Math.sin(i),l=Math.cos(a),h=Math.sin(a),c=Math.cos(n),u=Math.sin(n);if(t.order==="XYZ"){let d=s*c,m=s*u,x=o*c,_=o*u;r[0]=l*c,r[4]=-l*u,r[8]=h,r[1]=m+x*h,r[5]=d-_*h,r[9]=-o*l,r[2]=_-d*h,r[6]=x+m*h,r[10]=s*l}else if(t.order==="YXZ"){let d=l*c,m=l*u,x=h*c,_=h*u;r[0]=d+_*o,r[4]=x*o-m,r[8]=s*h,r[1]=s*u,r[5]=s*c,r[9]=-o,r[2]=m*o-x,r[6]=_+d*o,r[10]=s*l}else if(t.order==="ZXY"){let d=l*c,m=l*u,x=h*c,_=h*u;r[0]=d-_*o,r[4]=-s*u,r[8]=x+m*o,r[1]=m+x*o,r[5]=s*c,r[9]=_-d*o,r[2]=-s*h,r[6]=o,r[10]=s*l}else if(t.order==="ZYX"){let d=s*c,m=s*u,x=o*c,_=o*u;r[0]=l*c,r[4]=x*h-m,r[8]=d*h+_,r[1]=l*u,r[5]=_*h+d,r[9]=m*h-x,r[2]=-h,r[6]=o*l,r[10]=s*l}else if(t.order==="YZX"){let d=s*l,m=s*h,x=o*l,_=o*h;r[0]=l*c,r[4]=_-d*u,r[8]=x*u+m,r[1]=u,r[5]=s*c,r[9]=-o*c,r[2]=-h*c,r[6]=m*u+x,r[10]=d-_*u}else if(t.order==="XZY"){let d=s*l,m=s*h,x=o*l,_=o*h;r[0]=l*c,r[4]=-u,r[8]=h*c,r[1]=d*u+_,r[5]=s*c,r[9]=m*u-x,r[2]=x*u-m,r[6]=o*c,r[10]=_*u+d}return r[3]=0,r[7]=0,r[11]=0,r[12]=0,r[13]=0,r[14]=0,r[15]=1,this}makeRotationFromQuaternion(t){return this.compose(Jh,t,Kh)}lookAt(t,r,i){let a=this.elements;return Ot.subVectors(t,r),Ot.lengthSq()===0&&(Ot.z=1),Ot.normalize(),Cr.crossVectors(i,Ot),Cr.lengthSq()===0&&(Math.abs(i.z)===1?Ot.x+=1e-4:Ot.z+=1e-4,Ot.normalize(),Cr.crossVectors(i,Ot)),Cr.normalize(),Sa.crossVectors(Ot,Cr),a[0]=Cr.x,a[4]=Sa.x,a[8]=Ot.x,a[1]=Cr.y,a[5]=Sa.y,a[9]=Ot.y,a[2]=Cr.z,a[6]=Sa.z,a[10]=Ot.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,r){let i=t.elements,a=r.elements,n=this.elements,s=i[0],o=i[4],l=i[8],h=i[12],c=i[1],u=i[5],d=i[9],m=i[13],x=i[2],_=i[6],f=i[10],p=i[14],A=i[3],S=i[7],b=i[11],C=i[15],L=a[0],U=a[4],B=a[8],M=a[12],y=a[1],R=a[5],q=a[9],W=a[13],k=a[2],ee=a[6],j=a[10],le=a[14],X=a[3],ie=a[7],Se=a[11],Ge=a[15];return n[0]=s*L+o*y+l*k+h*X,n[4]=s*U+o*R+l*ee+h*ie,n[8]=s*B+o*q+l*j+h*Se,n[12]=s*M+o*W+l*le+h*Ge,n[1]=c*L+u*y+d*k+m*X,n[5]=c*U+u*R+d*ee+m*ie,n[9]=c*B+u*q+d*j+m*Se,n[13]=c*M+u*W+d*le+m*Ge,n[2]=x*L+_*y+f*k+p*X,n[6]=x*U+_*R+f*ee+p*ie,n[10]=x*B+_*q+f*j+p*Se,n[14]=x*M+_*W+f*le+p*Ge,n[3]=A*L+S*y+b*k+C*X,n[7]=A*U+S*R+b*ee+C*ie,n[11]=A*B+S*q+b*j+C*Se,n[15]=A*M+S*W+b*le+C*Ge,this}multiplyScalar(t){let r=this.elements;return r[0]*=t,r[4]*=t,r[8]*=t,r[12]*=t,r[1]*=t,r[5]*=t,r[9]*=t,r[13]*=t,r[2]*=t,r[6]*=t,r[10]*=t,r[14]*=t,r[3]*=t,r[7]*=t,r[11]*=t,r[15]*=t,this}determinant(){let t=this.elements,r=t[0],i=t[4],a=t[8],n=t[12],s=t[1],o=t[5],l=t[9],h=t[13],c=t[2],u=t[6],d=t[10],m=t[14],x=t[3],_=t[7],f=t[11],p=t[15];return x*(+n*l*u-a*h*u-n*o*d+i*h*d+a*o*m-i*l*m)+_*(+r*l*m-r*h*d+n*s*d-a*s*m+a*h*c-n*l*c)+f*(+r*h*u-r*o*m-n*s*u+i*s*m+n*o*c-i*h*c)+p*(-a*o*c-r*l*u+r*o*d+a*s*u-i*s*d+i*l*c)}transpose(){let t=this.elements,r;return r=t[1],t[1]=t[4],t[4]=r,r=t[2],t[2]=t[8],t[8]=r,r=t[6],t[6]=t[9],t[9]=r,r=t[3],t[3]=t[12],t[12]=r,r=t[7],t[7]=t[13],t[13]=r,r=t[11],t[11]=t[14],t[14]=r,this}setPosition(t,r,i){let a=this.elements;return t.isVector3?(a[12]=t.x,a[13]=t.y,a[14]=t.z):(a[12]=t,a[13]=r,a[14]=i),this}invert(){let t=this.elements,r=t[0],i=t[1],a=t[2],n=t[3],s=t[4],o=t[5],l=t[6],h=t[7],c=t[8],u=t[9],d=t[10],m=t[11],x=t[12],_=t[13],f=t[14],p=t[15],A=u*f*h-_*d*h+_*l*m-o*f*m-u*l*p+o*d*p,S=x*d*h-c*f*h-x*l*m+s*f*m+c*l*p-s*d*p,b=c*_*h-x*u*h+x*o*m-s*_*m-c*o*p+s*u*p,C=x*u*l-c*_*l-x*o*d+s*_*d+c*o*f-s*u*f,L=r*A+i*S+a*b+n*C;if(L===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let U=1/L;return t[0]=A*U,t[1]=(_*d*n-u*f*n-_*a*m+i*f*m+u*a*p-i*d*p)*U,t[2]=(o*f*n-_*l*n+_*a*h-i*f*h-o*a*p+i*l*p)*U,t[3]=(u*l*n-o*d*n-u*a*h+i*d*h+o*a*m-i*l*m)*U,t[4]=S*U,t[5]=(c*f*n-x*d*n+x*a*m-r*f*m-c*a*p+r*d*p)*U,t[6]=(x*l*n-s*f*n-x*a*h+r*f*h+s*a*p-r*l*p)*U,t[7]=(s*d*n-c*l*n+c*a*h-r*d*h-s*a*m+r*l*m)*U,t[8]=b*U,t[9]=(x*u*n-c*_*n-x*i*m+r*_*m+c*i*p-r*u*p)*U,t[10]=(s*_*n-x*o*n+x*i*h-r*_*h-s*i*p+r*o*p)*U,t[11]=(c*o*n-s*u*n-c*i*h+r*u*h+s*i*m-r*o*m)*U,t[12]=C*U,t[13]=(c*_*a-x*u*a+x*i*d-r*_*d-c*i*f+r*u*f)*U,t[14]=(x*o*a-s*_*a-x*i*l+r*_*l+s*i*f-r*o*f)*U,t[15]=(s*u*a-c*o*a+c*i*l-r*u*l-s*i*d+r*o*d)*U,this}scale(t){let r=this.elements,i=t.x,a=t.y,n=t.z;return r[0]*=i,r[4]*=a,r[8]*=n,r[1]*=i,r[5]*=a,r[9]*=n,r[2]*=i,r[6]*=a,r[10]*=n,r[3]*=i,r[7]*=a,r[11]*=n,this}getMaxScaleOnAxis(){let t=this.elements,r=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],i=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],a=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(r,i,a))}makeTranslation(t,r,i){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,r,0,0,1,i,0,0,0,1),this}makeRotationX(t){let r=Math.cos(t),i=Math.sin(t);return this.set(1,0,0,0,0,r,-i,0,0,i,r,0,0,0,0,1),this}makeRotationY(t){let r=Math.cos(t),i=Math.sin(t);return this.set(r,0,i,0,0,1,0,0,-i,0,r,0,0,0,0,1),this}makeRotationZ(t){let r=Math.cos(t),i=Math.sin(t);return this.set(r,-i,0,0,i,r,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,r){let i=Math.cos(r),a=Math.sin(r),n=1-i,s=t.x,o=t.y,l=t.z,h=n*s,c=n*o;return this.set(h*s+i,h*o-a*l,h*l+a*o,0,h*o+a*l,c*o+i,c*l-a*s,0,h*l-a*o,c*l+a*s,n*l*l+i,0,0,0,0,1),this}makeScale(t,r,i){return this.set(t,0,0,0,0,r,0,0,0,0,i,0,0,0,0,1),this}makeShear(t,r,i,a,n,s){return this.set(1,i,n,0,t,1,s,0,r,a,1,0,0,0,0,1),this}compose(t,r,i){let a=this.elements,n=r._x,s=r._y,o=r._z,l=r._w,h=n+n,c=s+s,u=o+o,d=n*h,m=n*c,x=n*u,_=s*c,f=s*u,p=o*u,A=l*h,S=l*c,b=l*u,C=i.x,L=i.y,U=i.z;return a[0]=(1-(_+p))*C,a[1]=(m+b)*C,a[2]=(x-S)*C,a[3]=0,a[4]=(m-b)*L,a[5]=(1-(d+p))*L,a[6]=(f+A)*L,a[7]=0,a[8]=(x+S)*U,a[9]=(f-A)*U,a[10]=(1-(d+_))*U,a[11]=0,a[12]=t.x,a[13]=t.y,a[14]=t.z,a[15]=1,this}decompose(t,r,i){let a=this.elements,n=ci.set(a[0],a[1],a[2]).length(),s=ci.set(a[4],a[5],a[6]).length(),o=ci.set(a[8],a[9],a[10]).length();this.determinant()<0&&(n=-n),t.x=a[12],t.y=a[13],t.z=a[14],Yt.copy(this);let l=1/n,h=1/s,c=1/o;return Yt.elements[0]*=l,Yt.elements[1]*=l,Yt.elements[2]*=l,Yt.elements[4]*=h,Yt.elements[5]*=h,Yt.elements[6]*=h,Yt.elements[8]*=c,Yt.elements[9]*=c,Yt.elements[10]*=c,r.setFromRotationMatrix(Yt),i.x=n,i.y=s,i.z=o,this}makePerspective(t,r,i,a,n,s,o=er,l=!1){let h=this.elements,c=2*n/(r-t),u=2*n/(i-a),d=(r+t)/(r-t),m=(i+a)/(i-a),x,_;if(l)x=n/(s-n),_=s*n/(s-n);else if(o===er)x=-(s+n)/(s-n),_=-2*s*n/(s-n);else if(o===ma)x=-s/(s-n),_=-s*n/(s-n);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=d,h[12]=0,h[1]=0,h[5]=u,h[9]=m,h[13]=0,h[2]=0,h[6]=0,h[10]=x,h[14]=_,h[3]=0,h[7]=0,h[11]=-1,h[15]=0,this}makeOrthographic(t,r,i,a,n,s,o=er,l=!1){let h=this.elements,c=2/(r-t),u=2/(i-a),d=-(r+t)/(r-t),m=-(i+a)/(i-a),x,_;if(l)x=1/(s-n),_=s/(s-n);else if(o===er)x=-2/(s-n),_=-(s+n)/(s-n);else if(o===ma)x=-1/(s-n),_=-n/(s-n);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=0,h[12]=d,h[1]=0,h[5]=u,h[9]=0,h[13]=m,h[2]=0,h[6]=0,h[10]=x,h[14]=_,h[3]=0,h[7]=0,h[11]=0,h[15]=1,this}equals(t){let r=this.elements,i=t.elements;for(let a=0;a<16;a++)if(r[a]!==i[a])return!1;return!0}fromArray(t,r=0){for(let i=0;i<16;i++)this.elements[i]=t[i+r];return this}toArray(t=[],r=0){let i=this.elements;return t[r]=i[0],t[r+1]=i[1],t[r+2]=i[2],t[r+3]=i[3],t[r+4]=i[4],t[r+5]=i[5],t[r+6]=i[6],t[r+7]=i[7],t[r+8]=i[8],t[r+9]=i[9],t[r+10]=i[10],t[r+11]=i[11],t[r+12]=i[12],t[r+13]=i[13],t[r+14]=i[14],t[r+15]=i[15],t}},ci=new z,Yt=new ft,Jh=new z(0,0,0),Kh=new z(1,1,1),Cr=new z,Sa=new z,Ot=new z,To=new ft,Eo=new ai,cr=class ql{constructor(t=0,r=0,i=0,a=ql.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=r,this._z=i,this._order=a}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,r,i,a=this._order){return this._x=t,this._y=r,this._z=i,this._order=a,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,r=this._order,i=!0){let a=t.elements,n=a[0],s=a[4],o=a[8],l=a[1],h=a[5],c=a[9],u=a[2],d=a[6],m=a[10];switch(r){case"XYZ":this._y=Math.asin(Ke(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-c,m),this._z=Math.atan2(-s,n)):(this._x=Math.atan2(d,h),this._z=0);break;case"YXZ":this._x=Math.asin(-Ke(c,-1,1)),Math.abs(c)<.9999999?(this._y=Math.atan2(o,m),this._z=Math.atan2(l,h)):(this._y=Math.atan2(-u,n),this._z=0);break;case"ZXY":this._x=Math.asin(Ke(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,m),this._z=Math.atan2(-s,h)):(this._y=0,this._z=Math.atan2(l,n));break;case"ZYX":this._y=Math.asin(-Ke(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,m),this._z=Math.atan2(l,n)):(this._x=0,this._z=Math.atan2(-s,h));break;case"YZX":this._z=Math.asin(Ke(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-c,h),this._y=Math.atan2(-u,n)):(this._x=0,this._y=Math.atan2(o,m));break;case"XZY":this._z=Math.asin(-Ke(s,-1,1)),Math.abs(s)<.9999999?(this._x=Math.atan2(d,h),this._y=Math.atan2(o,n)):(this._x=Math.atan2(-c,m),this._y=0);break;default:ke("Euler: .setFromRotationMatrix() encountered an unknown order: "+r)}return this._order=r,i===!0&&this._onChangeCallback(),this}setFromQuaternion(t,r,i){return To.makeRotationFromQuaternion(t),this.setFromRotationMatrix(To,r,i)}setFromVector3(t,r=this._order){return this.set(t.x,t.y,t.z,r)}reorder(t){return Eo.setFromEuler(this),this.setFromQuaternion(Eo,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],r=0){return t[r]=this._x,t[r+1]=this._y,t[r+2]=this._z,t[r+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};cr.DEFAULT_ORDER="XYZ";var bo=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},Zh=0,wo=new z,ui=new ai,ur=new ft,Ta=new z,Hi=new z,$h=new z,Qh=new ai,Ao=new z(1,0,0),Co=new z(0,1,0),Ro=new z(0,0,1),Po={type:"added"},ec={type:"removed"},di={type:"childadded",child:null},hs={type:"childremoved",child:null},kt=class Ka extends ri{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Zh++}),this.uuid=ii(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Ka.DEFAULT_UP.clone();let t=new z,r=new cr,i=new ai,a=new z(1,1,1);function n(){i.setFromEuler(r,!1)}function s(){r.setFromQuaternion(i,void 0,!1)}r._onChange(n),i._onChange(s),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:r},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:a},modelViewMatrix:{value:new ft},normalMatrix:{value:new Ze}}),this.matrix=new ft,this.matrixWorld=new ft,this.matrixAutoUpdate=Ka.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Ka.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new bo,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,r){this.quaternion.setFromAxisAngle(t,r)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,r){return ui.setFromAxisAngle(t,r),this.quaternion.multiply(ui),this}rotateOnWorldAxis(t,r){return ui.setFromAxisAngle(t,r),this.quaternion.premultiply(ui),this}rotateX(t){return this.rotateOnAxis(Ao,t)}rotateY(t){return this.rotateOnAxis(Co,t)}rotateZ(t){return this.rotateOnAxis(Ro,t)}translateOnAxis(t,r){return wo.copy(t).applyQuaternion(this.quaternion),this.position.add(wo.multiplyScalar(r)),this}translateX(t){return this.translateOnAxis(Ao,t)}translateY(t){return this.translateOnAxis(Co,t)}translateZ(t){return this.translateOnAxis(Ro,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(ur.copy(this.matrixWorld).invert())}lookAt(t,r,i){t.isVector3?Ta.copy(t):Ta.set(t,r,i);let a=this.parent;this.updateWorldMatrix(!0,!1),Hi.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?ur.lookAt(Hi,Ta,this.up):ur.lookAt(Ta,Hi,this.up),this.quaternion.setFromRotationMatrix(ur),a&&(ur.extractRotation(a.matrixWorld),ui.setFromRotationMatrix(ur),this.quaternion.premultiply(ui.invert()))}add(t){if(arguments.length>1){for(let r=0;r<arguments.length;r++)this.add(arguments[r]);return this}return t===this?($e("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(Po),di.child=t,this.dispatchEvent(di),di.child=null):$e("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let r=this.children.indexOf(t);return r!==-1&&(t.parent=null,this.children.splice(r,1),t.dispatchEvent(ec),hs.child=t,this.dispatchEvent(hs),hs.child=null),this}removeFromParent(){let t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),ur.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),ur.multiply(t.parent.matrixWorld)),t.applyMatrix4(ur),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(Po),di.child=t,this.dispatchEvent(di),di.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,r){if(this[t]===r)return this;for(let i=0,a=this.children.length;i<a;i++){let n=this.children[i].getObjectByProperty(t,r);if(n!==void 0)return n}}getObjectsByProperty(t,r,i=[]){this[t]===r&&i.push(this);let a=this.children;for(let n=0,s=a.length;n<s;n++)a[n].getObjectsByProperty(t,r,i);return i}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Hi,t,$h),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Hi,Qh,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);let r=this.matrixWorld.elements;return t.set(r[8],r[9],r[10]).normalize()}raycast(){}traverse(t){t(this);let r=this.children;for(let i=0,a=r.length;i<a;i++)r[i].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);let r=this.children;for(let i=0,a=r.length;i<a;i++)r[i].traverseVisible(t)}traverseAncestors(t){let r=this.parent;r!==null&&(t(r),r.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);let r=this.children;for(let i=0,a=r.length;i<a;i++)r[i].updateMatrixWorld(t)}updateWorldMatrix(t,r){let i=this.parent;if(t===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),r===!0){let a=this.children;for(let n=0,s=a.length;n<s;n++)a[n].updateWorldMatrix(!1,!0)}}toJSON(t){let r=t===void 0||typeof t=="string",i={};r&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let a={};a.uuid=this.uuid,a.type=this.type,this.name!==""&&(a.name=this.name),this.castShadow===!0&&(a.castShadow=!0),this.receiveShadow===!0&&(a.receiveShadow=!0),this.visible===!1&&(a.visible=!1),this.frustumCulled===!1&&(a.frustumCulled=!1),this.renderOrder!==0&&(a.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(a.userData=this.userData),a.layers=this.layers.mask,a.matrix=this.matrix.toArray(),a.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(a.matrixAutoUpdate=!1),this.isInstancedMesh&&(a.type="InstancedMesh",a.count=this.count,a.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(a.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(a.type="BatchedMesh",a.perObjectFrustumCulled=this.perObjectFrustumCulled,a.sortObjects=this.sortObjects,a.drawRanges=this._drawRanges,a.reservedRanges=this._reservedRanges,a.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),a.instanceInfo=this._instanceInfo.map(o=>({...o})),a.availableInstanceIds=this._availableInstanceIds.slice(),a.availableGeometryIds=this._availableGeometryIds.slice(),a.nextIndexStart=this._nextIndexStart,a.nextVertexStart=this._nextVertexStart,a.geometryCount=this._geometryCount,a.maxInstanceCount=this._maxInstanceCount,a.maxVertexCount=this._maxVertexCount,a.maxIndexCount=this._maxIndexCount,a.geometryInitialized=this._geometryInitialized,a.matricesTexture=this._matricesTexture.toJSON(t),a.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(a.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(a.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(a.boundingBox=this.boundingBox.toJSON()));function n(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?a.background=this.background.toJSON():this.background.isTexture&&(a.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(a.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){a.geometry=n(t.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let l=o.shapes;if(Array.isArray(l))for(let h=0,c=l.length;h<c;h++){let u=l[h];n(t.shapes,u)}else n(t.shapes,l)}}if(this.isSkinnedMesh&&(a.bindMode=this.bindMode,a.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(n(t.skeletons,this.skeleton),a.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let l=0,h=this.material.length;l<h;l++)o.push(n(t.materials,this.material[l]));a.material=o}else a.material=n(t.materials,this.material);if(this.children.length>0){a.children=[];for(let o=0;o<this.children.length;o++)a.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){a.animations=[];for(let o=0;o<this.animations.length;o++){let l=this.animations[o];a.animations.push(n(t.animations,l))}}if(r){let o=s(t.geometries),l=s(t.materials),h=s(t.textures),c=s(t.images),u=s(t.shapes),d=s(t.skeletons),m=s(t.animations),x=s(t.nodes);o.length>0&&(i.geometries=o),l.length>0&&(i.materials=l),h.length>0&&(i.textures=h),c.length>0&&(i.images=c),u.length>0&&(i.shapes=u),d.length>0&&(i.skeletons=d),m.length>0&&(i.animations=m),x.length>0&&(i.nodes=x)}return i.object=a,i;function s(o){let l=[];for(let h in o){let c=o[h];delete c.metadata,l.push(c)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,r=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),r===!0)for(let i=0;i<t.children.length;i++){let a=t.children[i];this.add(a.clone())}return this}};kt.DEFAULT_UP=new z(0,1,0),kt.DEFAULT_MATRIX_AUTO_UPDATE=!0,kt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Jt=new z,dr=new z,cs=new z,pr=new z,pi=new z,fi=new z,Lo=new z,us=new z,ds=new z,ps=new z,fs=new ct,ms=new ct,gs=new ct,Wi=class Pi{constructor(t=new z,r=new z,i=new z){this.a=t,this.b=r,this.c=i}static getNormal(t,r,i,a){a.subVectors(i,r),Jt.subVectors(t,r),a.cross(Jt);let n=a.lengthSq();return n>0?a.multiplyScalar(1/Math.sqrt(n)):a.set(0,0,0)}static getBarycoord(t,r,i,a,n){Jt.subVectors(a,r),dr.subVectors(i,r),cs.subVectors(t,r);let s=Jt.dot(Jt),o=Jt.dot(dr),l=Jt.dot(cs),h=dr.dot(dr),c=dr.dot(cs),u=s*h-o*o;if(u===0)return n.set(0,0,0),null;let d=1/u,m=(h*l-o*c)*d,x=(s*c-o*l)*d;return n.set(1-m-x,x,m)}static containsPoint(t,r,i,a){return this.getBarycoord(t,r,i,a,pr)===null?!1:pr.x>=0&&pr.y>=0&&pr.x+pr.y<=1}static getInterpolation(t,r,i,a,n,s,o,l){return this.getBarycoord(t,r,i,a,pr)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(n,pr.x),l.addScaledVector(s,pr.y),l.addScaledVector(o,pr.z),l)}static getInterpolatedAttribute(t,r,i,a,n,s){return fs.setScalar(0),ms.setScalar(0),gs.setScalar(0),fs.fromBufferAttribute(t,r),ms.fromBufferAttribute(t,i),gs.fromBufferAttribute(t,a),s.setScalar(0),s.addScaledVector(fs,n.x),s.addScaledVector(ms,n.y),s.addScaledVector(gs,n.z),s}static isFrontFacing(t,r,i,a){return Jt.subVectors(i,r),dr.subVectors(t,r),Jt.cross(dr).dot(a)<0}set(t,r,i){return this.a.copy(t),this.b.copy(r),this.c.copy(i),this}setFromPointsAndIndices(t,r,i,a){return this.a.copy(t[r]),this.b.copy(t[i]),this.c.copy(t[a]),this}setFromAttributeAndIndices(t,r,i,a){return this.a.fromBufferAttribute(t,r),this.b.fromBufferAttribute(t,i),this.c.fromBufferAttribute(t,a),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Jt.subVectors(this.c,this.b),dr.subVectors(this.a,this.b),Jt.cross(dr).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return Pi.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,r){return Pi.getBarycoord(t,this.a,this.b,this.c,r)}getInterpolation(t,r,i,a,n){return Pi.getInterpolation(t,this.a,this.b,this.c,r,i,a,n)}containsPoint(t){return Pi.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return Pi.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,r){let i=this.a,a=this.b,n=this.c,s,o;pi.subVectors(a,i),fi.subVectors(n,i),us.subVectors(t,i);let l=pi.dot(us),h=fi.dot(us);if(l<=0&&h<=0)return r.copy(i);ds.subVectors(t,a);let c=pi.dot(ds),u=fi.dot(ds);if(c>=0&&u<=c)return r.copy(a);let d=l*u-c*h;if(d<=0&&l>=0&&c<=0)return s=l/(l-c),r.copy(i).addScaledVector(pi,s);ps.subVectors(t,n);let m=pi.dot(ps),x=fi.dot(ps);if(x>=0&&m<=x)return r.copy(n);let _=m*h-l*x;if(_<=0&&h>=0&&x<=0)return o=h/(h-x),r.copy(i).addScaledVector(fi,o);let f=c*x-m*u;if(f<=0&&u-c>=0&&m-x>=0)return Lo.subVectors(n,a),o=(u-c)/(u-c+(m-x)),r.copy(a).addScaledVector(Lo,o);let p=1/(f+_+d);return s=_*p,o=d*p,r.copy(i).addScaledVector(pi,s).addScaledVector(fi,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}},No={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Rr={h:0,s:0,l:0},Ea={h:0,s:0,l:0};function _s(e,t,r){return r<0&&(r+=1),r>1&&(r-=1),r<1/6?e+(t-e)*6*r:r<1/2?t:r<2/3?e+(t-e)*6*(2/3-r):e}var Qe=class{constructor(e,t,r){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,r)}set(e,t,r){if(t===void 0&&r===void 0){let i=e;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(e,t,r);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Pt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,at.colorSpaceToWorking(this,t),this}setRGB(e,t,r,i=at.workingColorSpace){return this.r=e,this.g=t,this.b=r,at.colorSpaceToWorking(this,i),this}setHSL(e,t,r,i=at.workingColorSpace){if(e=Vh(e,1),t=Ke(t,0,1),r=Ke(r,0,1),t===0)this.r=this.g=this.b=r;else{let a=r<=.5?r*(1+t):r+t-r*t,n=2*r-a;this.r=_s(n,a,e+1/3),this.g=_s(n,a,e),this.b=_s(n,a,e-1/3)}return at.colorSpaceToWorking(this,i),this}setStyle(e,t=Pt){function r(a){a!==void 0&&parseFloat(a)<1&&ke("Color: Alpha component of "+e+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(e)){let a,n=i[1],s=i[2];switch(n){case"rgb":case"rgba":if(a=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(s))return r(a[4]),this.setRGB(Math.min(255,parseInt(a[1],10))/255,Math.min(255,parseInt(a[2],10))/255,Math.min(255,parseInt(a[3],10))/255,t);if(a=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(s))return r(a[4]),this.setRGB(Math.min(100,parseInt(a[1],10))/100,Math.min(100,parseInt(a[2],10))/100,Math.min(100,parseInt(a[3],10))/100,t);break;case"hsl":case"hsla":if(a=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(s))return r(a[4]),this.setHSL(parseFloat(a[1])/360,parseFloat(a[2])/100,parseFloat(a[3])/100,t);break;default:ke("Color: Unknown color model "+e)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(e)){let a=i[1],n=a.length;if(n===3)return this.setRGB(parseInt(a.charAt(0),16)/15,parseInt(a.charAt(1),16)/15,parseInt(a.charAt(2),16)/15,t);if(n===6)return this.setHex(parseInt(a,16),t);ke("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Pt){let r=No[e.toLowerCase()];return r!==void 0?this.setHex(r,t):ke("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=or(e.r),this.g=or(e.g),this.b=or(e.b),this}copyLinearToSRGB(e){return this.r=ni(e.r),this.g=ni(e.g),this.b=ni(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Pt){return at.workingToColorSpace(Et.copy(this),e),Math.round(Ke(Et.r*255,0,255))*65536+Math.round(Ke(Et.g*255,0,255))*256+Math.round(Ke(Et.b*255,0,255))}getHexString(e=Pt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=at.workingColorSpace){at.workingToColorSpace(Et.copy(this),t);let r=Et.r,i=Et.g,a=Et.b,n=Math.max(r,i,a),s=Math.min(r,i,a),o,l,h=(s+n)/2;if(s===n)o=0,l=0;else{let c=n-s;switch(l=h<=.5?c/(n+s):c/(2-n-s),n){case r:o=(i-a)/c+(i<a?6:0);break;case i:o=(a-r)/c+2;break;case a:o=(r-i)/c+4;break}o/=6}return e.h=o,e.s=l,e.l=h,e}getRGB(e,t=at.workingColorSpace){return at.workingToColorSpace(Et.copy(this),t),e.r=Et.r,e.g=Et.g,e.b=Et.b,e}getStyle(e=Pt){at.workingToColorSpace(Et.copy(this),e);let t=Et.r,r=Et.g,i=Et.b;return e!==Pt?`color(${e} ${t.toFixed(3)} ${r.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(r*255)},${Math.round(i*255)})`}offsetHSL(e,t,r){return this.getHSL(Rr),this.setHSL(Rr.h+e,Rr.s+t,Rr.l+r)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,r){return this.r=e.r+(t.r-e.r)*r,this.g=e.g+(t.g-e.g)*r,this.b=e.b+(t.b-e.b)*r,this}lerpHSL(e,t){this.getHSL(Rr),e.getHSL(Ea);let r=Zn(Rr.h,Ea.h,t),i=Zn(Rr.s,Ea.s,t),a=Zn(Rr.l,Ea.l,t);return this.setHSL(r,i,a),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,r=this.g,i=this.b,a=e.elements;return this.r=a[0]*t+a[3]*r+a[6]*i,this.g=a[1]*t+a[4]*r+a[7]*i,this.b=a[2]*t+a[5]*r+a[8]*i,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Et=new Qe;Qe.NAMES=No;var tc=0,mi=class extends ri{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:tc++}),this.uuid=ii(),this.name="",this.type="Material",this.blending=Kr,this.side=yr,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=$a,this.blendDst=Qa,this.blendEquation=Or,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Qe(0,0,0),this.blendAlpha=0,this.depthFunc=Zr,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=uo,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ei,this.stencilZFail=ei,this.stencilZPass=ei,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let r=e[t];if(r===void 0){ke(`Material: parameter '${t}' has value of undefined.`);continue}let i=this[t];if(i===void 0){ke(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(r):i&&i.isVector3&&r&&r.isVector3?i.copy(r):this[t]=r}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let r={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.color&&this.color.isColor&&(r.color=this.color.getHex()),this.roughness!==void 0&&(r.roughness=this.roughness),this.metalness!==void 0&&(r.metalness=this.metalness),this.sheen!==void 0&&(r.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(r.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(r.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(r.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(r.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(r.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(r.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(r.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(r.shininess=this.shininess),this.clearcoat!==void 0&&(r.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(r.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(r.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(r.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(r.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,r.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(r.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(r.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(r.dispersion=this.dispersion),this.iridescence!==void 0&&(r.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(r.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(r.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(r.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(r.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(r.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(r.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(r.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(r.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(r.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(r.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(r.lightMap=this.lightMap.toJSON(e).uuid,r.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(r.aoMap=this.aoMap.toJSON(e).uuid,r.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(r.bumpMap=this.bumpMap.toJSON(e).uuid,r.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(r.normalMap=this.normalMap.toJSON(e).uuid,r.normalMapType=this.normalMapType,r.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(r.displacementMap=this.displacementMap.toJSON(e).uuid,r.displacementScale=this.displacementScale,r.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(r.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(r.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(r.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(r.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(r.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(r.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(r.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(r.combine=this.combine)),this.envMapRotation!==void 0&&(r.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(r.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(r.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(r.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(r.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(r.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(r.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(r.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(r.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(r.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(r.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(r.size=this.size),this.shadowSide!==null&&(r.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(r.sizeAttenuation=this.sizeAttenuation),this.blending!==Kr&&(r.blending=this.blending),this.side!==yr&&(r.side=this.side),this.vertexColors===!0&&(r.vertexColors=!0),this.opacity<1&&(r.opacity=this.opacity),this.transparent===!0&&(r.transparent=!0),this.blendSrc!==$a&&(r.blendSrc=this.blendSrc),this.blendDst!==Qa&&(r.blendDst=this.blendDst),this.blendEquation!==Or&&(r.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(r.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(r.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(r.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(r.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(r.blendAlpha=this.blendAlpha),this.depthFunc!==Zr&&(r.depthFunc=this.depthFunc),this.depthTest===!1&&(r.depthTest=this.depthTest),this.depthWrite===!1&&(r.depthWrite=this.depthWrite),this.colorWrite===!1&&(r.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(r.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==uo&&(r.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(r.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(r.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==ei&&(r.stencilFail=this.stencilFail),this.stencilZFail!==ei&&(r.stencilZFail=this.stencilZFail),this.stencilZPass!==ei&&(r.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(r.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(r.rotation=this.rotation),this.polygonOffset===!0&&(r.polygonOffset=!0),this.polygonOffsetFactor!==0&&(r.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(r.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(r.linewidth=this.linewidth),this.dashSize!==void 0&&(r.dashSize=this.dashSize),this.gapSize!==void 0&&(r.gapSize=this.gapSize),this.scale!==void 0&&(r.scale=this.scale),this.dithering===!0&&(r.dithering=!0),this.alphaTest>0&&(r.alphaTest=this.alphaTest),this.alphaHash===!0&&(r.alphaHash=!0),this.alphaToCoverage===!0&&(r.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(r.premultipliedAlpha=!0),this.forceSinglePass===!0&&(r.forceSinglePass=!0),this.wireframe===!0&&(r.wireframe=!0),this.wireframeLinewidth>1&&(r.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(r.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(r.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(r.flatShading=!0),this.visible===!1&&(r.visible=!1),this.toneMapped===!1&&(r.toneMapped=!1),this.fog===!1&&(r.fog=!1),Object.keys(this.userData).length>0&&(r.userData=this.userData);function i(a){let n=[];for(let s in a){let o=a[s];delete o.metadata,n.push(o)}return n}if(t){let a=i(e.textures),n=i(e.images);a.length>0&&(r.textures=a),n.length>0&&(r.images=n)}return r}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,r=null;if(t!==null){let i=t.length;r=new Array(i);for(let a=0;a!==i;++a)r[a]=t[a].clone()}return this.clippingPlanes=r,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},vs=class extends mi{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Qe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new cr,this.combine=$s,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},fr=rc();function rc(){let e=new ArrayBuffer(4),t=new Float32Array(e),r=new Uint32Array(e),i=new Uint32Array(512),a=new Uint32Array(512);for(let l=0;l<256;++l){let h=l-127;h<-27?(i[l]=0,i[l|256]=32768,a[l]=24,a[l|256]=24):h<-14?(i[l]=1024>>-h-14,i[l|256]=1024>>-h-14|32768,a[l]=-h-1,a[l|256]=-h-1):h<=15?(i[l]=h+15<<10,i[l|256]=h+15<<10|32768,a[l]=13,a[l|256]=13):h<128?(i[l]=31744,i[l|256]=64512,a[l]=24,a[l|256]=24):(i[l]=31744,i[l|256]=64512,a[l]=13,a[l|256]=13)}let n=new Uint32Array(2048),s=new Uint32Array(64),o=new Uint32Array(64);for(let l=1;l<1024;++l){let h=l<<13,c=0;for(;(h&8388608)===0;)h<<=1,c-=8388608;h&=-8388609,c+=947912704,n[l]=h|c}for(let l=1024;l<2048;++l)n[l]=939524096+(l-1024<<13);for(let l=1;l<31;++l)s[l]=l<<23;s[31]=1199570944,s[32]=2147483648;for(let l=33;l<63;++l)s[l]=2147483648+(l-32<<23);s[63]=3347054592;for(let l=1;l<64;++l)l!==32&&(o[l]=1024);return{floatView:t,uint32View:r,baseTable:i,shiftTable:a,mantissaTable:n,exponentTable:s,offsetTable:o}}function ic(e){Math.abs(e)>65504&&ke("DataUtils.toHalfFloat(): Value out of range."),e=Ke(e,-65504,65504),fr.floatView[0]=e;let t=fr.uint32View[0],r=t>>23&511;return fr.baseTable[r]+((t&8388607)>>fr.shiftTable[r])}function ac(e){let t=e>>10;return fr.uint32View[0]=fr.mantissaTable[fr.offsetTable[t]+(e&1023)]+fr.exponentTable[t],fr.floatView[0]}var ba=class{static toHalfFloat(e){return ic(e)}static fromHalfFloat(e){return ac(e)}},mt=new z,wa=new ye,nc=0,Kt=class{constructor(e,t,r=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:nc++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=r,this.usage=fo,this.updateRanges=[],this.gpuType=Vt,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,r){e*=this.itemSize,r*=t.itemSize;for(let i=0,a=this.itemSize;i<a;i++)this.array[e+i]=t.array[r+i];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,r=this.count;t<r;t++)wa.fromBufferAttribute(this,t),wa.applyMatrix3(e),this.setXY(t,wa.x,wa.y);else if(this.itemSize===3)for(let t=0,r=this.count;t<r;t++)mt.fromBufferAttribute(this,t),mt.applyMatrix3(e),this.setXYZ(t,mt.x,mt.y,mt.z);return this}applyMatrix4(e){for(let t=0,r=this.count;t<r;t++)mt.fromBufferAttribute(this,t),mt.applyMatrix4(e),this.setXYZ(t,mt.x,mt.y,mt.z);return this}applyNormalMatrix(e){for(let t=0,r=this.count;t<r;t++)mt.fromBufferAttribute(this,t),mt.applyNormalMatrix(e),this.setXYZ(t,mt.x,mt.y,mt.z);return this}transformDirection(e){for(let t=0,r=this.count;t<r;t++)mt.fromBufferAttribute(this,t),mt.transformDirection(e),this.setXYZ(t,mt.x,mt.y,mt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let r=this.array[e*this.itemSize+t];return this.normalized&&(r=zi(r,this.array)),r}setComponent(e,t,r){return this.normalized&&(r=Lt(r,this.array)),this.array[e*this.itemSize+t]=r,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=zi(t,this.array)),t}setX(e,t){return this.normalized&&(t=Lt(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=zi(t,this.array)),t}setY(e,t){return this.normalized&&(t=Lt(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=zi(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Lt(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=zi(t,this.array)),t}setW(e,t){return this.normalized&&(t=Lt(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,r){return e*=this.itemSize,this.normalized&&(t=Lt(t,this.array),r=Lt(r,this.array)),this.array[e+0]=t,this.array[e+1]=r,this}setXYZ(e,t,r,i){return e*=this.itemSize,this.normalized&&(t=Lt(t,this.array),r=Lt(r,this.array),i=Lt(i,this.array)),this.array[e+0]=t,this.array[e+1]=r,this.array[e+2]=i,this}setXYZW(e,t,r,i,a){return e*=this.itemSize,this.normalized&&(t=Lt(t,this.array),r=Lt(r,this.array),i=Lt(i,this.array),a=Lt(a,this.array)),this.array[e+0]=t,this.array[e+1]=r,this.array[e+2]=i,this.array[e+3]=a,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==fo&&(e.usage=this.usage),e}},Uo=class extends Kt{constructor(e,t,r){super(new Uint16Array(e),t,r)}},Do=class extends Kt{constructor(e,t,r){super(new Uint32Array(e),t,r)}},mr=class extends Kt{constructor(e,t,r){super(new Float32Array(e),t,r)}},sc=0,Gt=new ft,xs=new kt,gi=new z,Ft=new Vi,Xi=new Vi,Mt=new z,Gr=class jl extends ri{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:sc++}),this.uuid=ii(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(go(t)?Do:Uo)(t,1):this.index=t,this}setIndirect(t){return this.indirect=t,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,r){return this.attributes[t]=r,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,r,i=0){this.groups.push({start:t,count:r,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(t,r){this.drawRange.start=t,this.drawRange.count=r}applyMatrix4(t){let r=this.attributes.position;r!==void 0&&(r.applyMatrix4(t),r.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let n=new Ze().getNormalMatrix(t);i.applyNormalMatrix(n),i.needsUpdate=!0}let a=this.attributes.tangent;return a!==void 0&&(a.transformDirection(t),a.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(t){return Gt.makeRotationFromQuaternion(t),this.applyMatrix4(Gt),this}rotateX(t){return Gt.makeRotationX(t),this.applyMatrix4(Gt),this}rotateY(t){return Gt.makeRotationY(t),this.applyMatrix4(Gt),this}rotateZ(t){return Gt.makeRotationZ(t),this.applyMatrix4(Gt),this}translate(t,r,i){return Gt.makeTranslation(t,r,i),this.applyMatrix4(Gt),this}scale(t,r,i){return Gt.makeScale(t,r,i),this.applyMatrix4(Gt),this}lookAt(t){return xs.lookAt(t),xs.updateMatrix(),this.applyMatrix4(xs.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(gi).negate(),this.translate(gi.x,gi.y,gi.z),this}setFromPoints(t){let r=this.getAttribute("position");if(r===void 0){let i=[];for(let a=0,n=t.length;a<n;a++){let s=t[a];i.push(s.x,s.y,s.z||0)}this.setAttribute("position",new mr(i,3))}else{let i=Math.min(t.length,r.count);for(let a=0;a<i;a++){let n=t[a];r.setXYZ(a,n.x,n.y,n.z||0)}t.length>r.count&&ke("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),r.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Vi);let t=this.attributes.position,r=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){$e("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new z(-1/0,-1/0,-1/0),new z(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),r)for(let i=0,a=r.length;i<a;i++){let n=r[i];Ft.setFromBufferAttribute(n),this.morphTargetsRelative?(Mt.addVectors(this.boundingBox.min,Ft.min),this.boundingBox.expandByPoint(Mt),Mt.addVectors(this.boundingBox.max,Ft.max),this.boundingBox.expandByPoint(Mt)):(this.boundingBox.expandByPoint(Ft.min),this.boundingBox.expandByPoint(Ft.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&$e('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ns);let t=this.attributes.position,r=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){$e("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new z,1/0);return}if(t){let i=this.boundingSphere.center;if(Ft.setFromBufferAttribute(t),r)for(let n=0,s=r.length;n<s;n++){let o=r[n];Xi.setFromBufferAttribute(o),this.morphTargetsRelative?(Mt.addVectors(Ft.min,Xi.min),Ft.expandByPoint(Mt),Mt.addVectors(Ft.max,Xi.max),Ft.expandByPoint(Mt)):(Ft.expandByPoint(Xi.min),Ft.expandByPoint(Xi.max))}Ft.getCenter(i);let a=0;for(let n=0,s=t.count;n<s;n++)Mt.fromBufferAttribute(t,n),a=Math.max(a,i.distanceToSquared(Mt));if(r)for(let n=0,s=r.length;n<s;n++){let o=r[n],l=this.morphTargetsRelative;for(let h=0,c=o.count;h<c;h++)Mt.fromBufferAttribute(o,h),l&&(gi.fromBufferAttribute(t,h),Mt.add(gi)),a=Math.max(a,i.distanceToSquared(Mt))}this.boundingSphere.radius=Math.sqrt(a),isNaN(this.boundingSphere.radius)&&$e('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let t=this.index,r=this.attributes;if(t===null||r.position===void 0||r.normal===void 0||r.uv===void 0){$e("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=r.position,a=r.normal,n=r.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Kt(new Float32Array(4*i.count),4));let s=this.getAttribute("tangent"),o=[],l=[];for(let B=0;B<i.count;B++)o[B]=new z,l[B]=new z;let h=new z,c=new z,u=new z,d=new ye,m=new ye,x=new ye,_=new z,f=new z;function p(B,M,y){h.fromBufferAttribute(i,B),c.fromBufferAttribute(i,M),u.fromBufferAttribute(i,y),d.fromBufferAttribute(n,B),m.fromBufferAttribute(n,M),x.fromBufferAttribute(n,y),c.sub(h),u.sub(h),m.sub(d),x.sub(d);let R=1/(m.x*x.y-x.x*m.y);isFinite(R)&&(_.copy(c).multiplyScalar(x.y).addScaledVector(u,-m.y).multiplyScalar(R),f.copy(u).multiplyScalar(m.x).addScaledVector(c,-x.x).multiplyScalar(R),o[B].add(_),o[M].add(_),o[y].add(_),l[B].add(f),l[M].add(f),l[y].add(f))}let A=this.groups;A.length===0&&(A=[{start:0,count:t.count}]);for(let B=0,M=A.length;B<M;++B){let y=A[B],R=y.start,q=y.count;for(let W=R,k=R+q;W<k;W+=3)p(t.getX(W+0),t.getX(W+1),t.getX(W+2))}let S=new z,b=new z,C=new z,L=new z;function U(B){C.fromBufferAttribute(a,B),L.copy(C);let M=o[B];S.copy(M),S.sub(C.multiplyScalar(C.dot(M))).normalize(),b.crossVectors(L,M);let y=b.dot(l[B])<0?-1:1;s.setXYZW(B,S.x,S.y,S.z,y)}for(let B=0,M=A.length;B<M;++B){let y=A[B],R=y.start,q=y.count;for(let W=R,k=R+q;W<k;W+=3)U(t.getX(W+0)),U(t.getX(W+1)),U(t.getX(W+2))}}computeVertexNormals(){let t=this.index,r=this.getAttribute("position");if(r!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Kt(new Float32Array(r.count*3),3),this.setAttribute("normal",i);else for(let d=0,m=i.count;d<m;d++)i.setXYZ(d,0,0,0);let a=new z,n=new z,s=new z,o=new z,l=new z,h=new z,c=new z,u=new z;if(t)for(let d=0,m=t.count;d<m;d+=3){let x=t.getX(d+0),_=t.getX(d+1),f=t.getX(d+2);a.fromBufferAttribute(r,x),n.fromBufferAttribute(r,_),s.fromBufferAttribute(r,f),c.subVectors(s,n),u.subVectors(a,n),c.cross(u),o.fromBufferAttribute(i,x),l.fromBufferAttribute(i,_),h.fromBufferAttribute(i,f),o.add(c),l.add(c),h.add(c),i.setXYZ(x,o.x,o.y,o.z),i.setXYZ(_,l.x,l.y,l.z),i.setXYZ(f,h.x,h.y,h.z)}else for(let d=0,m=r.count;d<m;d+=3)a.fromBufferAttribute(r,d+0),n.fromBufferAttribute(r,d+1),s.fromBufferAttribute(r,d+2),c.subVectors(s,n),u.subVectors(a,n),c.cross(u),i.setXYZ(d+0,c.x,c.y,c.z),i.setXYZ(d+1,c.x,c.y,c.z),i.setXYZ(d+2,c.x,c.y,c.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let t=this.attributes.normal;for(let r=0,i=t.count;r<i;r++)Mt.fromBufferAttribute(t,r),Mt.normalize(),t.setXYZ(r,Mt.x,Mt.y,Mt.z)}toNonIndexed(){function t(o,l){let h=o.array,c=o.itemSize,u=o.normalized,d=new h.constructor(l.length*c),m=0,x=0;for(let _=0,f=l.length;_<f;_++){o.isInterleavedBufferAttribute?m=l[_]*o.data.stride+o.offset:m=l[_]*c;for(let p=0;p<c;p++)d[x++]=h[m++]}return new Kt(d,c,u)}if(this.index===null)return ke("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let r=new jl,i=this.index.array,a=this.attributes;for(let o in a){let l=a[o],h=t(l,i);r.setAttribute(o,h)}let n=this.morphAttributes;for(let o in n){let l=[],h=n[o];for(let c=0,u=h.length;c<u;c++){let d=h[c],m=t(d,i);l.push(m)}r.morphAttributes[o]=l}r.morphTargetsRelative=this.morphTargetsRelative;let s=this.groups;for(let o=0,l=s.length;o<l;o++){let h=s[o];r.addGroup(h.start,h.count,h.materialIndex)}return r}toJSON(){let t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let h in l)l[h]!==void 0&&(t[h]=l[h]);return t}t.data={attributes:{}};let r=this.index;r!==null&&(t.data.index={type:r.array.constructor.name,array:Array.prototype.slice.call(r.array)});let i=this.attributes;for(let l in i){let h=i[l];t.data.attributes[l]=h.toJSON(t.data)}let a={},n=!1;for(let l in this.morphAttributes){let h=this.morphAttributes[l],c=[];for(let u=0,d=h.length;u<d;u++){let m=h[u];c.push(m.toJSON(t.data))}c.length>0&&(a[l]=c,n=!0)}n&&(t.data.morphAttributes=a,t.data.morphTargetsRelative=this.morphTargetsRelative);let s=this.groups;s.length>0&&(t.data.groups=JSON.parse(JSON.stringify(s)));let o=this.boundingSphere;return o!==null&&(t.data.boundingSphere=o.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let r={};this.name=t.name;let i=t.index;i!==null&&this.setIndex(i.clone());let a=t.attributes;for(let h in a){let c=a[h];this.setAttribute(h,c.clone(r))}let n=t.morphAttributes;for(let h in n){let c=[],u=n[h];for(let d=0,m=u.length;d<m;d++)c.push(u[d].clone(r));this.morphAttributes[h]=c}this.morphTargetsRelative=t.morphTargetsRelative;let s=t.groups;for(let h=0,c=s.length;h<c;h++){let u=s[h];this.addGroup(u.start,u.count,u.materialIndex)}let o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());let l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},Io=new ft,Hr=new Yh,Aa=new ns,Oo=new z,Ca=new z,Ra=new z,Pa=new z,Ms=new z,La=new z,Fo=new z,Na=new z,Zt=class extends kt{constructor(e=new Gr,t=new vs){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let e=this.geometry.morphAttributes,t=Object.keys(e);if(t.length>0){let r=e[t[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let i=0,a=r.length;i<a;i++){let n=r[i].name||String(i);this.morphTargetInfluences.push(0),this.morphTargetDictionary[n]=i}}}}getVertexPosition(e,t){let r=this.geometry,i=r.attributes.position,a=r.morphAttributes.position,n=r.morphTargetsRelative;t.fromBufferAttribute(i,e);let s=this.morphTargetInfluences;if(a&&s){La.set(0,0,0);for(let o=0,l=a.length;o<l;o++){let h=s[o],c=a[o];h!==0&&(Ms.fromBufferAttribute(c,e),n?La.addScaledVector(Ms,h):La.addScaledVector(Ms.sub(t),h))}t.add(La)}return t}raycast(e,t){let r=this.geometry,i=this.material,a=this.matrixWorld;i!==void 0&&(r.boundingSphere===null&&r.computeBoundingSphere(),Aa.copy(r.boundingSphere),Aa.applyMatrix4(a),Hr.copy(e.ray).recast(e.near),!(Aa.containsPoint(Hr.origin)===!1&&(Hr.intersectSphere(Aa,Oo)===null||Hr.origin.distanceToSquared(Oo)>(e.far-e.near)**2))&&(Io.copy(a).invert(),Hr.copy(e.ray).applyMatrix4(Io),!(r.boundingBox!==null&&Hr.intersectsBox(r.boundingBox)===!1)&&this._computeIntersections(e,t,Hr)))}_computeIntersections(e,t,r){let i,a=this.geometry,n=this.material,s=a.index,o=a.attributes.position,l=a.attributes.uv,h=a.attributes.uv1,c=a.attributes.normal,u=a.groups,d=a.drawRange;if(s!==null)if(Array.isArray(n))for(let m=0,x=u.length;m<x;m++){let _=u[m],f=n[_.materialIndex],p=Math.max(_.start,d.start),A=Math.min(s.count,Math.min(_.start+_.count,d.start+d.count));for(let S=p,b=A;S<b;S+=3){let C=s.getX(S),L=s.getX(S+1),U=s.getX(S+2);i=Ua(this,f,e,r,l,h,c,C,L,U),i&&(i.faceIndex=Math.floor(S/3),i.face.materialIndex=_.materialIndex,t.push(i))}}else{let m=Math.max(0,d.start),x=Math.min(s.count,d.start+d.count);for(let _=m,f=x;_<f;_+=3){let p=s.getX(_),A=s.getX(_+1),S=s.getX(_+2);i=Ua(this,n,e,r,l,h,c,p,A,S),i&&(i.faceIndex=Math.floor(_/3),t.push(i))}}else if(o!==void 0)if(Array.isArray(n))for(let m=0,x=u.length;m<x;m++){let _=u[m],f=n[_.materialIndex],p=Math.max(_.start,d.start),A=Math.min(o.count,Math.min(_.start+_.count,d.start+d.count));for(let S=p,b=A;S<b;S+=3){let C=S,L=S+1,U=S+2;i=Ua(this,f,e,r,l,h,c,C,L,U),i&&(i.faceIndex=Math.floor(S/3),i.face.materialIndex=_.materialIndex,t.push(i))}}else{let m=Math.max(0,d.start),x=Math.min(o.count,d.start+d.count);for(let _=m,f=x;_<f;_+=3){let p=_,A=_+1,S=_+2;i=Ua(this,n,e,r,l,h,c,p,A,S),i&&(i.faceIndex=Math.floor(_/3),t.push(i))}}}};function oc(e,t,r,i,a,n,s,o){let l;if(t.side===Rt?l=i.intersectTriangle(s,n,a,!0,o):l=i.intersectTriangle(a,n,s,t.side===yr,o),l===null)return null;Na.copy(o),Na.applyMatrix4(e.matrixWorld);let h=r.ray.origin.distanceTo(Na);return h<r.near||h>r.far?null:{distance:h,point:Na.clone(),object:e}}function Ua(e,t,r,i,a,n,s,o,l,h){e.getVertexPosition(o,Ca),e.getVertexPosition(l,Ra),e.getVertexPosition(h,Pa);let c=oc(e,t,r,i,Ca,Ra,Pa,Fo);if(c){let u=new z;Wi.getBarycoord(Fo,Ca,Ra,Pa,u),a&&(c.uv=Wi.getInterpolatedAttribute(a,o,l,h,u,new ye)),n&&(c.uv1=Wi.getInterpolatedAttribute(n,o,l,h,u,new ye)),s&&(c.normal=Wi.getInterpolatedAttribute(s,o,l,h,u,new z),c.normal.dot(i.direction)>0&&c.normal.multiplyScalar(-1));let d={a:o,b:l,c:h,normal:new z,materialIndex:0};Wi.getNormal(Ca,Ra,Pa,d.normal),c.face=d,c.barycoord=u}return c}var ys=class Yl extends Gr{constructor(t=1,r=1,i=1,a=1,n=1,s=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:r,depth:i,widthSegments:a,heightSegments:n,depthSegments:s};let o=this;a=Math.floor(a),n=Math.floor(n),s=Math.floor(s);let l=[],h=[],c=[],u=[],d=0,m=0;x("z","y","x",-1,-1,i,r,t,s,n,0),x("z","y","x",1,-1,i,r,-t,s,n,1),x("x","z","y",1,1,t,i,r,a,s,2),x("x","z","y",1,-1,t,i,-r,a,s,3),x("x","y","z",1,-1,t,r,i,a,n,4),x("x","y","z",-1,-1,t,r,-i,a,n,5),this.setIndex(l),this.setAttribute("position",new mr(h,3)),this.setAttribute("normal",new mr(c,3)),this.setAttribute("uv",new mr(u,2));function x(_,f,p,A,S,b,C,L,U,B,M){let y=b/U,R=C/B,q=b/2,W=C/2,k=L/2,ee=U+1,j=B+1,le=0,X=0,ie=new z;for(let Se=0;Se<j;Se++){let Ge=Se*R-W;for(let ze=0;ze<ee;ze++){let it=ze*y-q;ie[_]=it*A,ie[f]=Ge*S,ie[p]=k,h.push(ie.x,ie.y,ie.z),ie[_]=0,ie[f]=0,ie[p]=L>0?1:-1,c.push(ie.x,ie.y,ie.z),u.push(ze/U),u.push(1-Se/B),le+=1}}for(let Se=0;Se<B;Se++)for(let Ge=0;Ge<U;Ge++){let ze=d+Ge+ee*Se,it=d+Ge+ee*(Se+1),tt=d+(Ge+1)+ee*(Se+1),K=d+(Ge+1)+ee*Se;l.push(ze,it,K),l.push(it,tt,K),X+=6}o.addGroup(m,X,M),m+=X,d+=le}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Yl(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}};function _i(e){let t={};for(let r in e){t[r]={};for(let i in e[r]){let a=e[r][i];a&&(a.isColor||a.isMatrix3||a.isMatrix4||a.isVector2||a.isVector3||a.isVector4||a.isTexture||a.isQuaternion)?a.isRenderTargetTexture?(ke("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[r][i]=null):t[r][i]=a.clone():Array.isArray(a)?t[r][i]=a.slice():t[r][i]=a}}return t}function Ct(e){let t={};for(let r=0;r<e.length;r++){let i=_i(e[r]);for(let a in i)t[a]=i[a]}return t}function lc(e){let t=[];for(let r=0;r<e.length;r++)t.push(e[r].clone());return t}function Bo(e){let t=e.getRenderTarget();return t===null?e.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:at.workingColorSpace}var hc={clone:_i,merge:Ct},cc=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,uc=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,gr=class extends mi{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=cc,this.fragmentShader=uc,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=_i(e.uniforms),this.uniformsGroups=lc(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let i in this.uniforms){let a=this.uniforms[i].value;a&&a.isTexture?t.uniforms[i]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[i]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[i]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[i]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[i]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[i]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[i]={type:"m4",value:a.toArray()}:t.uniforms[i]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let r={};for(let i in this.extensions)this.extensions[i]===!0&&(r[i]=!0);return Object.keys(r).length>0&&(t.extensions=r),t}},zo=class extends kt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new ft,this.projectionMatrix=new ft,this.projectionMatrixInverse=new ft,this.coordinateSystem=er,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},Pr=new z,Vo=new ye,ko=new ye,Nt=class extends zo{constructor(e=50,t=1,r=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=r,this.far=i,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=ga*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Kn*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return ga*2*Math.atan(Math.tan(Kn*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,r){Pr.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Pr.x,Pr.y).multiplyScalar(-e/Pr.z),Pr.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),r.set(Pr.x,Pr.y).multiplyScalar(-e/Pr.z)}getViewSize(e,t){return this.getViewBounds(e,Vo,ko),t.subVectors(ko,Vo)}setViewOffset(e,t,r,i,a,n){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=r,this.view.offsetY=i,this.view.width=a,this.view.height=n,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(Kn*.5*this.fov)/this.zoom,r=2*t,i=this.aspect*r,a=-.5*i,n=this.view;if(this.view!==null&&this.view.enabled){let o=n.fullWidth,l=n.fullHeight;a+=n.offsetX*i/o,t-=n.offsetY*r/l,i*=n.width/o,r*=n.height/l}let s=this.filmOffset;s!==0&&(a+=e*s/this.getFilmWidth()),this.projectionMatrix.makePerspective(a,a+i,t,t-r,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},vi=-90,xi=1,dc=class extends kt{constructor(e,t,r){super(),this.type="CubeCamera",this.renderTarget=r,this.coordinateSystem=null,this.activeMipmapLevel=0;let i=new Nt(vi,xi,e,t);i.layers=this.layers,this.add(i);let a=new Nt(vi,xi,e,t);a.layers=this.layers,this.add(a);let n=new Nt(vi,xi,e,t);n.layers=this.layers,this.add(n);let s=new Nt(vi,xi,e,t);s.layers=this.layers,this.add(s);let o=new Nt(vi,xi,e,t);o.layers=this.layers,this.add(o);let l=new Nt(vi,xi,e,t);l.layers=this.layers,this.add(l)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[r,i,a,n,s,o]=t;for(let l of t)this.remove(l);if(e===er)r.up.set(0,1,0),r.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),a.up.set(0,0,-1),a.lookAt(0,1,0),n.up.set(0,0,1),n.lookAt(0,-1,0),s.up.set(0,1,0),s.lookAt(0,0,1),o.up.set(0,1,0),o.lookAt(0,0,-1);else if(e===ma)r.up.set(0,-1,0),r.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),a.up.set(0,0,1),a.lookAt(0,1,0),n.up.set(0,0,-1),n.lookAt(0,-1,0),s.up.set(0,-1,0),s.lookAt(0,0,1),o.up.set(0,-1,0),o.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let l of t)this.add(l),l.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:r,activeMipmapLevel:i}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[a,n,s,o,l,h]=this.children,c=e.getRenderTarget(),u=e.getActiveCubeFace(),d=e.getActiveMipmapLevel(),m=e.xr.enabled;e.xr.enabled=!1;let x=r.texture.generateMipmaps;r.texture.generateMipmaps=!1,e.setRenderTarget(r,0,i),e.render(t,a),e.setRenderTarget(r,1,i),e.render(t,n),e.setRenderTarget(r,2,i),e.render(t,s),e.setRenderTarget(r,3,i),e.render(t,o),e.setRenderTarget(r,4,i),e.render(t,l),r.texture.generateMipmaps=x,e.setRenderTarget(r,5,i),e.render(t,h),e.setRenderTarget(c,u,d),e.xr.enabled=m,r.texture.needsPMREMUpdate=!0}},Go=class extends It{constructor(e=[],t=$r,r,i,a,n,s,o,l,h){super(e,t,r,i,a,n,s,o,l,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},pc=class extends zr{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let r={width:e,height:e,depth:1},i=[r,r,r,r,r,r];this.texture=new Go(i),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let r={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},i=new ys(5,5,5),a=new gr({name:"CubemapFromEquirect",uniforms:_i(r.uniforms),vertexShader:r.vertexShader,fragmentShader:r.fragmentShader,side:Rt,blending:sr});a.uniforms.tEquirect.value=t;let n=new Zt(i,a),s=t.minFilter;return t.minFilter===Tr&&(t.minFilter=St),new dc(1,10,this).update(e,n),t.minFilter=s,n.geometry.dispose(),n.material.dispose(),this}clear(e,t=!0,r=!0,i=!0){let a=e.getRenderTarget();for(let n=0;n<6;n++)e.setRenderTarget(this,n),e.clear(t,r,i);e.setRenderTarget(a)}},Mi=class extends kt{constructor(){super(),this.isGroup=!0,this.type="Group"}},fc={type:"move"},Ss=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Mi,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Mi,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new z,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new z),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Mi,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new z,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new z),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let r of e.hand.values())this._getHandJoint(t,r)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,r){let i=null,a=null,n=null,s=this._targetRay,o=this._grip,l=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(l&&e.hand){n=!0;for(let x of e.hand.values()){let _=t.getJointPose(x,r),f=this._getHandJoint(l,x);_!==null&&(f.matrix.fromArray(_.transform.matrix),f.matrix.decompose(f.position,f.rotation,f.scale),f.matrixWorldNeedsUpdate=!0,f.jointRadius=_.radius),f.visible=_!==null}let h=l.joints["index-finger-tip"],c=l.joints["thumb-tip"],u=h.position.distanceTo(c.position),d=.02,m=.005;l.inputState.pinching&&u>d+m?(l.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!l.inputState.pinching&&u<=d-m&&(l.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else o!==null&&e.gripSpace&&(a=t.getPose(e.gripSpace,r),a!==null&&(o.matrix.fromArray(a.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,a.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(a.linearVelocity)):o.hasLinearVelocity=!1,a.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(a.angularVelocity)):o.hasAngularVelocity=!1));s!==null&&(i=t.getPose(e.targetRaySpace,r),i===null&&a!==null&&(i=a),i!==null&&(s.matrix.fromArray(i.transform.matrix),s.matrix.decompose(s.position,s.rotation,s.scale),s.matrixWorldNeedsUpdate=!0,i.linearVelocity?(s.hasLinearVelocity=!0,s.linearVelocity.copy(i.linearVelocity)):s.hasLinearVelocity=!1,i.angularVelocity?(s.hasAngularVelocity=!0,s.angularVelocity.copy(i.angularVelocity)):s.hasAngularVelocity=!1,this.dispatchEvent(fc)))}return s!==null&&(s.visible=i!==null),o!==null&&(o.visible=a!==null),l!==null&&(l.visible=n!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let r=new Mi;r.matrixAutoUpdate=!1,r.visible=!1,e.joints[t.jointName]=r,e.add(r)}return e.joints[t.jointName]}},mc=class extends kt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new cr,this.environmentIntensity=1,this.environmentRotation=new cr,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}},Ho=class extends It{constructor(e=null,t=1,r=1,i,a,n,s,o,l=Dt,h=Dt,c,u){super(null,n,s,o,l,h,i,a,c,u),this.isDataTexture=!0,this.image={data:e,width:t,height:r},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Ts=new z,gc=new z,_c=new Ze,Wr=class{constructor(e=new z(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,r,i){return this.normal.set(e,t,r),this.constant=i,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,r){let i=Ts.subVectors(r,t).cross(gc.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(i,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){let r=e.delta(Ts),i=this.normal.dot(r);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/i;return a<0||a>1?null:t.copy(e.start).addScaledVector(r,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),r=this.distanceToPoint(e.end);return t<0&&r>0||r<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let r=t||_c.getNormalMatrix(e),i=this.coplanarPoint(Ts).applyMatrix4(e),a=this.normal.applyMatrix3(r).normalize();return this.constant=-i.dot(a),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},Xr=new ns,vc=new ye(.5,.5),Da=new z,Es=class{constructor(e=new Wr,t=new Wr,r=new Wr,i=new Wr,a=new Wr,n=new Wr){this.planes=[e,t,r,i,a,n]}set(e,t,r,i,a,n){let s=this.planes;return s[0].copy(e),s[1].copy(t),s[2].copy(r),s[3].copy(i),s[4].copy(a),s[5].copy(n),this}copy(e){let t=this.planes;for(let r=0;r<6;r++)t[r].copy(e.planes[r]);return this}setFromProjectionMatrix(e,t=er,r=!1){let i=this.planes,a=e.elements,n=a[0],s=a[1],o=a[2],l=a[3],h=a[4],c=a[5],u=a[6],d=a[7],m=a[8],x=a[9],_=a[10],f=a[11],p=a[12],A=a[13],S=a[14],b=a[15];if(i[0].setComponents(l-n,d-h,f-m,b-p).normalize(),i[1].setComponents(l+n,d+h,f+m,b+p).normalize(),i[2].setComponents(l+s,d+c,f+x,b+A).normalize(),i[3].setComponents(l-s,d-c,f-x,b-A).normalize(),r)i[4].setComponents(o,u,_,S).normalize(),i[5].setComponents(l-o,d-u,f-_,b-S).normalize();else if(i[4].setComponents(l-o,d-u,f-_,b-S).normalize(),t===er)i[5].setComponents(l+o,d+u,f+_,b+S).normalize();else if(t===ma)i[5].setComponents(o,u,_,S).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Xr.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Xr.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Xr)}intersectsSprite(e){Xr.center.set(0,0,0);let t=vc.distanceTo(e.center);return Xr.radius=.7071067811865476+t,Xr.applyMatrix4(e.matrixWorld),this.intersectsSphere(Xr)}intersectsSphere(e){let t=this.planes,r=e.center,i=-e.radius;for(let a=0;a<6;a++)if(t[a].distanceToPoint(r)<i)return!1;return!0}intersectsBox(e){let t=this.planes;for(let r=0;r<6;r++){let i=t[r];if(Da.x=i.normal.x>0?e.max.x:e.min.x,Da.y=i.normal.y>0?e.max.y:e.min.y,Da.z=i.normal.z>0?e.max.z:e.min.z,i.distanceToPoint(Da)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let r=0;r<6;r++)if(t[r].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},Wo=class extends It{constructor(e,t,r,i,a,n,s,o,l){super(e,t,r,i,a,n,s,o,l),this.isCanvasTexture=!0,this.needsUpdate=!0}},Xo=class extends It{constructor(e,t,r=Fr,i,a,n,s=Dt,o=Dt,l,h=Ii,c=1){if(h!==Ii&&h!==Oi)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let u={width:e,height:t,depth:c};super(u,i,a,n,s,o,h,r,l),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new es(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},qo=class extends It{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},tr=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){ke("Curve: .getPoint() not implemented.")}getPointAt(e,t){let r=this.getUtoTmapping(e);return this.getPoint(r,t)}getPoints(e=5){let t=[];for(let r=0;r<=e;r++)t.push(this.getPoint(r/e));return t}getSpacedPoints(e=5){let t=[];for(let r=0;r<=e;r++)t.push(this.getPointAt(r/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],r,i=this.getPoint(0),a=0;t.push(0);for(let n=1;n<=e;n++)r=this.getPoint(n/e),a+=r.distanceTo(i),t.push(a),i=r;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){let r=this.getLengths(),i=0,a=r.length,n;t?n=t:n=e*r[a-1];let s=0,o=a-1,l;for(;s<=o;)if(i=Math.floor(s+(o-s)/2),l=r[i]-n,l<0)s=i+1;else if(l>0)o=i-1;else{o=i;break}if(i=o,r[i]===n)return i/(a-1);let h=r[i],c=r[i+1]-h,u=(n-h)/c;return(i+u)/(a-1)}getTangent(e,t){let r=e-1e-4,i=e+1e-4;r<0&&(r=0),i>1&&(i=1);let a=this.getPoint(r),n=this.getPoint(i),s=t||(a.isVector2?new ye:new z);return s.copy(n).sub(a).normalize(),s}getTangentAt(e,t){let r=this.getUtoTmapping(e);return this.getTangent(r,t)}computeFrenetFrames(e,t=!1){let r=new z,i=[],a=[],n=[],s=new z,o=new ft;for(let d=0;d<=e;d++){let m=d/e;i[d]=this.getTangentAt(m,new z)}a[0]=new z,n[0]=new z;let l=Number.MAX_VALUE,h=Math.abs(i[0].x),c=Math.abs(i[0].y),u=Math.abs(i[0].z);h<=l&&(l=h,r.set(1,0,0)),c<=l&&(l=c,r.set(0,1,0)),u<=l&&r.set(0,0,1),s.crossVectors(i[0],r).normalize(),a[0].crossVectors(i[0],s),n[0].crossVectors(i[0],a[0]);for(let d=1;d<=e;d++){if(a[d]=a[d-1].clone(),n[d]=n[d-1].clone(),s.crossVectors(i[d-1],i[d]),s.length()>Number.EPSILON){s.normalize();let m=Math.acos(Ke(i[d-1].dot(i[d]),-1,1));a[d].applyMatrix4(o.makeRotationAxis(s,m))}n[d].crossVectors(i[d],a[d])}if(t===!0){let d=Math.acos(Ke(a[0].dot(a[e]),-1,1));d/=e,i[0].dot(s.crossVectors(a[0],a[e]))>0&&(d=-d);for(let m=1;m<=e;m++)a[m].applyMatrix4(o.makeRotationAxis(i[m],d*m)),n[m].crossVectors(i[m],a[m])}return{tangents:i,normals:a,binormals:n}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},bs=class extends tr{constructor(e=0,t=0,r=1,i=1,a=0,n=Math.PI*2,s=!1,o=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=r,this.yRadius=i,this.aStartAngle=a,this.aEndAngle=n,this.aClockwise=s,this.aRotation=o}getPoint(e,t=new ye){let r=t,i=Math.PI*2,a=this.aEndAngle-this.aStartAngle,n=Math.abs(a)<Number.EPSILON;for(;a<0;)a+=i;for(;a>i;)a-=i;a<Number.EPSILON&&(n?a=0:a=i),this.aClockwise===!0&&!n&&(a===i?a=-i:a=a-i);let s=this.aStartAngle+e*a,o=this.aX+this.xRadius*Math.cos(s),l=this.aY+this.yRadius*Math.sin(s);if(this.aRotation!==0){let h=Math.cos(this.aRotation),c=Math.sin(this.aRotation),u=o-this.aX,d=l-this.aY;o=u*h-d*c+this.aX,l=u*c+d*h+this.aY}return r.set(o,l)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},xc=class extends bs{constructor(e,t,r,i,a,n){super(e,t,r,r,i,a,n),this.isArcCurve=!0,this.type="ArcCurve"}};function ws(){let e=0,t=0,r=0,i=0;function a(n,s,o,l){e=n,t=o,r=-3*n+3*s-2*o-l,i=2*n-2*s+o+l}return{initCatmullRom:function(n,s,o,l,h){a(s,o,h*(o-n),h*(l-s))},initNonuniformCatmullRom:function(n,s,o,l,h,c,u){let d=(s-n)/h-(o-n)/(h+c)+(o-s)/c,m=(o-s)/c-(l-s)/(c+u)+(l-o)/u;d*=c,m*=c,a(s,o,d,m)},calc:function(n){let s=n*n,o=s*n;return e+t*n+r*s+i*o}}}var Ia=new z,As=new ws,Cs=new ws,Rs=new ws,Mc=class extends tr{constructor(e=[],t=!1,r="centripetal",i=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=r,this.tension=i}getPoint(e,t=new z){let r=t,i=this.points,a=i.length,n=(a-(this.closed?0:1))*e,s=Math.floor(n),o=n-s;this.closed?s+=s>0?0:(Math.floor(Math.abs(s)/a)+1)*a:o===0&&s===a-1&&(s=a-2,o=1);let l,h;this.closed||s>0?l=i[(s-1)%a]:(Ia.subVectors(i[0],i[1]).add(i[0]),l=Ia);let c=i[s%a],u=i[(s+1)%a];if(this.closed||s+2<a?h=i[(s+2)%a]:(Ia.subVectors(i[a-1],i[a-2]).add(i[a-1]),h=Ia),this.curveType==="centripetal"||this.curveType==="chordal"){let d=this.curveType==="chordal"?.5:.25,m=Math.pow(l.distanceToSquared(c),d),x=Math.pow(c.distanceToSquared(u),d),_=Math.pow(u.distanceToSquared(h),d);x<1e-4&&(x=1),m<1e-4&&(m=x),_<1e-4&&(_=x),As.initNonuniformCatmullRom(l.x,c.x,u.x,h.x,m,x,_),Cs.initNonuniformCatmullRom(l.y,c.y,u.y,h.y,m,x,_),Rs.initNonuniformCatmullRom(l.z,c.z,u.z,h.z,m,x,_)}else this.curveType==="catmullrom"&&(As.initCatmullRom(l.x,c.x,u.x,h.x,this.tension),Cs.initCatmullRom(l.y,c.y,u.y,h.y,this.tension),Rs.initCatmullRom(l.z,c.z,u.z,h.z,this.tension));return r.set(As.calc(o),Cs.calc(o),Rs.calc(o)),r}copy(e){super.copy(e),this.points=[];for(let t=0,r=e.points.length;t<r;t++){let i=e.points[t];this.points.push(i.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,r=this.points.length;t<r;t++){let i=this.points[t];e.points.push(i.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,r=e.points.length;t<r;t++){let i=e.points[t];this.points.push(new z().fromArray(i))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function jo(e,t,r,i,a){let n=(i-t)*.5,s=(a-r)*.5,o=e*e,l=e*o;return(2*r-2*i+n+s)*l+(-3*r+3*i-2*n-s)*o+n*e+r}function yc(e,t){let r=1-e;return r*r*t}function Sc(e,t){return 2*(1-e)*e*t}function Tc(e,t){return e*e*t}function qi(e,t,r,i){return yc(e,t)+Sc(e,r)+Tc(e,i)}function Ec(e,t){let r=1-e;return r*r*r*t}function bc(e,t){let r=1-e;return 3*r*r*e*t}function wc(e,t){return 3*(1-e)*e*e*t}function Ac(e,t){return e*e*e*t}function ji(e,t,r,i,a){return Ec(e,t)+bc(e,r)+wc(e,i)+Ac(e,a)}var Yo=class extends tr{constructor(e=new ye,t=new ye,r=new ye,i=new ye){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=r,this.v3=i}getPoint(e,t=new ye){let r=t,i=this.v0,a=this.v1,n=this.v2,s=this.v3;return r.set(ji(e,i.x,a.x,n.x,s.x),ji(e,i.y,a.y,n.y,s.y)),r}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Cc=class extends tr{constructor(e=new z,t=new z,r=new z,i=new z){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=r,this.v3=i}getPoint(e,t=new z){let r=t,i=this.v0,a=this.v1,n=this.v2,s=this.v3;return r.set(ji(e,i.x,a.x,n.x,s.x),ji(e,i.y,a.y,n.y,s.y),ji(e,i.z,a.z,n.z,s.z)),r}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Jo=class extends tr{constructor(e=new ye,t=new ye){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new ye){let r=t;return e===1?r.copy(this.v2):(r.copy(this.v2).sub(this.v1),r.multiplyScalar(e).add(this.v1)),r}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new ye){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Rc=class extends tr{constructor(e=new z,t=new z){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new z){let r=t;return e===1?r.copy(this.v2):(r.copy(this.v2).sub(this.v1),r.multiplyScalar(e).add(this.v1)),r}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new z){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ko=class extends tr{constructor(e=new ye,t=new ye,r=new ye){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=r}getPoint(e,t=new ye){let r=t,i=this.v0,a=this.v1,n=this.v2;return r.set(qi(e,i.x,a.x,n.x),qi(e,i.y,a.y,n.y)),r}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Pc=class extends tr{constructor(e=new z,t=new z,r=new z){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=r}getPoint(e,t=new z){let r=t,i=this.v0,a=this.v1,n=this.v2;return r.set(qi(e,i.x,a.x,n.x),qi(e,i.y,a.y,n.y),qi(e,i.z,a.z,n.z)),r}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Zo=class extends tr{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new ye){let r=t,i=this.points,a=(i.length-1)*e,n=Math.floor(a),s=a-n,o=i[n===0?n:n-1],l=i[n],h=i[n>i.length-2?i.length-1:n+1],c=i[n>i.length-3?i.length-1:n+2];return r.set(jo(s,o.x,l.x,h.x,c.x),jo(s,o.y,l.y,h.y,c.y)),r}copy(e){super.copy(e),this.points=[];for(let t=0,r=e.points.length;t<r;t++){let i=e.points[t];this.points.push(i.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,r=this.points.length;t<r;t++){let i=this.points[t];e.points.push(i.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,r=e.points.length;t<r;t++){let i=e.points[t];this.points.push(new ye().fromArray(i))}return this}},Ps=Object.freeze({__proto__:null,ArcCurve:xc,CatmullRomCurve3:Mc,CubicBezierCurve:Yo,CubicBezierCurve3:Cc,EllipseCurve:bs,LineCurve:Jo,LineCurve3:Rc,QuadraticBezierCurve:Ko,QuadraticBezierCurve3:Pc,SplineCurve:Zo}),Lc=class extends tr{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),t=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(t)){let r=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new Ps[r](t,e))}return this}getPoint(e,t){let r=e*this.getLength(),i=this.getCurveLengths(),a=0;for(;a<i.length;){if(i[a]>=r){let n=i[a]-r,s=this.curves[a],o=s.getLength(),l=o===0?0:1-n/o;return s.getPointAt(l,t)}a++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],t=0;for(let r=0,i=this.curves.length;r<i;r++)t+=this.curves[r].getLength(),e.push(t);return this.cacheLengths=e,e}getSpacedPoints(e=40){let t=[];for(let r=0;r<=e;r++)t.push(this.getPoint(r/e));return this.autoClose&&t.push(t[0]),t}getPoints(e=12){let t=[],r;for(let i=0,a=this.curves;i<a.length;i++){let n=a[i],s=n.isEllipseCurve?e*2:n.isLineCurve||n.isLineCurve3?1:n.isSplineCurve?e*n.points.length:e,o=n.getPoints(s);for(let l=0;l<o.length;l++){let h=o[l];r&&r.equals(h)||(t.push(h),r=h)}}return this.autoClose&&t.length>1&&!t[t.length-1].equals(t[0])&&t.push(t[0]),t}copy(e){super.copy(e),this.curves=[];for(let t=0,r=e.curves.length;t<r;t++){let i=e.curves[t];this.curves.push(i.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let t=0,r=this.curves.length;t<r;t++){let i=this.curves[t];e.curves.push(i.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let t=0,r=e.curves.length;t<r;t++){let i=e.curves[t];this.curves.push(new Ps[i.type]().fromJSON(i))}return this}},$o=class extends Lc{constructor(e){super(),this.type="Path",this.currentPoint=new ye,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let t=1,r=e.length;t<r;t++)this.lineTo(e[t].x,e[t].y);return this}moveTo(e,t){return this.currentPoint.set(e,t),this}lineTo(e,t){let r=new Jo(this.currentPoint.clone(),new ye(e,t));return this.curves.push(r),this.currentPoint.set(e,t),this}quadraticCurveTo(e,t,r,i){let a=new Ko(this.currentPoint.clone(),new ye(e,t),new ye(r,i));return this.curves.push(a),this.currentPoint.set(r,i),this}bezierCurveTo(e,t,r,i,a,n){let s=new Yo(this.currentPoint.clone(),new ye(e,t),new ye(r,i),new ye(a,n));return this.curves.push(s),this.currentPoint.set(a,n),this}splineThru(e){let t=[this.currentPoint.clone()].concat(e),r=new Zo(t);return this.curves.push(r),this.currentPoint.copy(e[e.length-1]),this}arc(e,t,r,i,a,n){let s=this.currentPoint.x,o=this.currentPoint.y;return this.absarc(e+s,t+o,r,i,a,n),this}absarc(e,t,r,i,a,n){return this.absellipse(e,t,r,r,i,a,n),this}ellipse(e,t,r,i,a,n,s,o){let l=this.currentPoint.x,h=this.currentPoint.y;return this.absellipse(e+l,t+h,r,i,a,n,s,o),this}absellipse(e,t,r,i,a,n,s,o){let l=new bs(e,t,r,i,a,n,s,o);if(this.curves.length>0){let c=l.getPoint(0);c.equals(this.currentPoint)||this.lineTo(c.x,c.y)}this.curves.push(l);let h=l.getPoint(1);return this.currentPoint.copy(h),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}},Qo=class extends $o{constructor(e){super(e),this.uuid=ii(),this.type="Shape",this.holes=[]}getPointsHoles(e){let t=[];for(let r=0,i=this.holes.length;r<i;r++)t[r]=this.holes[r].getPoints(e);return t}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let t=0,r=e.holes.length;t<r;t++){let i=e.holes[t];this.holes.push(i.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let t=0,r=this.holes.length;t<r;t++){let i=this.holes[t];e.holes.push(i.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let t=0,r=e.holes.length;t<r;t++){let i=e.holes[t];this.holes.push(new $o().fromJSON(i))}return this}};function Nc(e,t,r=2){let i=t&&t.length,a=i?t[0]*r:e.length,n=el(e,0,a,r,!0),s=[];if(!n||n.next===n.prev)return s;let o,l,h;if(i&&(n=Fc(e,t,n,r)),e.length>80*r){o=e[0],l=e[1];let c=o,u=l;for(let d=r;d<a;d+=r){let m=e[d],x=e[d+1];m<o&&(o=m),x<l&&(l=x),m>c&&(c=m),x>u&&(u=x)}h=Math.max(c-o,u-l),h=h!==0?32767/h:0}return Yi(n,s,r,o,l,h,0),s}function el(e,t,r,i,a){let n;if(a===Yc(e,t,r,i)>0)for(let s=t;s<r;s+=i)n=al(s/i|0,e[s],e[s+1],n);else for(let s=r-i;s>=t;s-=i)n=al(s/i|0,e[s],e[s+1],n);return n&&yi(n,n.next)&&(Zi(n),n=n.next),n}function qr(e,t){if(!e)return e;t||(t=e);let r=e,i;do if(i=!1,!r.steiner&&(yi(r,r.next)||ut(r.prev,r,r.next)===0)){if(Zi(r),r=t=r.prev,r===r.next)break;i=!0}else r=r.next;while(i||r!==t);return t}function Yi(e,t,r,i,a,n,s){if(!e)return;!s&&n&&Gc(e,i,a,n);let o=e;for(;e.prev!==e.next;){let l=e.prev,h=e.next;if(n?Dc(e,i,a,n):Uc(e)){t.push(l.i,e.i,h.i),Zi(e),e=h.next,o=h.next;continue}if(e=h,e===o){s?s===1?(e=Ic(qr(e),t),Yi(e,t,r,i,a,n,2)):s===2&&Oc(e,t,r,i,a,n):Yi(qr(e),t,r,i,a,n,1);break}}}function Uc(e){let t=e.prev,r=e,i=e.next;if(ut(t,r,i)>=0)return!1;let a=t.x,n=r.x,s=i.x,o=t.y,l=r.y,h=i.y,c=Math.min(a,n,s),u=Math.min(o,l,h),d=Math.max(a,n,s),m=Math.max(o,l,h),x=i.next;for(;x!==t;){if(x.x>=c&&x.x<=d&&x.y>=u&&x.y<=m&&Ji(a,o,n,l,s,h,x.x,x.y)&&ut(x.prev,x,x.next)>=0)return!1;x=x.next}return!0}function Dc(e,t,r,i){let a=e.prev,n=e,s=e.next;if(ut(a,n,s)>=0)return!1;let o=a.x,l=n.x,h=s.x,c=a.y,u=n.y,d=s.y,m=Math.min(o,l,h),x=Math.min(c,u,d),_=Math.max(o,l,h),f=Math.max(c,u,d),p=Ls(m,x,t,r,i),A=Ls(_,f,t,r,i),S=e.prevZ,b=e.nextZ;for(;S&&S.z>=p&&b&&b.z<=A;){if(S.x>=m&&S.x<=_&&S.y>=x&&S.y<=f&&S!==a&&S!==s&&Ji(o,c,l,u,h,d,S.x,S.y)&&ut(S.prev,S,S.next)>=0||(S=S.prevZ,b.x>=m&&b.x<=_&&b.y>=x&&b.y<=f&&b!==a&&b!==s&&Ji(o,c,l,u,h,d,b.x,b.y)&&ut(b.prev,b,b.next)>=0))return!1;b=b.nextZ}for(;S&&S.z>=p;){if(S.x>=m&&S.x<=_&&S.y>=x&&S.y<=f&&S!==a&&S!==s&&Ji(o,c,l,u,h,d,S.x,S.y)&&ut(S.prev,S,S.next)>=0)return!1;S=S.prevZ}for(;b&&b.z<=A;){if(b.x>=m&&b.x<=_&&b.y>=x&&b.y<=f&&b!==a&&b!==s&&Ji(o,c,l,u,h,d,b.x,b.y)&&ut(b.prev,b,b.next)>=0)return!1;b=b.nextZ}return!0}function Ic(e,t){let r=e;do{let i=r.prev,a=r.next.next;!yi(i,a)&&rl(i,r,r.next,a)&&Ki(i,a)&&Ki(a,i)&&(t.push(i.i,r.i,a.i),Zi(r),Zi(r.next),r=e=a),r=r.next}while(r!==e);return qr(r)}function Oc(e,t,r,i,a,n){let s=e;do{let o=s.next.next;for(;o!==s.prev;){if(s.i!==o.i&&Xc(s,o)){let l=il(s,o);s=qr(s,s.next),l=qr(l,l.next),Yi(s,t,r,i,a,n,0),Yi(l,t,r,i,a,n,0);return}o=o.next}s=s.next}while(s!==e)}function Fc(e,t,r,i){let a=[];for(let n=0,s=t.length;n<s;n++){let o=t[n]*i,l=n<s-1?t[n+1]*i:e.length,h=el(e,o,l,i,!1);h===h.next&&(h.steiner=!0),a.push(Wc(h))}a.sort(Bc);for(let n=0;n<a.length;n++)r=zc(a[n],r);return r}function Bc(e,t){let r=e.x-t.x;if(r===0&&(r=e.y-t.y,r===0)){let i=(e.next.y-e.y)/(e.next.x-e.x),a=(t.next.y-t.y)/(t.next.x-t.x);r=i-a}return r}function zc(e,t){let r=Vc(e,t);if(!r)return t;let i=il(r,e);return qr(i,i.next),qr(r,r.next)}function Vc(e,t){let r=t,i=e.x,a=e.y,n=-1/0,s;if(yi(e,r))return r;do{if(yi(e,r.next))return r.next;if(a<=r.y&&a>=r.next.y&&r.next.y!==r.y){let u=r.x+(a-r.y)*(r.next.x-r.x)/(r.next.y-r.y);if(u<=i&&u>n&&(n=u,s=r.x<r.next.x?r:r.next,u===i))return s}r=r.next}while(r!==t);if(!s)return null;let o=s,l=s.x,h=s.y,c=1/0;r=s;do{if(i>=r.x&&r.x>=l&&i!==r.x&&tl(a<h?i:n,a,l,h,a<h?n:i,a,r.x,r.y)){let u=Math.abs(a-r.y)/(i-r.x);Ki(r,e)&&(u<c||u===c&&(r.x>s.x||r.x===s.x&&kc(s,r)))&&(s=r,c=u)}r=r.next}while(r!==o);return s}function kc(e,t){return ut(e.prev,e,t.prev)<0&&ut(t.next,e,e.next)<0}function Gc(e,t,r,i){let a=e;do a.z===0&&(a.z=Ls(a.x,a.y,t,r,i)),a.prevZ=a.prev,a.nextZ=a.next,a=a.next;while(a!==e);a.prevZ.nextZ=null,a.prevZ=null,Hc(a)}function Hc(e){let t,r=1;do{let i=e,a;e=null;let n=null;for(t=0;i;){t++;let s=i,o=0;for(let h=0;h<r&&(o++,s=s.nextZ,!!s);h++);let l=r;for(;o>0||l>0&&s;)o!==0&&(l===0||!s||i.z<=s.z)?(a=i,i=i.nextZ,o--):(a=s,s=s.nextZ,l--),n?n.nextZ=a:e=a,a.prevZ=n,n=a;i=s}n.nextZ=null,r*=2}while(t>1);return e}function Ls(e,t,r,i,a){return e=(e-r)*a|0,t=(t-i)*a|0,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,e|t<<1}function Wc(e){let t=e,r=e;do(t.x<r.x||t.x===r.x&&t.y<r.y)&&(r=t),t=t.next;while(t!==e);return r}function tl(e,t,r,i,a,n,s,o){return(a-s)*(t-o)>=(e-s)*(n-o)&&(e-s)*(i-o)>=(r-s)*(t-o)&&(r-s)*(n-o)>=(a-s)*(i-o)}function Ji(e,t,r,i,a,n,s,o){return!(e===s&&t===o)&&tl(e,t,r,i,a,n,s,o)}function Xc(e,t){return e.next.i!==t.i&&e.prev.i!==t.i&&!qc(e,t)&&(Ki(e,t)&&Ki(t,e)&&jc(e,t)&&(ut(e.prev,e,t.prev)||ut(e,t.prev,t))||yi(e,t)&&ut(e.prev,e,e.next)>0&&ut(t.prev,t,t.next)>0)}function ut(e,t,r){return(t.y-e.y)*(r.x-t.x)-(t.x-e.x)*(r.y-t.y)}function yi(e,t){return e.x===t.x&&e.y===t.y}function rl(e,t,r,i){let a=Fa(ut(e,t,r)),n=Fa(ut(e,t,i)),s=Fa(ut(r,i,e)),o=Fa(ut(r,i,t));return!!(a!==n&&s!==o||a===0&&Oa(e,r,t)||n===0&&Oa(e,i,t)||s===0&&Oa(r,e,i)||o===0&&Oa(r,t,i))}function Oa(e,t,r){return t.x<=Math.max(e.x,r.x)&&t.x>=Math.min(e.x,r.x)&&t.y<=Math.max(e.y,r.y)&&t.y>=Math.min(e.y,r.y)}function Fa(e){return e>0?1:e<0?-1:0}function qc(e,t){let r=e;do{if(r.i!==e.i&&r.next.i!==e.i&&r.i!==t.i&&r.next.i!==t.i&&rl(r,r.next,e,t))return!0;r=r.next}while(r!==e);return!1}function Ki(e,t){return ut(e.prev,e,e.next)<0?ut(e,t,e.next)>=0&&ut(e,e.prev,t)>=0:ut(e,t,e.prev)<0||ut(e,e.next,t)<0}function jc(e,t){let r=e,i=!1,a=(e.x+t.x)/2,n=(e.y+t.y)/2;do r.y>n!=r.next.y>n&&r.next.y!==r.y&&a<(r.next.x-r.x)*(n-r.y)/(r.next.y-r.y)+r.x&&(i=!i),r=r.next;while(r!==e);return i}function il(e,t){let r=Ns(e.i,e.x,e.y),i=Ns(t.i,t.x,t.y),a=e.next,n=t.prev;return e.next=t,t.prev=e,r.next=a,a.prev=r,i.next=r,r.prev=i,n.next=i,i.prev=n,i}function al(e,t,r,i){let a=Ns(e,t,r);return i?(a.next=i.next,a.prev=i,i.next.prev=a,i.next=a):(a.prev=a,a.next=a),a}function Zi(e){e.next.prev=e.prev,e.prev.next=e.next,e.prevZ&&(e.prevZ.nextZ=e.nextZ),e.nextZ&&(e.nextZ.prevZ=e.prevZ)}function Ns(e,t,r){return{i:e,x:t,y:r,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function Yc(e,t,r,i){let a=0;for(let n=t,s=r-i;n<r;n+=i)a+=(e[s]-e[n])*(e[n+1]+e[s+1]),s=n;return a}var Jc=class{static triangulate(e,t,r=2){return Nc(e,t,r)}},Ba=class Jl{static area(t){let r=t.length,i=0;for(let a=r-1,n=0;n<r;a=n++)i+=t[a].x*t[n].y-t[n].x*t[a].y;return i*.5}static isClockWise(t){return Jl.area(t)<0}static triangulateShape(t,r){let i=[],a=[],n=[];nl(t),sl(i,t);let s=t.length;r.forEach(nl);for(let l=0;l<r.length;l++)a.push(s),s+=r[l].length,sl(i,r[l]);let o=Jc.triangulate(i,a);for(let l=0;l<o.length;l+=3)n.push(o.slice(l,l+3));return n}};function nl(e){let t=e.length;t>2&&e[t-1].equals(e[0])&&e.pop()}function sl(e,t){for(let r=0;r<t.length;r++)e.push(t[r].x),e.push(t[r].y)}var Kc=class Kl extends Gr{constructor(t=new Qo([new ye(.5,.5),new ye(-.5,.5),new ye(-.5,-.5),new ye(.5,-.5)]),r={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:t,options:r},t=Array.isArray(t)?t:[t];let i=this,a=[],n=[];for(let o=0,l=t.length;o<l;o++){let h=t[o];s(h)}this.setAttribute("position",new mr(a,3)),this.setAttribute("uv",new mr(n,2)),this.computeVertexNormals();function s(o){let l=[],h=r.curveSegments!==void 0?r.curveSegments:12,c=r.steps!==void 0?r.steps:1,u=r.depth!==void 0?r.depth:1,d=r.bevelEnabled!==void 0?r.bevelEnabled:!0,m=r.bevelThickness!==void 0?r.bevelThickness:.2,x=r.bevelSize!==void 0?r.bevelSize:m-.1,_=r.bevelOffset!==void 0?r.bevelOffset:0,f=r.bevelSegments!==void 0?r.bevelSegments:3,p=r.extrudePath,A=r.UVGenerator!==void 0?r.UVGenerator:Zc,S,b=!1,C,L,U,B;p&&(S=p.getSpacedPoints(c),b=!0,d=!1,C=p.computeFrenetFrames(c,!1),L=new z,U=new z,B=new z),d||(f=0,m=0,x=0,_=0);let M=o.extractPoints(h),y=M.shape,R=M.holes;if(!Ba.isClockWise(y)){y=y.reverse();for(let Z=0,T=R.length;Z<T;Z++){let de=R[Z];Ba.isClockWise(de)&&(R[Z]=de.reverse())}}function q(Z){let T=10000000000000001e-36,de=Z[0];for(let se=1;se<=Z.length;se++){let me=se%Z.length,oe=Z[me],Ee=oe.x-de.x,ge=oe.y-de.y,Ce=Ee*Ee+ge*ge,We=Math.max(Math.abs(oe.x),Math.abs(oe.y),Math.abs(de.x),Math.abs(de.y)),E=T*We*We;if(Ce<=E){Z.splice(me,1),se--;continue}de=oe}}q(y),R.forEach(q);let W=R.length,k=y;for(let Z=0;Z<W;Z++){let T=R[Z];y=y.concat(T)}function ee(Z,T,de){return T||$e("ExtrudeGeometry: vec does not exist"),Z.clone().addScaledVector(T,de)}let j=y.length;function le(Z,T,de){let se,me,oe,Ee=Z.x-T.x,ge=Z.y-T.y,Ce=de.x-Z.x,We=de.y-Z.y,E=Ee*Ee+ge*ge,v=Ee*We-ge*Ce;if(Math.abs(v)>Number.EPSILON){let F=Math.sqrt(E),Y=Math.sqrt(Ce*Ce+We*We),$=T.x-ge/F,J=T.y+Ee/F,De=de.x-We/Y,_e=de.y+Ce/Y,Re=((De-$)*We-(_e-J)*Ce)/(Ee*We-ge*Ce);se=$+Ee*Re-Z.x,me=J+ge*Re-Z.y;let we=se*se+me*me;if(we<=2)return new ye(se,me);oe=Math.sqrt(we/2)}else{let F=!1;Ee>Number.EPSILON?Ce>Number.EPSILON&&(F=!0):Ee<-Number.EPSILON?Ce<-Number.EPSILON&&(F=!0):Math.sign(ge)===Math.sign(We)&&(F=!0),F?(se=-ge,me=Ee,oe=Math.sqrt(E)):(se=Ee,me=ge,oe=Math.sqrt(E/2))}return new ye(se/oe,me/oe)}let X=[];for(let Z=0,T=k.length,de=T-1,se=Z+1;Z<T;Z++,de++,se++)de===T&&(de=0),se===T&&(se=0),X[Z]=le(k[Z],k[de],k[se]);let ie=[],Se,Ge=X.concat();for(let Z=0,T=W;Z<T;Z++){let de=R[Z];Se=[];for(let se=0,me=de.length,oe=me-1,Ee=se+1;se<me;se++,oe++,Ee++)oe===me&&(oe=0),Ee===me&&(Ee=0),Se[se]=le(de[se],de[oe],de[Ee]);ie.push(Se),Ge=Ge.concat(Se)}let ze;if(f===0)ze=Ba.triangulateShape(k,R);else{let Z=[],T=[];for(let de=0;de<f;de++){let se=de/f,me=m*Math.cos(se*Math.PI/2),oe=x*Math.sin(se*Math.PI/2)+_;for(let Ee=0,ge=k.length;Ee<ge;Ee++){let Ce=ee(k[Ee],X[Ee],oe);be(Ce.x,Ce.y,-me),se===0&&Z.push(Ce)}for(let Ee=0,ge=W;Ee<ge;Ee++){let Ce=R[Ee];Se=ie[Ee];let We=[];for(let E=0,v=Ce.length;E<v;E++){let F=ee(Ce[E],Se[E],oe);be(F.x,F.y,-me),se===0&&We.push(F)}se===0&&T.push(We)}}ze=Ba.triangulateShape(Z,T)}let it=ze.length,tt=x+_;for(let Z=0;Z<j;Z++){let T=d?ee(y[Z],Ge[Z],tt):y[Z];b?(U.copy(C.normals[0]).multiplyScalar(T.x),L.copy(C.binormals[0]).multiplyScalar(T.y),B.copy(S[0]).add(U).add(L),be(B.x,B.y,B.z)):be(T.x,T.y,0)}for(let Z=1;Z<=c;Z++)for(let T=0;T<j;T++){let de=d?ee(y[T],Ge[T],tt):y[T];b?(U.copy(C.normals[Z]).multiplyScalar(de.x),L.copy(C.binormals[Z]).multiplyScalar(de.y),B.copy(S[Z]).add(U).add(L),be(B.x,B.y,B.z)):be(de.x,de.y,u/c*Z)}for(let Z=f-1;Z>=0;Z--){let T=Z/f,de=m*Math.cos(T*Math.PI/2),se=x*Math.sin(T*Math.PI/2)+_;for(let me=0,oe=k.length;me<oe;me++){let Ee=ee(k[me],X[me],se);be(Ee.x,Ee.y,u+de)}for(let me=0,oe=R.length;me<oe;me++){let Ee=R[me];Se=ie[me];for(let ge=0,Ce=Ee.length;ge<Ce;ge++){let We=ee(Ee[ge],Se[ge],se);b?be(We.x,We.y+S[c-1].y,S[c-1].x+de):be(We.x,We.y,u+de)}}}K(),fe();function K(){let Z=a.length/3;if(d){let T=0,de=j*T;for(let se=0;se<it;se++){let me=ze[se];Ve(me[2]+de,me[1]+de,me[0]+de)}T=c+f*2,de=j*T;for(let se=0;se<it;se++){let me=ze[se];Ve(me[0]+de,me[1]+de,me[2]+de)}}else{for(let T=0;T<it;T++){let de=ze[T];Ve(de[2],de[1],de[0])}for(let T=0;T<it;T++){let de=ze[T];Ve(de[0]+j*c,de[1]+j*c,de[2]+j*c)}}i.addGroup(Z,a.length/3-Z,0)}function fe(){let Z=a.length/3,T=0;ce(k,T),T+=k.length;for(let de=0,se=R.length;de<se;de++){let me=R[de];ce(me,T),T+=me.length}i.addGroup(Z,a.length/3-Z,1)}function ce(Z,T){let de=Z.length;for(;--de>=0;){let se=de,me=de-1;me<0&&(me=Z.length-1);for(let oe=0,Ee=c+f*2;oe<Ee;oe++){let ge=j*oe,Ce=j*(oe+1),We=T+se+ge,E=T+me+ge,v=T+me+Ce,F=T+se+Ce;Ae(We,E,v,F)}}}function be(Z,T,de){l.push(Z),l.push(T),l.push(de)}function Ve(Z,T,de){je(Z),je(T),je(de);let se=a.length/3,me=A.generateTopUV(i,a,se-3,se-2,se-1);qe(me[0]),qe(me[1]),qe(me[2])}function Ae(Z,T,de,se){je(Z),je(T),je(se),je(T),je(de),je(se);let me=a.length/3,oe=A.generateSideWallUV(i,a,me-6,me-3,me-2,me-1);qe(oe[0]),qe(oe[1]),qe(oe[3]),qe(oe[1]),qe(oe[2]),qe(oe[3])}function je(Z){a.push(l[Z*3+0]),a.push(l[Z*3+1]),a.push(l[Z*3+2])}function qe(Z){n.push(Z.x),n.push(Z.y)}}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){let t=super.toJSON(),r=this.parameters.shapes,i=this.parameters.options;return $c(r,i,t)}static fromJSON(t,r){let i=[];for(let n=0,s=t.shapes.length;n<s;n++){let o=r[t.shapes[n]];i.push(o)}let a=t.options.extrudePath;return a!==void 0&&(t.options.extrudePath=new Ps[a.type]().fromJSON(a)),new Kl(i,t.options)}},Zc={generateTopUV:function(e,t,r,i,a){let n=t[r*3],s=t[r*3+1],o=t[i*3],l=t[i*3+1],h=t[a*3],c=t[a*3+1];return[new ye(n,s),new ye(o,l),new ye(h,c)]},generateSideWallUV:function(e,t,r,i,a,n){let s=t[r*3],o=t[r*3+1],l=t[r*3+2],h=t[i*3],c=t[i*3+1],u=t[i*3+2],d=t[a*3],m=t[a*3+1],x=t[a*3+2],_=t[n*3],f=t[n*3+1],p=t[n*3+2];return Math.abs(o-c)<Math.abs(s-h)?[new ye(s,1-l),new ye(h,1-u),new ye(d,1-x),new ye(_,1-p)]:[new ye(o,1-l),new ye(c,1-u),new ye(m,1-x),new ye(f,1-p)]}};function $c(e,t,r){if(r.shapes=[],Array.isArray(e))for(let i=0,a=e.length;i<a;i++){let n=e[i];r.shapes.push(n.uuid)}else r.shapes.push(e.uuid);return r.options=Object.assign({},t),t.extrudePath!==void 0&&(r.options.extrudePath=t.extrudePath.toJSON()),r}var Us=class Zl extends Gr{constructor(t=1,r=1,i=1,a=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:r,widthSegments:i,heightSegments:a};let n=t/2,s=r/2,o=Math.floor(i),l=Math.floor(a),h=o+1,c=l+1,u=t/o,d=r/l,m=[],x=[],_=[],f=[];for(let p=0;p<c;p++){let A=p*d-s;for(let S=0;S<h;S++){let b=S*u-n;x.push(b,-A,0),_.push(0,0,1),f.push(S/o),f.push(1-p/l)}}for(let p=0;p<l;p++)for(let A=0;A<o;A++){let S=A+h*p,b=A+h*(p+1),C=A+1+h*(p+1),L=A+1+h*p;m.push(S,b,L),m.push(b,C,L)}this.setIndex(m),this.setAttribute("position",new mr(x,3)),this.setAttribute("normal",new mr(_,3)),this.setAttribute("uv",new mr(f,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Zl(t.width,t.height,t.widthSegments,t.heightSegments)}},Qc=class extends mi{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Qe(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Qe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Jn,this.normalScale=new ye(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new cr,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},eu=class extends Qc{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new ye(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Ke(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Qe(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Qe(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Qe(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}},tu=class extends mi{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Ch,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},ru=class extends mi{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}},iu=class extends mi{constructor(e){super(),this.isMeshMatcapMaterial=!0,this.defines={MATCAP:""},this.type="MeshMatcapMaterial",this.color=new Qe(16777215),this.matcap=null,this.map=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Jn,this.normalScale=new ye(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.alphaMap=null,this.wireframe=!1,this.wireframeLinewidth=1,this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={MATCAP:""},this.color.copy(e.color),this.matcap=e.matcap,this.map=e.map,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.alphaMap=e.alphaMap,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.flatShading=e.flatShading,this.fog=e.fog,this}};function za(e,t){return!e||e.constructor===t?e:typeof t.BYTES_PER_ELEMENT=="number"?new t(e):Array.prototype.slice.call(e)}function au(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}var Va=class{constructor(e,t,r,i){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=i!==void 0?i:new t.constructor(r),this.sampleValues=t,this.valueSize=r,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,r=this._cachedIndex,i=t[r],a=t[r-1];r:{e:{let n;t:{i:if(!(e<i)){for(let s=r+2;;){if(i===void 0){if(e<a)break i;return r=t.length,this._cachedIndex=r,this.copySampleValue_(r-1)}if(r===s)break;if(a=i,i=t[++r],e<i)break e}n=t.length;break t}if(!(e>=a)){let s=t[1];e<s&&(r=2,a=s);for(let o=r-2;;){if(a===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===o)break;if(i=a,a=t[--r-1],e>=a)break e}n=r,r=0;break t}break r}for(;r<n;){let s=r+n>>>1;e<t[s]?n=s:r=s+1}if(i=t[r],a=t[r-1],a===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===void 0)return r=t.length,this._cachedIndex=r,this.copySampleValue_(r-1)}this._cachedIndex=r,this.intervalChanged_(r,a,i)}return this.interpolate_(r,a,e,i)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,r=this.sampleValues,i=this.valueSize,a=e*i;for(let n=0;n!==i;++n)t[n]=r[a+n];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},nu=class extends Va{constructor(e,t,r,i){super(e,t,r,i),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:lo,endingEnd:lo}}intervalChanged_(e,t,r){let i=this.parameterPositions,a=e-2,n=e+1,s=i[a],o=i[n];if(s===void 0)switch(this.getSettings_().endingStart){case ho:a=e,s=2*t-r;break;case co:a=i.length-2,s=t+i[a]-i[a+1];break;default:a=e,s=r}if(o===void 0)switch(this.getSettings_().endingEnd){case ho:n=e,o=2*r-t;break;case co:n=1,o=r+i[1]-i[0];break;default:n=e-1,o=t}let l=(r-t)*.5,h=this.valueSize;this._weightPrev=l/(t-s),this._weightNext=l/(o-r),this._offsetPrev=a*h,this._offsetNext=n*h}interpolate_(e,t,r,i){let a=this.resultBuffer,n=this.sampleValues,s=this.valueSize,o=e*s,l=o-s,h=this._offsetPrev,c=this._offsetNext,u=this._weightPrev,d=this._weightNext,m=(r-t)/(i-t),x=m*m,_=x*m,f=-u*_+2*u*x-u*m,p=(1+u)*_+(-1.5-2*u)*x+(-.5+u)*m+1,A=(-1-d)*_+(1.5+d)*x+.5*m,S=d*_-d*x;for(let b=0;b!==s;++b)a[b]=f*n[h+b]+p*n[l+b]+A*n[o+b]+S*n[c+b];return a}},su=class extends Va{constructor(e,t,r,i){super(e,t,r,i)}interpolate_(e,t,r,i){let a=this.resultBuffer,n=this.sampleValues,s=this.valueSize,o=e*s,l=o-s,h=(r-t)/(i-t),c=1-h;for(let u=0;u!==s;++u)a[u]=n[l+u]*c+n[o+u]*h;return a}},ou=class extends Va{constructor(e,t,r,i){super(e,t,r,i)}interpolate_(e){return this.copySampleValue_(e-1)}},rr=class{constructor(e,t,r,i){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=za(t,this.TimeBufferType),this.values=za(r,this.ValueBufferType),this.setInterpolation(i||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,r;if(t.toJSON!==this.toJSON)r=t.toJSON(e);else{r={name:e.name,times:za(e.times,Array),values:za(e.values,Array)};let i=e.getInterpolation();i!==e.DefaultInterpolation&&(r.interpolation=i)}return r.type=e.ValueTypeName,r}InterpolantFactoryMethodDiscrete(e){return new ou(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new su(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new nu(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case pa:t=this.InterpolantFactoryMethodDiscrete;break;case jn:t=this.InterpolantFactoryMethodLinear;break;case Yn:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){let r="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(r);return ke("KeyframeTrack:",r),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return pa;case this.InterpolantFactoryMethodLinear:return jn;case this.InterpolantFactoryMethodSmooth:return Yn}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let r=0,i=t.length;r!==i;++r)t[r]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let r=0,i=t.length;r!==i;++r)t[r]*=e}return this}trim(e,t){let r=this.times,i=r.length,a=0,n=i-1;for(;a!==i&&r[a]<e;)++a;for(;n!==-1&&r[n]>t;)--n;if(++n,a!==0||n!==i){a>=n&&(n=Math.max(n,1),a=n-1);let s=this.getValueSize();this.times=r.slice(a,n),this.values=this.values.slice(a*s,n*s)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&($e("KeyframeTrack: Invalid value size in track.",this),e=!1);let r=this.times,i=this.values,a=r.length;a===0&&($e("KeyframeTrack: Track is empty.",this),e=!1);let n=null;for(let s=0;s!==a;s++){let o=r[s];if(typeof o=="number"&&isNaN(o)){$e("KeyframeTrack: Time is not a valid number.",this,s,o),e=!1;break}if(n!==null&&n>o){$e("KeyframeTrack: Out of order keys.",this,s,o,n),e=!1;break}n=o}if(i!==void 0&&au(i))for(let s=0,o=i.length;s!==o;++s){let l=i[s];if(isNaN(l)){$e("KeyframeTrack: Value is not a valid number.",this,s,l),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),r=this.getValueSize(),i=this.getInterpolation()===Yn,a=e.length-1,n=1;for(let s=1;s<a;++s){let o=!1,l=e[s],h=e[s+1];if(l!==h&&(s!==1||l!==e[0]))if(i)o=!0;else{let c=s*r,u=c-r,d=c+r;for(let m=0;m!==r;++m){let x=t[c+m];if(x!==t[u+m]||x!==t[d+m]){o=!0;break}}}if(o){if(s!==n){e[n]=e[s];let c=s*r,u=n*r;for(let d=0;d!==r;++d)t[u+d]=t[c+d]}++n}}if(a>0){e[n]=e[a];for(let s=a*r,o=n*r,l=0;l!==r;++l)t[o+l]=t[s+l];++n}return n!==e.length?(this.times=e.slice(0,n),this.values=t.slice(0,n*r)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),r=this.constructor,i=new r(this.name,e,t);return i.createInterpolant=this.createInterpolant,i}};rr.prototype.ValueTypeName="",rr.prototype.TimeBufferType=Float32Array,rr.prototype.ValueBufferType=Float32Array,rr.prototype.DefaultInterpolation=jn;var $i=class extends rr{constructor(e,t,r){super(e,t,r)}};$i.prototype.ValueTypeName="bool",$i.prototype.ValueBufferType=Array,$i.prototype.DefaultInterpolation=pa,$i.prototype.InterpolantFactoryMethodLinear=void 0,$i.prototype.InterpolantFactoryMethodSmooth=void 0;var lu=class extends rr{constructor(e,t,r,i){super(e,t,r,i)}};lu.prototype.ValueTypeName="color";var hu=class extends rr{constructor(e,t,r,i){super(e,t,r,i)}};hu.prototype.ValueTypeName="number";var cu=class extends Va{constructor(e,t,r,i){super(e,t,r,i)}interpolate_(e,t,r,i){let a=this.resultBuffer,n=this.sampleValues,s=this.valueSize,o=(r-t)/(i-t),l=e*s;for(let h=l+s;l!==h;l+=4)ai.slerpFlat(a,0,n,l-s,n,l,o);return a}},ol=class extends rr{constructor(e,t,r,i){super(e,t,r,i)}InterpolantFactoryMethodLinear(e){return new cu(this.times,this.values,this.getValueSize(),e)}};ol.prototype.ValueTypeName="quaternion",ol.prototype.InterpolantFactoryMethodSmooth=void 0;var Qi=class extends rr{constructor(e,t,r){super(e,t,r)}};Qi.prototype.ValueTypeName="string",Qi.prototype.ValueBufferType=Array,Qi.prototype.DefaultInterpolation=pa,Qi.prototype.InterpolantFactoryMethodLinear=void 0,Qi.prototype.InterpolantFactoryMethodSmooth=void 0;var uu=class extends rr{constructor(e,t,r,i){super(e,t,r,i)}};uu.prototype.ValueTypeName="vector";var ea={enabled:!1,files:{},add:function(e,t){this.enabled!==!1&&(this.files[e]=t)},get:function(e){if(this.enabled!==!1)return this.files[e]},remove:function(e){delete this.files[e]},clear:function(){this.files={}}},du=class{constructor(e,t,r){let i=this,a=!1,n=0,s=0,o,l=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=r,this._abortController=null,this.itemStart=function(h){s++,a===!1&&i.onStart!==void 0&&i.onStart(h,n,s),a=!0},this.itemEnd=function(h){n++,i.onProgress!==void 0&&i.onProgress(h,n,s),n===s&&(a=!1,i.onLoad!==void 0&&i.onLoad())},this.itemError=function(h){i.onError!==void 0&&i.onError(h)},this.resolveURL=function(h){return o?o(h):h},this.setURLModifier=function(h){return o=h,this},this.addHandler=function(h,c){return l.push(h,c),this},this.removeHandler=function(h){let c=l.indexOf(h);return c!==-1&&l.splice(c,2),this},this.getHandler=function(h){for(let c=0,u=l.length;c<u;c+=2){let d=l[c],m=l[c+1];if(d.global&&(d.lastIndex=0),d.test(h))return m}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},pu=new du,ta=class{constructor(e){this.manager=e!==void 0?e:pu,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){let r=this;return new Promise(function(i,a){r.load(e,i,t,a)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};ta.DEFAULT_MATERIAL_NAME="__DEFAULT";var _r={},fu=class extends Error{constructor(e,t){super(e),this.response=t}},mu=class extends ta{constructor(e){super(e),this.mimeType="",this.responseType="",this._abortController=new AbortController}load(e,t,r,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let a=ea.get(`file:${e}`);if(a!==void 0)return this.manager.itemStart(e),setTimeout(()=>{t&&t(a),this.manager.itemEnd(e)},0),a;if(_r[e]!==void 0){_r[e].push({onLoad:t,onProgress:r,onError:i});return}_r[e]=[],_r[e].push({onLoad:t,onProgress:r,onError:i});let n=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",signal:typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),s=this.mimeType,o=this.responseType;fetch(n).then(l=>{if(l.status===200||l.status===0){if(l.status===0&&ke("FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||l.body===void 0||l.body.getReader===void 0)return l;let h=_r[e],c=l.body.getReader(),u=l.headers.get("X-File-Size")||l.headers.get("Content-Length"),d=u?parseInt(u):0,m=d!==0,x=0,_=new ReadableStream({start(f){p();function p(){c.read().then(({done:A,value:S})=>{if(A)f.close();else{x+=S.byteLength;let b=new ProgressEvent("progress",{lengthComputable:m,loaded:x,total:d});for(let C=0,L=h.length;C<L;C++){let U=h[C];U.onProgress&&U.onProgress(b)}f.enqueue(S),p()}},A=>{f.error(A)})}}});return new Response(_)}else throw new fu(`fetch for "${l.url}" responded with ${l.status}: ${l.statusText}`,l)}).then(l=>{switch(o){case"arraybuffer":return l.arrayBuffer();case"blob":return l.blob();case"document":return l.text().then(h=>new DOMParser().parseFromString(h,s));case"json":return l.json();default:if(s==="")return l.text();{let h=/charset="?([^;"\s]*)"?/i.exec(s),c=h&&h[1]?h[1].toLowerCase():void 0,u=new TextDecoder(c);return l.arrayBuffer().then(d=>u.decode(d))}}}).then(l=>{ea.add(`file:${e}`,l);let h=_r[e];delete _r[e];for(let c=0,u=h.length;c<u;c++){let d=h[c];d.onLoad&&d.onLoad(l)}}).catch(l=>{let h=_r[e];if(h===void 0)throw this.manager.itemError(e),l;delete _r[e];for(let c=0,u=h.length;c<u;c++){let d=h[c];d.onError&&d.onError(l)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},Si=new WeakMap,gu=class extends ta{constructor(e){super(e)}load(e,t,r,i){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let a=this,n=ea.get(`image:${e}`);if(n!==void 0){if(n.complete===!0)a.manager.itemStart(e),setTimeout(function(){t&&t(n),a.manager.itemEnd(e)},0);else{let c=Si.get(n);c===void 0&&(c=[],Si.set(n,c)),c.push({onLoad:t,onError:i})}return n}let s=Fi("img");function o(){h(),t&&t(this);let c=Si.get(this)||[];for(let u=0;u<c.length;u++){let d=c[u];d.onLoad&&d.onLoad(this)}Si.delete(this),a.manager.itemEnd(e)}function l(c){h(),i&&i(c),ea.remove(`image:${e}`);let u=Si.get(this)||[];for(let d=0;d<u.length;d++){let m=u[d];m.onError&&m.onError(c)}Si.delete(this),a.manager.itemError(e),a.manager.itemEnd(e)}function h(){s.removeEventListener("load",o,!1),s.removeEventListener("error",l,!1)}return s.addEventListener("load",o,!1),s.addEventListener("error",l,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(s.crossOrigin=this.crossOrigin),ea.add(`image:${e}`,s),a.manager.itemStart(e),s.src=e,s}},_u=class extends ta{constructor(e){super(e)}load(e,t,r,i){let a=this,n=new Ho,s=new mu(this.manager);return s.setResponseType("arraybuffer"),s.setRequestHeader(this.requestHeader),s.setPath(this.path),s.setWithCredentials(a.withCredentials),s.load(e,function(o){let l;try{l=a.parse(o)}catch(h){if(i!==void 0)i(h);else{h(h);return}}l.image!==void 0?n.image=l.image:l.data!==void 0&&(n.image.width=l.width,n.image.height=l.height,n.image.data=l.data),n.wrapS=l.wrapS!==void 0?l.wrapS:Xt,n.wrapT=l.wrapT!==void 0?l.wrapT:Xt,n.magFilter=l.magFilter!==void 0?l.magFilter:St,n.minFilter=l.minFilter!==void 0?l.minFilter:St,n.anisotropy=l.anisotropy!==void 0?l.anisotropy:1,l.colorSpace!==void 0&&(n.colorSpace=l.colorSpace),l.flipY!==void 0&&(n.flipY=l.flipY),l.format!==void 0&&(n.format=l.format),l.type!==void 0&&(n.type=l.type),l.mipmaps!==void 0&&(n.mipmaps=l.mipmaps,n.minFilter=Tr),l.mipmapCount===1&&(n.minFilter=St),l.generateMipmaps!==void 0&&(n.generateMipmaps=l.generateMipmaps),n.needsUpdate=!0,t&&t(n,l)},r,i),n}},vu=class extends ta{constructor(e){super(e)}load(e,t,r,i){let a=new It,n=new gu(this.manager);return n.setCrossOrigin(this.crossOrigin),n.setPath(this.path),n.load(e,function(s){a.image=s,a.needsUpdate=!0,t!==void 0&&t(a)},r,i),a}},Ds=class extends kt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Qe(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}},Is=new ft,ll=new z,hl=new z,cl=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new ye(512,512),this.mapType=$t,this.map=null,this.mapPass=null,this.matrix=new ft,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Es,this._frameExtents=new ye(1,1),this._viewportCount=1,this._viewports=[new ct(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,r=this.matrix;ll.setFromMatrixPosition(e.matrixWorld),t.position.copy(ll),hl.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(hl),t.updateMatrixWorld(),Is.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Is,t.coordinateSystem,t.reversedDepth),t.reversedDepth?r.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):r.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),r.multiply(Is)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},xu=class extends cl{constructor(){super(new Nt(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){let t=this.camera,r=ga*2*e.angle*this.focus,i=this.mapSize.width/this.mapSize.height*this.aspect,a=e.distance||t.far;(r!==t.fov||i!==t.aspect||a!==t.far)&&(t.fov=r,t.aspect=i,t.far=a,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}},Mu=class extends Ds{constructor(e,t,r=0,i=Math.PI/3,a=0,n=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(kt.DEFAULT_UP),this.updateMatrix(),this.target=new kt,this.distance=r,this.angle=i,this.penumbra=a,this.decay=n,this.map=null,this.shadow=new xu}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}},ul=new ft,ra=new z,Os=new z,yu=class extends cl{constructor(){super(new Nt(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new ye(4,2),this._viewportCount=6,this._viewports=[new ct(2,1,1,1),new ct(0,1,1,1),new ct(3,1,1,1),new ct(1,1,1,1),new ct(3,0,1,1),new ct(1,0,1,1)],this._cubeDirections=[new z(1,0,0),new z(-1,0,0),new z(0,0,1),new z(0,0,-1),new z(0,1,0),new z(0,-1,0)],this._cubeUps=[new z(0,1,0),new z(0,1,0),new z(0,1,0),new z(0,1,0),new z(0,0,1),new z(0,0,-1)]}updateMatrices(e,t=0){let r=this.camera,i=this.matrix,a=e.distance||r.far;a!==r.far&&(r.far=a,r.updateProjectionMatrix()),ra.setFromMatrixPosition(e.matrixWorld),r.position.copy(ra),Os.copy(r.position),Os.add(this._cubeDirections[t]),r.up.copy(this._cubeUps[t]),r.lookAt(Os),r.updateMatrixWorld(),i.makeTranslation(-ra.x,-ra.y,-ra.z),ul.multiplyMatrices(r.projectionMatrix,r.matrixWorldInverse),this._frustum.setFromProjectionMatrix(ul,r.coordinateSystem,r.reversedDepth)}},Su=class extends Ds{constructor(e,t,r=0,i=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=r,this.decay=i,this.shadow=new yu}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}},Tu=class extends zo{constructor(e=-1,t=1,r=1,i=-1,a=.1,n=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=r,this.bottom=i,this.near=a,this.far=n,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,r,i,a,n){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=r,this.view.offsetY=i,this.view.width=a,this.view.height=n,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),r=(this.right+this.left)/2,i=(this.top+this.bottom)/2,a=r-e,n=r+e,s=i+t,o=i-t;if(this.view!==null&&this.view.enabled){let l=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;a+=l*this.view.offsetX,n=a+l*this.view.width,s-=h*this.view.offsetY,o=s-h*this.view.height}this.projectionMatrix.makeOrthographic(a,n,s,o,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},Eu=class extends Ds{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}},bu=class extends Nt{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}},Fs="\\[\\]\\.:\\/",wu=new RegExp("["+Fs+"]","g"),Bs="[^"+Fs+"]",Au="[^"+Fs.replace("\\.","")+"]",Cu=/((?:WC+[\/:])*)/.source.replace("WC",Bs),Ru=/(WCOD+)?/.source.replace("WCOD",Au),Pu=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Bs),Lu=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Bs),Nu=new RegExp("^"+Cu+Ru+Pu+Lu+"$"),Uu=["material","materials","bones","map"],Du=class{constructor(e,t,r){let i=r||dt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,i)}getValue(e,t){this.bind();let r=this._targetGroup.nCachedObjects_,i=this._bindings[r];i!==void 0&&i.getValue(e,t)}setValue(e,t){let r=this._bindings;for(let i=this._targetGroup.nCachedObjects_,a=r.length;i!==a;++i)r[i].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,r=e.length;t!==r;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,r=e.length;t!==r;++t)e[t].unbind()}},dt=class Li{constructor(t,r,i){this.path=r,this.parsedPath=i||Li.parseTrackName(r),this.node=Li.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,r,i){return t&&t.isAnimationObjectGroup?new Li.Composite(t,r,i):new Li(t,r,i)}static sanitizeNodeName(t){return t.replace(/\s/g,"_").replace(wu,"")}static parseTrackName(t){let r=Nu.exec(t);if(r===null)throw new Error("PropertyBinding: Cannot parse trackName: "+t);let i={nodeName:r[2],objectName:r[3],objectIndex:r[4],propertyName:r[5],propertyIndex:r[6]},a=i.nodeName&&i.nodeName.lastIndexOf(".");if(a!==void 0&&a!==-1){let n=i.nodeName.substring(a+1);Uu.indexOf(n)!==-1&&(i.nodeName=i.nodeName.substring(0,a),i.objectName=n)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+t);return i}static findNode(t,r){if(r===void 0||r===""||r==="."||r===-1||r===t.name||r===t.uuid)return t;if(t.skeleton){let i=t.skeleton.getBoneByName(r);if(i!==void 0)return i}if(t.children){let i=function(n){for(let s=0;s<n.length;s++){let o=n[s];if(o.name===r||o.uuid===r)return o;let l=i(o.children);if(l)return l}return null},a=i(t.children);if(a)return a}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(t,r){t[r]=this.targetObject[this.propertyName]}_getValue_array(t,r){let i=this.resolvedProperty;for(let a=0,n=i.length;a!==n;++a)t[r++]=i[a]}_getValue_arrayElement(t,r){t[r]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(t,r){this.resolvedProperty.toArray(t,r)}_setValue_direct(t,r){this.targetObject[this.propertyName]=t[r]}_setValue_direct_setNeedsUpdate(t,r){this.targetObject[this.propertyName]=t[r],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(t,r){this.targetObject[this.propertyName]=t[r],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(t,r){let i=this.resolvedProperty;for(let a=0,n=i.length;a!==n;++a)i[a]=t[r++]}_setValue_array_setNeedsUpdate(t,r){let i=this.resolvedProperty;for(let a=0,n=i.length;a!==n;++a)i[a]=t[r++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(t,r){let i=this.resolvedProperty;for(let a=0,n=i.length;a!==n;++a)i[a]=t[r++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(t,r){this.resolvedProperty[this.propertyIndex]=t[r]}_setValue_arrayElement_setNeedsUpdate(t,r){this.resolvedProperty[this.propertyIndex]=t[r],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(t,r){this.resolvedProperty[this.propertyIndex]=t[r],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(t,r){this.resolvedProperty.fromArray(t,r)}_setValue_fromArray_setNeedsUpdate(t,r){this.resolvedProperty.fromArray(t,r),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(t,r){this.resolvedProperty.fromArray(t,r),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(t,r){this.bind(),this.getValue(t,r)}_setValue_unbound(t,r){this.bind(),this.setValue(t,r)}bind(){let t=this.node,r=this.parsedPath,i=r.objectName,a=r.propertyName,n=r.propertyIndex;if(t||(t=Li.findNode(this.rootNode,r.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){ke("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let h=r.objectIndex;switch(i){case"materials":if(!t.material){$e("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.materials){$e("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}t=t.material.materials;break;case"bones":if(!t.skeleton){$e("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}t=t.skeleton.bones;for(let c=0;c<t.length;c++)if(t[c].name===h){h=c;break}break;case"map":if("map"in t){t=t.map;break}if(!t.material){$e("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.map){$e("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}t=t.material.map;break;default:if(t[i]===void 0){$e("PropertyBinding: Can not bind to objectName of node undefined.",this);return}t=t[i]}if(h!==void 0){if(t[h]===void 0){$e("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,t);return}t=t[h]}}let s=t[a];if(s===void 0){let h=r.nodeName;$e("PropertyBinding: Trying to update property for track: "+h+"."+a+" but it wasn't found.",t);return}let o=this.Versioning.None;this.targetObject=t,t.isMaterial===!0?o=this.Versioning.NeedsUpdate:t.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(n!==void 0){if(a==="morphTargetInfluences"){if(!t.geometry){$e("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!t.geometry.morphAttributes){$e("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}t.morphTargetDictionary[n]!==void 0&&(n=t.morphTargetDictionary[n])}l=this.BindingType.ArrayElement,this.resolvedProperty=s,this.propertyIndex=n}else s.fromArray!==void 0&&s.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=s):Array.isArray(s)?(l=this.BindingType.EntireArray,this.resolvedProperty=s):this.propertyName=a;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};dt.Composite=Du,dt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3},dt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2},dt.prototype.GetterByBindingType=[dt.prototype._getValue_direct,dt.prototype._getValue_array,dt.prototype._getValue_arrayElement,dt.prototype._getValue_toArray],dt.prototype.SetterByBindingTypeAndVersioning=[[dt.prototype._setValue_direct,dt.prototype._setValue_direct_setNeedsUpdate,dt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[dt.prototype._setValue_array,dt.prototype._setValue_array_setNeedsUpdate,dt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[dt.prototype._setValue_arrayElement,dt.prototype._setValue_arrayElement_setNeedsUpdate,dt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[dt.prototype._setValue_fromArray,dt.prototype._setValue_fromArray_setNeedsUpdate,dt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var wg=new Float32Array(1);function dl(e,t,r,i){let a=Iu(i);switch(r){case no:return e*t;case oo:return e*t/a.components*a.byteLength;case mn:return e*t/a.components*a.byteLength;case gn:return e*t*2/a.components*a.byteLength;case _n:return e*t*2/a.components*a.byteLength;case so:return e*t*3/a.components*a.byteLength;case qt:return e*t*4/a.components*a.byteLength;case vn:return e*t*4/a.components*a.byteLength;case ha:case ca:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case ua:case da:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case Mn:case Sn:return Math.max(e,16)*Math.max(t,8)/4;case xn:case yn:return Math.max(e,8)*Math.max(t,8)/2;case Tn:case En:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case bn:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case wn:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case An:return Math.floor((e+4)/5)*Math.floor((t+3)/4)*16;case Cn:return Math.floor((e+4)/5)*Math.floor((t+4)/5)*16;case Rn:return Math.floor((e+5)/6)*Math.floor((t+4)/5)*16;case Pn:return Math.floor((e+5)/6)*Math.floor((t+5)/6)*16;case Ln:return Math.floor((e+7)/8)*Math.floor((t+4)/5)*16;case Nn:return Math.floor((e+7)/8)*Math.floor((t+5)/6)*16;case Un:return Math.floor((e+7)/8)*Math.floor((t+7)/8)*16;case Dn:return Math.floor((e+9)/10)*Math.floor((t+4)/5)*16;case In:return Math.floor((e+9)/10)*Math.floor((t+5)/6)*16;case On:return Math.floor((e+9)/10)*Math.floor((t+7)/8)*16;case Fn:return Math.floor((e+9)/10)*Math.floor((t+9)/10)*16;case Bn:return Math.floor((e+11)/12)*Math.floor((t+9)/10)*16;case zn:return Math.floor((e+11)/12)*Math.floor((t+11)/12)*16;case Vn:case kn:case Gn:return Math.ceil(e/4)*Math.ceil(t/4)*16;case Hn:case Wn:return Math.ceil(e/4)*Math.ceil(t/4)*8;case Xn:case qn:return Math.ceil(e/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${r} format.`)}function Iu(e){switch(e){case $t:case to:return{byteLength:1,components:1};case Ui:case ro:case Qt:return{byteLength:2,components:1};case pn:case fn:return{byteLength:2,components:4};case Fr:case dn:case Vt:return{byteLength:4,components:1};case io:case ao:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${e}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"181"}})),typeof window<"u"&&(window.__THREE__?ke("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="181");function pl(){let e=null,t=!1,r=null,i=null;function a(n,s){r(n,s),i=e.requestAnimationFrame(a)}return{start:function(){t!==!0&&r!==null&&(i=e.requestAnimationFrame(a),t=!0)},stop:function(){e.cancelAnimationFrame(i),t=!1},setAnimationLoop:function(n){r=n},setContext:function(n){e=n}}}function Ou(e){let t=new WeakMap;function r(o,l){let h=o.array,c=o.usage,u=h.byteLength,d=e.createBuffer();e.bindBuffer(l,d),e.bufferData(l,h,c),o.onUploadCallback();let m;if(h instanceof Float32Array)m=e.FLOAT;else if(typeof Float16Array<"u"&&h instanceof Float16Array)m=e.HALF_FLOAT;else if(h instanceof Uint16Array)o.isFloat16BufferAttribute?m=e.HALF_FLOAT:m=e.UNSIGNED_SHORT;else if(h instanceof Int16Array)m=e.SHORT;else if(h instanceof Uint32Array)m=e.UNSIGNED_INT;else if(h instanceof Int32Array)m=e.INT;else if(h instanceof Int8Array)m=e.BYTE;else if(h instanceof Uint8Array)m=e.UNSIGNED_BYTE;else if(h instanceof Uint8ClampedArray)m=e.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+h);return{buffer:d,type:m,bytesPerElement:h.BYTES_PER_ELEMENT,version:o.version,size:u}}function i(o,l,h){let c=l.array,u=l.updateRanges;if(e.bindBuffer(h,o),u.length===0)e.bufferSubData(h,0,c);else{u.sort((m,x)=>m.start-x.start);let d=0;for(let m=1;m<u.length;m++){let x=u[d],_=u[m];_.start<=x.start+x.count+1?x.count=Math.max(x.count,_.start+_.count-x.start):(++d,u[d]=_)}u.length=d+1;for(let m=0,x=u.length;m<x;m++){let _=u[m];e.bufferSubData(h,_.start*c.BYTES_PER_ELEMENT,c,_.start,_.count)}l.clearUpdateRanges()}l.onUploadCallback()}function a(o){return o.isInterleavedBufferAttribute&&(o=o.data),t.get(o)}function n(o){o.isInterleavedBufferAttribute&&(o=o.data);let l=t.get(o);l&&(e.deleteBuffer(l.buffer),t.delete(o))}function s(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let c=t.get(o);(!c||c.version<o.version)&&t.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let h=t.get(o);if(h===void 0)t.set(o,r(o,l));else if(h.version<o.version){if(h.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(h.buffer,o,l),h.version=o.version}}return{get:a,remove:n,update:s}}var Fu=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Bu=`#ifdef USE_ALPHAHASH
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
#endif`,zu=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Vu=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,ku=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Gu=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Hu=`#ifdef USE_AOMAP
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
#endif`,Wu=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Xu=`#ifdef USE_BATCHING
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
#endif`,qu=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,ju=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Yu=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Ju=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,Ku=`#ifdef USE_IRIDESCENCE
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
#endif`,Zu=`#ifdef USE_BUMPMAP
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
#endif`,$u=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,Qu=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,ed=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,td=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,rd=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,id=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,ad=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,nd=`#if defined( USE_COLOR_ALPHA )
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
#endif`,sd=`#define PI 3.141592653589793
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
} // validated`,od=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,ld=`vec3 transformedNormal = objectNormal;
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
#endif`,hd=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,cd=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,ud=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,dd=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,pd="gl_FragColor = linearToOutputTexel( gl_FragColor );",fd=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,md=`#ifdef USE_ENVMAP
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
#endif`,gd=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,_d=`#ifdef USE_ENVMAP
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
#endif`,vd=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,xd=`#ifdef USE_ENVMAP
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
#endif`,Md=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,yd=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Sd=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Td=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Ed=`#ifdef USE_GRADIENTMAP
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
}`,bd=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,wd=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Ad=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Cd=`uniform bool receiveShadow;
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
#endif`,Rd=`#ifdef USE_ENVMAP
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
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
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
#endif`,Pd=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Ld=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Nd=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Ud=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Dd=`PhysicalMaterial material;
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
#endif`,Id=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
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
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
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
	vec2 uv = vec2( roughness, dotNV );
	return texture2D( dfgLUT, uv ).rg;
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
vec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 dfgV = DFGApprox( vec3(0.0, 0.0, 1.0), vec3(sqrt(1.0 - dotNV * dotNV), 0.0, dotNV), material.roughness );
	vec2 dfgL = DFGApprox( vec3(0.0, 0.0, 1.0), vec3(sqrt(1.0 - dotNL * dotNL), 0.0, dotNL), material.roughness );
	vec3 FssEss_V = material.specularColor * dfgV.x + material.specularF90 * dfgV.y;
	vec3 FssEss_L = material.specularColor * dfgL.x + material.specularF90 * dfgL.y;
	float Ess_V = dfgV.x + dfgV.y;
	float Ess_L = dfgL.x + dfgL.y;
	float Ems_V = 1.0 - Ess_V;
	float Ems_L = 1.0 - Ess_L;
	vec3 Favg = material.specularColor + ( 1.0 - material.specularColor ) * 0.047619;
	vec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg * Favg + EPSILON );
	float compensationFactor = Ems_V * Ems_L;
	vec3 multiScatter = Fms * compensationFactor;
	return singleScatter + multiScatter;
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
	reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
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
}`,Od=`
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
#endif`,Fd=`#if defined( RE_IndirectDiffuse )
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
#endif`,Bd=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,zd=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Vd=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,kd=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Gd=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Hd=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Wd=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Xd=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,qd=`#if defined( USE_POINTS_UV )
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
#endif`,jd=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Yd=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Jd=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Kd=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Zd=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,$d=`#ifdef USE_MORPHTARGETS
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
#endif`,Qd=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,ep=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,tp=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,rp=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,ip=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,ap=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,np=`#ifdef USE_NORMALMAP
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
#endif`,sp=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,op=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,lp=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,hp=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,cp=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,up=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,dp=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,pp=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,fp=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,mp=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,gp=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,_p=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,vp=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,xp=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Mp=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,yp=`float getShadowMask() {
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
}`,Sp=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Tp=`#ifdef USE_SKINNING
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
#endif`,Ep=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,bp=`#ifdef USE_SKINNING
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
#endif`,wp=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Ap=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Cp=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Rp=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Pp=`#ifdef USE_TRANSMISSION
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
#endif`,Lp=`#ifdef USE_TRANSMISSION
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
#endif`,Np=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Up=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Dp=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Ip=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,Op=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Fp=`uniform sampler2D t2D;
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
}`,Bp=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,zp=`#ifdef ENVMAP_TYPE_CUBE
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
}`,Vp=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,kp=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Gp=`#include <common>
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
}`,Hp=`#if DEPTH_PACKING == 3200
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
}`,Wp=`#define DISTANCE
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
}`,Xp=`#define DISTANCE
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
}`,qp=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,jp=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Yp=`uniform float scale;
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
}`,Jp=`uniform vec3 diffuse;
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
}`,Kp=`#include <common>
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
}`,Zp=`uniform vec3 diffuse;
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
}`,$p=`#define LAMBERT
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
}`,Qp=`#define LAMBERT
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
}`,ef=`#define MATCAP
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
}`,tf=`#define MATCAP
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
}`,rf=`#define NORMAL
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
}`,af=`#define NORMAL
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
}`,nf=`#define PHONG
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
}`,sf=`#define PHONG
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
}`,of=`#define STANDARD
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
}`,lf=`#define STANDARD
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
}`,hf=`#define TOON
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
}`,cf=`#define TOON
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
}`,uf=`uniform float size;
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
}`,df=`uniform vec3 diffuse;
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
}`,pf=`#include <common>
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
}`,ff=`uniform vec3 color;
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
}`,mf=`uniform float rotation;
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
}`,gf=`uniform vec3 diffuse;
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
}`,Je={alphahash_fragment:Fu,alphahash_pars_fragment:Bu,alphamap_fragment:zu,alphamap_pars_fragment:Vu,alphatest_fragment:ku,alphatest_pars_fragment:Gu,aomap_fragment:Hu,aomap_pars_fragment:Wu,batching_pars_vertex:Xu,batching_vertex:qu,begin_vertex:ju,beginnormal_vertex:Yu,bsdfs:Ju,iridescence_fragment:Ku,bumpmap_pars_fragment:Zu,clipping_planes_fragment:$u,clipping_planes_pars_fragment:Qu,clipping_planes_pars_vertex:ed,clipping_planes_vertex:td,color_fragment:rd,color_pars_fragment:id,color_pars_vertex:ad,color_vertex:nd,common:sd,cube_uv_reflection_fragment:od,defaultnormal_vertex:ld,displacementmap_pars_vertex:hd,displacementmap_vertex:cd,emissivemap_fragment:ud,emissivemap_pars_fragment:dd,colorspace_fragment:pd,colorspace_pars_fragment:fd,envmap_fragment:md,envmap_common_pars_fragment:gd,envmap_pars_fragment:_d,envmap_pars_vertex:vd,envmap_physical_pars_fragment:Rd,envmap_vertex:xd,fog_vertex:Md,fog_pars_vertex:yd,fog_fragment:Sd,fog_pars_fragment:Td,gradientmap_pars_fragment:Ed,lightmap_pars_fragment:bd,lights_lambert_fragment:wd,lights_lambert_pars_fragment:Ad,lights_pars_begin:Cd,lights_toon_fragment:Pd,lights_toon_pars_fragment:Ld,lights_phong_fragment:Nd,lights_phong_pars_fragment:Ud,lights_physical_fragment:Dd,lights_physical_pars_fragment:Id,lights_fragment_begin:Od,lights_fragment_maps:Fd,lights_fragment_end:Bd,logdepthbuf_fragment:zd,logdepthbuf_pars_fragment:Vd,logdepthbuf_pars_vertex:kd,logdepthbuf_vertex:Gd,map_fragment:Hd,map_pars_fragment:Wd,map_particle_fragment:Xd,map_particle_pars_fragment:qd,metalnessmap_fragment:jd,metalnessmap_pars_fragment:Yd,morphinstance_vertex:Jd,morphcolor_vertex:Kd,morphnormal_vertex:Zd,morphtarget_pars_vertex:$d,morphtarget_vertex:Qd,normal_fragment_begin:ep,normal_fragment_maps:tp,normal_pars_fragment:rp,normal_pars_vertex:ip,normal_vertex:ap,normalmap_pars_fragment:np,clearcoat_normal_fragment_begin:sp,clearcoat_normal_fragment_maps:op,clearcoat_pars_fragment:lp,iridescence_pars_fragment:hp,opaque_fragment:cp,packing:up,premultiplied_alpha_fragment:dp,project_vertex:pp,dithering_fragment:fp,dithering_pars_fragment:mp,roughnessmap_fragment:gp,roughnessmap_pars_fragment:_p,shadowmap_pars_fragment:vp,shadowmap_pars_vertex:xp,shadowmap_vertex:Mp,shadowmask_pars_fragment:yp,skinbase_vertex:Sp,skinning_pars_vertex:Tp,skinning_vertex:Ep,skinnormal_vertex:bp,specularmap_fragment:wp,specularmap_pars_fragment:Ap,tonemapping_fragment:Cp,tonemapping_pars_fragment:Rp,transmission_fragment:Pp,transmission_pars_fragment:Lp,uv_pars_fragment:Np,uv_pars_vertex:Up,uv_vertex:Dp,worldpos_vertex:Ip,background_vert:Op,background_frag:Fp,backgroundCube_vert:Bp,backgroundCube_frag:zp,cube_vert:Vp,cube_frag:kp,depth_vert:Gp,depth_frag:Hp,distanceRGBA_vert:Wp,distanceRGBA_frag:Xp,equirect_vert:qp,equirect_frag:jp,linedashed_vert:Yp,linedashed_frag:Jp,meshbasic_vert:Kp,meshbasic_frag:Zp,meshlambert_vert:$p,meshlambert_frag:Qp,meshmatcap_vert:ef,meshmatcap_frag:tf,meshnormal_vert:rf,meshnormal_frag:af,meshphong_vert:nf,meshphong_frag:sf,meshphysical_vert:of,meshphysical_frag:lf,meshtoon_vert:hf,meshtoon_frag:cf,points_vert:uf,points_frag:df,shadow_vert:pf,shadow_frag:ff,sprite_vert:mf,sprite_frag:gf},Me={common:{diffuse:{value:new Qe(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ze},alphaMap:{value:null},alphaMapTransform:{value:new Ze},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ze}},envmap:{envMap:{value:null},envMapRotation:{value:new Ze},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ze}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ze}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ze},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ze},normalScale:{value:new ye(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ze},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ze}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ze}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ze}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Qe(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Qe(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ze},alphaTest:{value:0},uvTransform:{value:new Ze}},sprite:{diffuse:{value:new Qe(16777215)},opacity:{value:1},center:{value:new ye(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ze},alphaMap:{value:null},alphaMapTransform:{value:new Ze},alphaTest:{value:0}}},ir={basic:{uniforms:Ct([Me.common,Me.specularmap,Me.envmap,Me.aomap,Me.lightmap,Me.fog]),vertexShader:Je.meshbasic_vert,fragmentShader:Je.meshbasic_frag},lambert:{uniforms:Ct([Me.common,Me.specularmap,Me.envmap,Me.aomap,Me.lightmap,Me.emissivemap,Me.bumpmap,Me.normalmap,Me.displacementmap,Me.fog,Me.lights,{emissive:{value:new Qe(0)}}]),vertexShader:Je.meshlambert_vert,fragmentShader:Je.meshlambert_frag},phong:{uniforms:Ct([Me.common,Me.specularmap,Me.envmap,Me.aomap,Me.lightmap,Me.emissivemap,Me.bumpmap,Me.normalmap,Me.displacementmap,Me.fog,Me.lights,{emissive:{value:new Qe(0)},specular:{value:new Qe(1118481)},shininess:{value:30}}]),vertexShader:Je.meshphong_vert,fragmentShader:Je.meshphong_frag},standard:{uniforms:Ct([Me.common,Me.envmap,Me.aomap,Me.lightmap,Me.emissivemap,Me.bumpmap,Me.normalmap,Me.displacementmap,Me.roughnessmap,Me.metalnessmap,Me.fog,Me.lights,{emissive:{value:new Qe(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Je.meshphysical_vert,fragmentShader:Je.meshphysical_frag},toon:{uniforms:Ct([Me.common,Me.aomap,Me.lightmap,Me.emissivemap,Me.bumpmap,Me.normalmap,Me.displacementmap,Me.gradientmap,Me.fog,Me.lights,{emissive:{value:new Qe(0)}}]),vertexShader:Je.meshtoon_vert,fragmentShader:Je.meshtoon_frag},matcap:{uniforms:Ct([Me.common,Me.bumpmap,Me.normalmap,Me.displacementmap,Me.fog,{matcap:{value:null}}]),vertexShader:Je.meshmatcap_vert,fragmentShader:Je.meshmatcap_frag},points:{uniforms:Ct([Me.points,Me.fog]),vertexShader:Je.points_vert,fragmentShader:Je.points_frag},dashed:{uniforms:Ct([Me.common,Me.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Je.linedashed_vert,fragmentShader:Je.linedashed_frag},depth:{uniforms:Ct([Me.common,Me.displacementmap]),vertexShader:Je.depth_vert,fragmentShader:Je.depth_frag},normal:{uniforms:Ct([Me.common,Me.bumpmap,Me.normalmap,Me.displacementmap,{opacity:{value:1}}]),vertexShader:Je.meshnormal_vert,fragmentShader:Je.meshnormal_frag},sprite:{uniforms:Ct([Me.sprite,Me.fog]),vertexShader:Je.sprite_vert,fragmentShader:Je.sprite_frag},background:{uniforms:{uvTransform:{value:new Ze},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Je.background_vert,fragmentShader:Je.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ze}},vertexShader:Je.backgroundCube_vert,fragmentShader:Je.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Je.cube_vert,fragmentShader:Je.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Je.equirect_vert,fragmentShader:Je.equirect_frag},distanceRGBA:{uniforms:Ct([Me.common,Me.displacementmap,{referencePosition:{value:new z},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Je.distanceRGBA_vert,fragmentShader:Je.distanceRGBA_frag},shadow:{uniforms:Ct([Me.lights,Me.fog,{color:{value:new Qe(0)},opacity:{value:1}}]),vertexShader:Je.shadow_vert,fragmentShader:Je.shadow_frag}};ir.physical={uniforms:Ct([ir.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ze},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ze},clearcoatNormalScale:{value:new ye(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ze},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ze},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ze},sheen:{value:0},sheenColor:{value:new Qe(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ze},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ze},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ze},transmissionSamplerSize:{value:new ye},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ze},attenuationDistance:{value:0},attenuationColor:{value:new Qe(0)},specularColor:{value:new Qe(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ze},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ze},anisotropyVector:{value:new ye},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ze}}]),vertexShader:Je.meshphysical_vert,fragmentShader:Je.meshphysical_frag};var ka={r:0,b:0,g:0},jr=new cr,_f=new ft;function vf(e,t,r,i,a,n,s){let o=new Qe(0),l=n===!0?0:1,h,c,u=null,d=0,m=null;function x(S){let b=S.isScene===!0?S.background:null;return b&&b.isTexture&&(b=(S.backgroundBlurriness>0?r:t).get(b)),b}function _(S){let b=!1,C=x(S);C===null?p(o,l):C&&C.isColor&&(p(C,1),b=!0);let L=e.xr.getEnvironmentBlendMode();L==="additive"?i.buffers.color.setClear(0,0,0,1,s):L==="alpha-blend"&&i.buffers.color.setClear(0,0,0,0,s),(e.autoClear||b)&&(i.buffers.depth.setTest(!0),i.buffers.depth.setMask(!0),i.buffers.color.setMask(!0),e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil))}function f(S,b){let C=x(b);C&&(C.isCubeTexture||C.mapping===oa)?(c===void 0&&(c=new Zt(new ys(1,1,1),new gr({name:"BackgroundCubeMaterial",uniforms:_i(ir.backgroundCube.uniforms),vertexShader:ir.backgroundCube.vertexShader,fragmentShader:ir.backgroundCube.fragmentShader,side:Rt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(L,U,B){this.matrixWorld.copyPosition(B.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),a.update(c)),jr.copy(b.backgroundRotation),jr.x*=-1,jr.y*=-1,jr.z*=-1,C.isCubeTexture&&C.isRenderTargetTexture===!1&&(jr.y*=-1,jr.z*=-1),c.material.uniforms.envMap.value=C,c.material.uniforms.flipEnvMap.value=C.isCubeTexture&&C.isRenderTargetTexture===!1?-1:1,c.material.uniforms.backgroundBlurriness.value=b.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=b.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(_f.makeRotationFromEuler(jr)),c.material.toneMapped=at.getTransfer(C.colorSpace)!==lt,(u!==C||d!==C.version||m!==e.toneMapping)&&(c.material.needsUpdate=!0,u=C,d=C.version,m=e.toneMapping),c.layers.enableAll(),S.unshift(c,c.geometry,c.material,0,0,null)):C&&C.isTexture&&(h===void 0&&(h=new Zt(new Us(2,2),new gr({name:"BackgroundMaterial",uniforms:_i(ir.background.uniforms),vertexShader:ir.background.vertexShader,fragmentShader:ir.background.fragmentShader,side:yr,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),h.geometry.deleteAttribute("normal"),Object.defineProperty(h.material,"map",{get:function(){return this.uniforms.t2D.value}}),a.update(h)),h.material.uniforms.t2D.value=C,h.material.uniforms.backgroundIntensity.value=b.backgroundIntensity,h.material.toneMapped=at.getTransfer(C.colorSpace)!==lt,C.matrixAutoUpdate===!0&&C.updateMatrix(),h.material.uniforms.uvTransform.value.copy(C.matrix),(u!==C||d!==C.version||m!==e.toneMapping)&&(h.material.needsUpdate=!0,u=C,d=C.version,m=e.toneMapping),h.layers.enableAll(),S.unshift(h,h.geometry,h.material,0,0,null))}function p(S,b){S.getRGB(ka,Bo(e)),i.buffers.color.setClear(ka.r,ka.g,ka.b,b,s)}function A(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),h!==void 0&&(h.geometry.dispose(),h.material.dispose(),h=void 0)}return{getClearColor:function(){return o},setClearColor:function(S,b=1){o.set(S),l=b,p(o,l)},getClearAlpha:function(){return l},setClearAlpha:function(S){l=S,p(o,l)},render:_,addToRenderList:f,dispose:A}}function xf(e,t){let r=e.getParameter(e.MAX_VERTEX_ATTRIBS),i={},a=d(null),n=a,s=!1;function o(y,R,q,W,k){let ee=!1,j=u(W,q,R);n!==j&&(n=j,h(n.object)),ee=m(y,W,q,k),ee&&x(y,W,q,k),k!==null&&t.update(k,e.ELEMENT_ARRAY_BUFFER),(ee||s)&&(s=!1,b(y,R,q,W),k!==null&&e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,t.get(k).buffer))}function l(){return e.createVertexArray()}function h(y){return e.bindVertexArray(y)}function c(y){return e.deleteVertexArray(y)}function u(y,R,q){let W=q.wireframe===!0,k=i[y.id];k===void 0&&(k={},i[y.id]=k);let ee=k[R.id];ee===void 0&&(ee={},k[R.id]=ee);let j=ee[W];return j===void 0&&(j=d(l()),ee[W]=j),j}function d(y){let R=[],q=[],W=[];for(let k=0;k<r;k++)R[k]=0,q[k]=0,W[k]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:R,enabledAttributes:q,attributeDivisors:W,object:y,attributes:{},index:null}}function m(y,R,q,W){let k=n.attributes,ee=R.attributes,j=0,le=q.getAttributes();for(let X in le)if(le[X].location>=0){let ie=k[X],Se=ee[X];if(Se===void 0&&(X==="instanceMatrix"&&y.instanceMatrix&&(Se=y.instanceMatrix),X==="instanceColor"&&y.instanceColor&&(Se=y.instanceColor)),ie===void 0||ie.attribute!==Se||Se&&ie.data!==Se.data)return!0;j++}return n.attributesNum!==j||n.index!==W}function x(y,R,q,W){let k={},ee=R.attributes,j=0,le=q.getAttributes();for(let X in le)if(le[X].location>=0){let ie=ee[X];ie===void 0&&(X==="instanceMatrix"&&y.instanceMatrix&&(ie=y.instanceMatrix),X==="instanceColor"&&y.instanceColor&&(ie=y.instanceColor));let Se={};Se.attribute=ie,ie&&ie.data&&(Se.data=ie.data),k[X]=Se,j++}n.attributes=k,n.attributesNum=j,n.index=W}function _(){let y=n.newAttributes;for(let R=0,q=y.length;R<q;R++)y[R]=0}function f(y){p(y,0)}function p(y,R){let q=n.newAttributes,W=n.enabledAttributes,k=n.attributeDivisors;q[y]=1,W[y]===0&&(e.enableVertexAttribArray(y),W[y]=1),k[y]!==R&&(e.vertexAttribDivisor(y,R),k[y]=R)}function A(){let y=n.newAttributes,R=n.enabledAttributes;for(let q=0,W=R.length;q<W;q++)R[q]!==y[q]&&(e.disableVertexAttribArray(q),R[q]=0)}function S(y,R,q,W,k,ee,j){j===!0?e.vertexAttribIPointer(y,R,q,k,ee):e.vertexAttribPointer(y,R,q,W,k,ee)}function b(y,R,q,W){_();let k=W.attributes,ee=q.getAttributes(),j=R.defaultAttributeValues;for(let le in ee){let X=ee[le];if(X.location>=0){let ie=k[le];if(ie===void 0&&(le==="instanceMatrix"&&y.instanceMatrix&&(ie=y.instanceMatrix),le==="instanceColor"&&y.instanceColor&&(ie=y.instanceColor)),ie!==void 0){let Se=ie.normalized,Ge=ie.itemSize,ze=t.get(ie);if(ze===void 0)continue;let it=ze.buffer,tt=ze.type,K=ze.bytesPerElement,fe=tt===e.INT||tt===e.UNSIGNED_INT||ie.gpuType===dn;if(ie.isInterleavedBufferAttribute){let ce=ie.data,be=ce.stride,Ve=ie.offset;if(ce.isInstancedInterleavedBuffer){for(let Ae=0;Ae<X.locationSize;Ae++)p(X.location+Ae,ce.meshPerAttribute);y.isInstancedMesh!==!0&&W._maxInstanceCount===void 0&&(W._maxInstanceCount=ce.meshPerAttribute*ce.count)}else for(let Ae=0;Ae<X.locationSize;Ae++)f(X.location+Ae);e.bindBuffer(e.ARRAY_BUFFER,it);for(let Ae=0;Ae<X.locationSize;Ae++)S(X.location+Ae,Ge/X.locationSize,tt,Se,be*K,(Ve+Ge/X.locationSize*Ae)*K,fe)}else{if(ie.isInstancedBufferAttribute){for(let ce=0;ce<X.locationSize;ce++)p(X.location+ce,ie.meshPerAttribute);y.isInstancedMesh!==!0&&W._maxInstanceCount===void 0&&(W._maxInstanceCount=ie.meshPerAttribute*ie.count)}else for(let ce=0;ce<X.locationSize;ce++)f(X.location+ce);e.bindBuffer(e.ARRAY_BUFFER,it);for(let ce=0;ce<X.locationSize;ce++)S(X.location+ce,Ge/X.locationSize,tt,Se,Ge*K,Ge/X.locationSize*ce*K,fe)}}else if(j!==void 0){let Se=j[le];if(Se!==void 0)switch(Se.length){case 2:e.vertexAttrib2fv(X.location,Se);break;case 3:e.vertexAttrib3fv(X.location,Se);break;case 4:e.vertexAttrib4fv(X.location,Se);break;default:e.vertexAttrib1fv(X.location,Se)}}}}A()}function C(){B();for(let y in i){let R=i[y];for(let q in R){let W=R[q];for(let k in W)c(W[k].object),delete W[k];delete R[q]}delete i[y]}}function L(y){if(i[y.id]===void 0)return;let R=i[y.id];for(let q in R){let W=R[q];for(let k in W)c(W[k].object),delete W[k];delete R[q]}delete i[y.id]}function U(y){for(let R in i){let q=i[R];if(q[y.id]===void 0)continue;let W=q[y.id];for(let k in W)c(W[k].object),delete W[k];delete q[y.id]}}function B(){M(),s=!0,n!==a&&(n=a,h(n.object))}function M(){a.geometry=null,a.program=null,a.wireframe=!1}return{setup:o,reset:B,resetDefaultState:M,dispose:C,releaseStatesOfGeometry:L,releaseStatesOfProgram:U,initAttributes:_,enableAttribute:f,disableUnusedAttributes:A}}function Mf(e,t,r){let i;function a(h){i=h}function n(h,c){e.drawArrays(i,h,c),r.update(c,i,1)}function s(h,c,u){u!==0&&(e.drawArraysInstanced(i,h,c,u),r.update(c,i,u))}function o(h,c,u){if(u===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,h,0,c,0,u);let d=0;for(let m=0;m<u;m++)d+=c[m];r.update(d,i,1)}function l(h,c,u,d){if(u===0)return;let m=t.get("WEBGL_multi_draw");if(m===null)for(let x=0;x<h.length;x++)s(h[x],c[x],d[x]);else{m.multiDrawArraysInstancedWEBGL(i,h,0,c,0,d,0,u);let x=0;for(let _=0;_<u;_++)x+=c[_]*d[_];r.update(x,i,1)}}this.setMode=a,this.render=n,this.renderInstances=s,this.renderMultiDraw=o,this.renderMultiDrawInstances=l}function yf(e,t,r,i){let a;function n(){if(a!==void 0)return a;if(t.has("EXT_texture_filter_anisotropic")===!0){let U=t.get("EXT_texture_filter_anisotropic");a=e.getParameter(U.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else a=0;return a}function s(U){return!(U!==qt&&i.convert(U)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(U){let B=U===Qt&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(U!==$t&&i.convert(U)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_TYPE)&&U!==Vt&&!B)}function l(U){if(U==="highp"){if(e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.HIGH_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.HIGH_FLOAT).precision>0)return"highp";U="mediump"}return U==="mediump"&&e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.MEDIUM_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let h=r.precision!==void 0?r.precision:"highp",c=l(h);c!==h&&(ke("WebGLRenderer:",h,"not supported, using",c,"instead."),h=c);let u=r.logarithmicDepthBuffer===!0,d=r.reversedDepthBuffer===!0&&t.has("EXT_clip_control"),m=e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS),x=e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=e.getParameter(e.MAX_TEXTURE_SIZE),f=e.getParameter(e.MAX_CUBE_MAP_TEXTURE_SIZE),p=e.getParameter(e.MAX_VERTEX_ATTRIBS),A=e.getParameter(e.MAX_VERTEX_UNIFORM_VECTORS),S=e.getParameter(e.MAX_VARYING_VECTORS),b=e.getParameter(e.MAX_FRAGMENT_UNIFORM_VECTORS),C=x>0,L=e.getParameter(e.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:n,getMaxPrecision:l,textureFormatReadable:s,textureTypeReadable:o,precision:h,logarithmicDepthBuffer:u,reversedDepthBuffer:d,maxTextures:m,maxVertexTextures:x,maxTextureSize:_,maxCubemapSize:f,maxAttributes:p,maxVertexUniforms:A,maxVaryings:S,maxFragmentUniforms:b,vertexTextures:C,maxSamples:L}}function Sf(e){let t=this,r=null,i=0,a=!1,n=!1,s=new Wr,o=new Ze,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){let m=u.length!==0||d||i!==0||a;return a=d,i=u.length,m},this.beginShadows=function(){n=!0,c(null)},this.endShadows=function(){n=!1},this.setGlobalState=function(u,d){r=c(u,d,0)},this.setState=function(u,d,m){let x=u.clippingPlanes,_=u.clipIntersection,f=u.clipShadows,p=e.get(u);if(!a||x===null||x.length===0||n&&!f)n?c(null):h();else{let A=n?0:i,S=A*4,b=p.clippingState||null;l.value=b,b=c(x,d,S,m);for(let C=0;C!==S;++C)b[C]=r[C];p.clippingState=b,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=A}};function h(){l.value!==r&&(l.value=r,l.needsUpdate=i>0),t.numPlanes=i,t.numIntersection=0}function c(u,d,m,x){let _=u!==null?u.length:0,f=null;if(_!==0){if(f=l.value,x!==!0||f===null){let p=m+_*4,A=d.matrixWorldInverse;o.getNormalMatrix(A),(f===null||f.length<p)&&(f=new Float32Array(p));for(let S=0,b=m;S!==_;++S,b+=4)s.copy(u[S]).applyMatrix4(A,o),s.normal.toArray(f,b),f[b+3]=s.constant}l.value=f,l.needsUpdate=!0}return t.numPlanes=_,t.numIntersection=0,f}}function Tf(e){let t=new WeakMap;function r(s,o){return o===ln?s.mapping=$r:o===hn&&(s.mapping=Qr),s}function i(s){if(s&&s.isTexture){let o=s.mapping;if(o===ln||o===hn)if(t.has(s)){let l=t.get(s).texture;return r(l,s.mapping)}else{let l=s.image;if(l&&l.height>0){let h=new pc(l.height);return h.fromEquirectangularTexture(e,s),t.set(s,h),s.addEventListener("dispose",a),r(h.texture,s.mapping)}else return null}}return s}function a(s){let o=s.target;o.removeEventListener("dispose",a);let l=t.get(o);l!==void 0&&(t.delete(o),l.dispose())}function n(){t=new WeakMap}return{get:i,dispose:n}}var Lr=4,fl=[.125,.215,.35,.446,.526,.582],Yr=20,Ef=256,ia=new Tu,ml=new Qe,zs=null,Vs=0,ks=0,Gs=!1,bf=new z,Hs=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,r=.1,i=100,a={}){let{size:n=256,position:s=bf}=a;zs=this._renderer.getRenderTarget(),Vs=this._renderer.getActiveCubeFace(),ks=this._renderer.getActiveMipmapLevel(),Gs=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(n);let o=this._allocateTargets();return o.depthBuffer=!0,this._sceneToCubeUV(e,r,i,o,s),t>0&&this._blur(o,0,0,t),this._applyPMREM(o),this._cleanup(o),o}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=vl(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=_l(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(zs,Vs,ks),this._renderer.xr.enabled=Gs,e.scissorTest=!1,Ti(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===$r||e.mapping===Qr?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),zs=this._renderer.getRenderTarget(),Vs=this._renderer.getActiveCubeFace(),ks=this._renderer.getActiveMipmapLevel(),Gs=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let r=t||this._allocateTargets();return this._textureToCubeUV(e,r),this._applyPMREM(r),this._cleanup(r),r}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,r={magFilter:St,minFilter:St,generateMipmaps:!1,type:Qt,format:qt,colorSpace:Br,depthBuffer:!1},i=gl(e,t,r);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=gl(e,t,r);let{_lodMax:a}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=wf(a)),this._blurMaterial=Cf(a,e,t),this._ggxMaterial=Af(a,e,t)}return i}_compileMaterial(e){let t=new Zt(new Gr,e);this._renderer.compile(t,ia)}_sceneToCubeUV(e,t,r,i,a){let n=new Nt(90,1,t,r),s=[1,-1,1,1,1,1],o=[1,1,1,-1,-1,-1],l=this._renderer,h=l.autoClear,c=l.toneMapping;l.getClearColor(ml),l.toneMapping=Sr,l.autoClear=!1,l.state.buffers.depth.getReversed()&&(l.setRenderTarget(i),l.clearDepth(),l.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Zt(new ys,new vs({name:"PMREM.Background",side:Rt,depthWrite:!1,depthTest:!1})));let u=this._backgroundBox,d=u.material,m=!1,x=e.background;x?x.isColor&&(d.color.copy(x),e.background=null,m=!0):(d.color.copy(ml),m=!0);for(let _=0;_<6;_++){let f=_%3;f===0?(n.up.set(0,s[_],0),n.position.set(a.x,a.y,a.z),n.lookAt(a.x+o[_],a.y,a.z)):f===1?(n.up.set(0,0,s[_]),n.position.set(a.x,a.y,a.z),n.lookAt(a.x,a.y+o[_],a.z)):(n.up.set(0,s[_],0),n.position.set(a.x,a.y,a.z),n.lookAt(a.x,a.y,a.z+o[_]));let p=this._cubeSize;Ti(i,f*p,_>2?p:0,p,p),l.setRenderTarget(i),m&&l.render(u,n),l.render(e,n)}l.toneMapping=c,l.autoClear=h,e.background=x}_textureToCubeUV(e,t){let r=this._renderer,i=e.mapping===$r||e.mapping===Qr;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=vl()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=_l());let a=i?this._cubemapMaterial:this._equirectMaterial,n=this._lodMeshes[0];n.material=a;let s=a.uniforms;s.envMap.value=e;let o=this._cubeSize;Ti(t,0,0,3*o,2*o),r.setRenderTarget(t),r.render(n,ia)}_applyPMREM(e){let t=this._renderer,r=t.autoClear;t.autoClear=!1;let i=this._lodMeshes.length;for(let a=1;a<i;a++)this._applyGGXFilter(e,a-1,a);t.autoClear=r}_applyGGXFilter(e,t,r){let i=this._renderer,a=this._pingPongRenderTarget,n=this._ggxMaterial,s=this._lodMeshes[r];s.material=n;let o=n.uniforms,l=r/(this._lodMeshes.length-1),h=t/(this._lodMeshes.length-1),c=Math.sqrt(l*l-h*h),u=.05+l*.95,d=c*u,{_lodMax:m}=this,x=this._sizeLods[r],_=3*x*(r>m-Lr?r-m+Lr:0),f=4*(this._cubeSize-x);o.envMap.value=e.texture,o.roughness.value=d,o.mipInt.value=m-t,Ti(a,_,f,3*x,2*x),i.setRenderTarget(a),i.render(s,ia),o.envMap.value=a.texture,o.roughness.value=0,o.mipInt.value=m-r,Ti(e,_,f,3*x,2*x),i.setRenderTarget(e),i.render(s,ia)}_blur(e,t,r,i,a){let n=this._pingPongRenderTarget;this._halfBlur(e,n,t,r,i,"latitudinal",a),this._halfBlur(n,e,r,r,i,"longitudinal",a)}_halfBlur(e,t,r,i,a,n,s){let o=this._renderer,l=this._blurMaterial;n!=="latitudinal"&&n!=="longitudinal"&&$e("blur direction must be either latitudinal or longitudinal!");let h=3,c=this._lodMeshes[i];c.material=l;let u=l.uniforms,d=this._sizeLods[r]-1,m=isFinite(a)?Math.PI/(2*d):2*Math.PI/(2*Yr-1),x=a/m,_=isFinite(a)?1+Math.floor(h*x):Yr;_>Yr&&ke(`sigmaRadians, ${a}, is too large and will clip, as it requested ${_} samples when the maximum is set to ${Yr}`);let f=[],p=0;for(let L=0;L<Yr;++L){let U=L/x,B=Math.exp(-U*U/2);f.push(B),L===0?p+=B:L<_&&(p+=2*B)}for(let L=0;L<f.length;L++)f[L]=f[L]/p;u.envMap.value=e.texture,u.samples.value=_,u.weights.value=f,u.latitudinal.value=n==="latitudinal",s&&(u.poleAxis.value=s);let{_lodMax:A}=this;u.dTheta.value=m,u.mipInt.value=A-r;let S=this._sizeLods[i],b=3*S*(i>A-Lr?i-A+Lr:0),C=4*(this._cubeSize-S);Ti(t,b,C,3*S,2*S),o.setRenderTarget(t),o.render(c,ia)}};function wf(e){let t=[],r=[],i=[],a=e,n=e-Lr+1+fl.length;for(let s=0;s<n;s++){let o=Math.pow(2,a);t.push(o);let l=1/o;s>e-Lr?l=fl[s-e+Lr-1]:s===0&&(l=0),r.push(l);let h=1/(o-2),c=-h,u=1+h,d=[c,c,u,c,u,u,c,c,u,u,c,u],m=6,x=6,_=3,f=2,p=1,A=new Float32Array(_*x*m),S=new Float32Array(f*x*m),b=new Float32Array(p*x*m);for(let L=0;L<m;L++){let U=L%3*2/3-1,B=L>2?0:-1,M=[U,B,0,U+2/3,B,0,U+2/3,B+1,0,U,B,0,U+2/3,B+1,0,U,B+1,0];A.set(M,_*x*L),S.set(d,f*x*L);let y=[L,L,L,L,L,L];b.set(y,p*x*L)}let C=new Gr;C.setAttribute("position",new Kt(A,_)),C.setAttribute("uv",new Kt(S,f)),C.setAttribute("faceIndex",new Kt(b,p)),i.push(new Zt(C,null)),a>Lr&&a--}return{lodMeshes:i,sizeLods:t,sigmas:r}}function gl(e,t,r){let i=new zr(e,t,r);return i.texture.mapping=oa,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function Ti(e,t,r,i,a){e.viewport.set(t,r,i,a),e.scissor.set(t,r,i,a)}function Af(e,t,r){return new gr({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:Ef,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/r,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Ga(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 3.2: Transform view direction to hemisphere configuration
				vec3 Vh = normalize(vec3(alpha * V.x, alpha * V.y, V.z));

				// Section 4.1: Orthonormal basis
				float lensq = Vh.x * Vh.x + Vh.y * Vh.y;
				vec3 T1 = lensq > 0.0 ? vec3(-Vh.y, Vh.x, 0.0) / sqrt(lensq) : vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(Vh, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + Vh.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * Vh;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:sr,depthTest:!1,depthWrite:!1})}function Cf(e,t,r){let i=new Float32Array(Yr),a=new z(0,1,0);return new gr({name:"SphericalGaussianBlur",defines:{n:Yr,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/r,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:a}},vertexShader:Ga(),fragmentShader:`

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
		`,blending:sr,depthTest:!1,depthWrite:!1})}function _l(){return new gr({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Ga(),fragmentShader:`

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
		`,blending:sr,depthTest:!1,depthWrite:!1})}function vl(){return new gr({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Ga(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:sr,depthTest:!1,depthWrite:!1})}function Ga(){return`

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
	`}function Rf(e){let t=new WeakMap,r=null;function i(o){if(o&&o.isTexture){let l=o.mapping,h=l===ln||l===hn,c=l===$r||l===Qr;if(h||c){let u=t.get(o),d=u!==void 0?u.texture.pmremVersion:0;if(o.isRenderTargetTexture&&o.pmremVersion!==d)return r===null&&(r=new Hs(e)),u=h?r.fromEquirectangular(o,u):r.fromCubemap(o,u),u.texture.pmremVersion=o.pmremVersion,t.set(o,u),u.texture;if(u!==void 0)return u.texture;{let m=o.image;return h&&m&&m.height>0||c&&m&&a(m)?(r===null&&(r=new Hs(e)),u=h?r.fromEquirectangular(o):r.fromCubemap(o),u.texture.pmremVersion=o.pmremVersion,t.set(o,u),o.addEventListener("dispose",n),u.texture):null}}}return o}function a(o){let l=0,h=6;for(let c=0;c<h;c++)o[c]!==void 0&&l++;return l===h}function n(o){let l=o.target;l.removeEventListener("dispose",n);let h=t.get(l);h!==void 0&&(t.delete(l),h.dispose())}function s(){t=new WeakMap,r!==null&&(r.dispose(),r=null)}return{get:i,dispose:s}}function Pf(e){let t={};function r(i){if(t[i]!==void 0)return t[i];let a=e.getExtension(i);return t[i]=a,a}return{has:function(i){return r(i)!==null},init:function(){r("EXT_color_buffer_float"),r("WEBGL_clip_cull_distance"),r("OES_texture_float_linear"),r("EXT_color_buffer_half_float"),r("WEBGL_multisampled_render_to_texture"),r("WEBGL_render_shared_exponent")},get:function(i){let a=r(i);return a===null&&Bi("WebGLRenderer: "+i+" extension not supported."),a}}}function Lf(e,t,r,i){let a={},n=new WeakMap;function s(u){let d=u.target;d.index!==null&&t.remove(d.index);for(let x in d.attributes)t.remove(d.attributes[x]);d.removeEventListener("dispose",s),delete a[d.id];let m=n.get(d);m&&(t.remove(m),n.delete(d)),i.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,r.memory.geometries--}function o(u,d){return a[d.id]===!0||(d.addEventListener("dispose",s),a[d.id]=!0,r.memory.geometries++),d}function l(u){let d=u.attributes;for(let m in d)t.update(d[m],e.ARRAY_BUFFER)}function h(u){let d=[],m=u.index,x=u.attributes.position,_=0;if(m!==null){let A=m.array;_=m.version;for(let S=0,b=A.length;S<b;S+=3){let C=A[S+0],L=A[S+1],U=A[S+2];d.push(C,L,L,U,U,C)}}else if(x!==void 0){let A=x.array;_=x.version;for(let S=0,b=A.length/3-1;S<b;S+=3){let C=S+0,L=S+1,U=S+2;d.push(C,L,L,U,U,C)}}else return;let f=new(go(d)?Do:Uo)(d,1);f.version=_;let p=n.get(u);p&&t.remove(p),n.set(u,f)}function c(u){let d=n.get(u);if(d){let m=u.index;m!==null&&d.version<m.version&&h(u)}else h(u);return n.get(u)}return{get:o,update:l,getWireframeAttribute:c}}function Nf(e,t,r){let i;function a(d){i=d}let n,s;function o(d){n=d.type,s=d.bytesPerElement}function l(d,m){e.drawElements(i,m,n,d*s),r.update(m,i,1)}function h(d,m,x){x!==0&&(e.drawElementsInstanced(i,m,n,d*s,x),r.update(m,i,x))}function c(d,m,x){if(x===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,m,0,n,d,0,x);let _=0;for(let f=0;f<x;f++)_+=m[f];r.update(_,i,1)}function u(d,m,x,_){if(x===0)return;let f=t.get("WEBGL_multi_draw");if(f===null)for(let p=0;p<d.length;p++)h(d[p]/s,m[p],_[p]);else{f.multiDrawElementsInstancedWEBGL(i,m,0,n,d,0,_,0,x);let p=0;for(let A=0;A<x;A++)p+=m[A]*_[A];r.update(p,i,1)}}this.setMode=a,this.setIndex=o,this.render=l,this.renderInstances=h,this.renderMultiDraw=c,this.renderMultiDrawInstances=u}function Uf(e){let t={geometries:0,textures:0},r={frame:0,calls:0,triangles:0,points:0,lines:0};function i(n,s,o){switch(r.calls++,s){case e.TRIANGLES:r.triangles+=o*(n/3);break;case e.LINES:r.lines+=o*(n/2);break;case e.LINE_STRIP:r.lines+=o*(n-1);break;case e.LINE_LOOP:r.lines+=o*n;break;case e.POINTS:r.points+=o*n;break;default:$e("WebGLInfo: Unknown draw mode:",s);break}}function a(){r.calls=0,r.triangles=0,r.points=0,r.lines=0}return{memory:t,render:r,programs:null,autoReset:!0,reset:a,update:i}}function Df(e,t,r){let i=new WeakMap,a=new ct;function n(s,o,l){let h=s.morphTargetInfluences,c=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=c!==void 0?c.length:0,d=i.get(o);if(d===void 0||d.count!==u){let m=function(){B.dispose(),i.delete(o),o.removeEventListener("dispose",m)};d!==void 0&&d.texture.dispose();let x=o.morphAttributes.position!==void 0,_=o.morphAttributes.normal!==void 0,f=o.morphAttributes.color!==void 0,p=o.morphAttributes.position||[],A=o.morphAttributes.normal||[],S=o.morphAttributes.color||[],b=0;x===!0&&(b=1),_===!0&&(b=2),f===!0&&(b=3);let C=o.attributes.position.count*b,L=1;C>t.maxTextureSize&&(L=Math.ceil(C/t.maxTextureSize),C=t.maxTextureSize);let U=new Float32Array(C*L*4*u),B=new So(U,C,L,u);B.type=Vt,B.needsUpdate=!0;let M=b*4;for(let y=0;y<u;y++){let R=p[y],q=A[y],W=S[y],k=C*L*4*y;for(let ee=0;ee<R.count;ee++){let j=ee*M;x===!0&&(a.fromBufferAttribute(R,ee),U[k+j+0]=a.x,U[k+j+1]=a.y,U[k+j+2]=a.z,U[k+j+3]=0),_===!0&&(a.fromBufferAttribute(q,ee),U[k+j+4]=a.x,U[k+j+5]=a.y,U[k+j+6]=a.z,U[k+j+7]=0),f===!0&&(a.fromBufferAttribute(W,ee),U[k+j+8]=a.x,U[k+j+9]=a.y,U[k+j+10]=a.z,U[k+j+11]=W.itemSize===4?a.w:1)}}d={count:u,texture:B,size:new ye(C,L)},i.set(o,d),o.addEventListener("dispose",m)}if(s.isInstancedMesh===!0&&s.morphTexture!==null)l.getUniforms().setValue(e,"morphTexture",s.morphTexture,r);else{let m=0;for(let _=0;_<h.length;_++)m+=h[_];let x=o.morphTargetsRelative?1:1-m;l.getUniforms().setValue(e,"morphTargetBaseInfluence",x),l.getUniforms().setValue(e,"morphTargetInfluences",h)}l.getUniforms().setValue(e,"morphTargetsTexture",d.texture,r),l.getUniforms().setValue(e,"morphTargetsTextureSize",d.size)}return{update:n}}function If(e,t,r,i){let a=new WeakMap;function n(l){let h=i.render.frame,c=l.geometry,u=t.get(l,c);if(a.get(u)!==h&&(t.update(u),a.set(u,h)),l.isInstancedMesh&&(l.hasEventListener("dispose",o)===!1&&l.addEventListener("dispose",o),a.get(l)!==h&&(r.update(l.instanceMatrix,e.ARRAY_BUFFER),l.instanceColor!==null&&r.update(l.instanceColor,e.ARRAY_BUFFER),a.set(l,h))),l.isSkinnedMesh){let d=l.skeleton;a.get(d)!==h&&(d.update(),a.set(d,h))}return u}function s(){a=new WeakMap}function o(l){let h=l.target;h.removeEventListener("dispose",o),r.remove(h.instanceMatrix),h.instanceColor!==null&&r.remove(h.instanceColor)}return{update:n,dispose:s}}var xl=new It,Ml=new Xo(1,1),yl=new So,Sl=new qh,Tl=new Go,El=[],bl=[],wl=new Float32Array(16),Al=new Float32Array(9),Cl=new Float32Array(4);function Ei(e,t,r){let i=e[0];if(i<=0||i>0)return e;let a=t*r,n=El[a];if(n===void 0&&(n=new Float32Array(a),El[a]=n),t!==0){i.toArray(n,0);for(let s=1,o=0;s!==t;++s)o+=r,e[s].toArray(n,o)}return n}function vt(e,t){if(e.length!==t.length)return!1;for(let r=0,i=e.length;r<i;r++)if(e[r]!==t[r])return!1;return!0}function xt(e,t){for(let r=0,i=t.length;r<i;r++)e[r]=t[r]}function Ha(e,t){let r=bl[t];r===void 0&&(r=new Int32Array(t),bl[t]=r);for(let i=0;i!==t;++i)r[i]=e.allocateTextureUnit();return r}function Of(e,t){let r=this.cache;r[0]!==t&&(e.uniform1f(this.addr,t),r[0]=t)}function Ff(e,t){let r=this.cache;if(t.x!==void 0)(r[0]!==t.x||r[1]!==t.y)&&(e.uniform2f(this.addr,t.x,t.y),r[0]=t.x,r[1]=t.y);else{if(vt(r,t))return;e.uniform2fv(this.addr,t),xt(r,t)}}function Bf(e,t){let r=this.cache;if(t.x!==void 0)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z)&&(e.uniform3f(this.addr,t.x,t.y,t.z),r[0]=t.x,r[1]=t.y,r[2]=t.z);else if(t.r!==void 0)(r[0]!==t.r||r[1]!==t.g||r[2]!==t.b)&&(e.uniform3f(this.addr,t.r,t.g,t.b),r[0]=t.r,r[1]=t.g,r[2]=t.b);else{if(vt(r,t))return;e.uniform3fv(this.addr,t),xt(r,t)}}function zf(e,t){let r=this.cache;if(t.x!==void 0)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z||r[3]!==t.w)&&(e.uniform4f(this.addr,t.x,t.y,t.z,t.w),r[0]=t.x,r[1]=t.y,r[2]=t.z,r[3]=t.w);else{if(vt(r,t))return;e.uniform4fv(this.addr,t),xt(r,t)}}function Vf(e,t){let r=this.cache,i=t.elements;if(i===void 0){if(vt(r,t))return;e.uniformMatrix2fv(this.addr,!1,t),xt(r,t)}else{if(vt(r,i))return;Cl.set(i),e.uniformMatrix2fv(this.addr,!1,Cl),xt(r,i)}}function kf(e,t){let r=this.cache,i=t.elements;if(i===void 0){if(vt(r,t))return;e.uniformMatrix3fv(this.addr,!1,t),xt(r,t)}else{if(vt(r,i))return;Al.set(i),e.uniformMatrix3fv(this.addr,!1,Al),xt(r,i)}}function Gf(e,t){let r=this.cache,i=t.elements;if(i===void 0){if(vt(r,t))return;e.uniformMatrix4fv(this.addr,!1,t),xt(r,t)}else{if(vt(r,i))return;wl.set(i),e.uniformMatrix4fv(this.addr,!1,wl),xt(r,i)}}function Hf(e,t){let r=this.cache;r[0]!==t&&(e.uniform1i(this.addr,t),r[0]=t)}function Wf(e,t){let r=this.cache;if(t.x!==void 0)(r[0]!==t.x||r[1]!==t.y)&&(e.uniform2i(this.addr,t.x,t.y),r[0]=t.x,r[1]=t.y);else{if(vt(r,t))return;e.uniform2iv(this.addr,t),xt(r,t)}}function Xf(e,t){let r=this.cache;if(t.x!==void 0)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z)&&(e.uniform3i(this.addr,t.x,t.y,t.z),r[0]=t.x,r[1]=t.y,r[2]=t.z);else{if(vt(r,t))return;e.uniform3iv(this.addr,t),xt(r,t)}}function qf(e,t){let r=this.cache;if(t.x!==void 0)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z||r[3]!==t.w)&&(e.uniform4i(this.addr,t.x,t.y,t.z,t.w),r[0]=t.x,r[1]=t.y,r[2]=t.z,r[3]=t.w);else{if(vt(r,t))return;e.uniform4iv(this.addr,t),xt(r,t)}}function jf(e,t){let r=this.cache;r[0]!==t&&(e.uniform1ui(this.addr,t),r[0]=t)}function Yf(e,t){let r=this.cache;if(t.x!==void 0)(r[0]!==t.x||r[1]!==t.y)&&(e.uniform2ui(this.addr,t.x,t.y),r[0]=t.x,r[1]=t.y);else{if(vt(r,t))return;e.uniform2uiv(this.addr,t),xt(r,t)}}function Jf(e,t){let r=this.cache;if(t.x!==void 0)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z)&&(e.uniform3ui(this.addr,t.x,t.y,t.z),r[0]=t.x,r[1]=t.y,r[2]=t.z);else{if(vt(r,t))return;e.uniform3uiv(this.addr,t),xt(r,t)}}function Kf(e,t){let r=this.cache;if(t.x!==void 0)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z||r[3]!==t.w)&&(e.uniform4ui(this.addr,t.x,t.y,t.z,t.w),r[0]=t.x,r[1]=t.y,r[2]=t.z,r[3]=t.w);else{if(vt(r,t))return;e.uniform4uiv(this.addr,t),xt(r,t)}}function Zf(e,t,r){let i=this.cache,a=r.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a);let n;this.type===e.SAMPLER_2D_SHADOW?(Ml.compareFunction=po,n=Ml):n=xl,r.setTexture2D(t||n,a)}function $f(e,t,r){let i=this.cache,a=r.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a),r.setTexture3D(t||Sl,a)}function Qf(e,t,r){let i=this.cache,a=r.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a),r.setTextureCube(t||Tl,a)}function em(e,t,r){let i=this.cache,a=r.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a),r.setTexture2DArray(t||yl,a)}function tm(e){switch(e){case 5126:return Of;case 35664:return Ff;case 35665:return Bf;case 35666:return zf;case 35674:return Vf;case 35675:return kf;case 35676:return Gf;case 5124:case 35670:return Hf;case 35667:case 35671:return Wf;case 35668:case 35672:return Xf;case 35669:case 35673:return qf;case 5125:return jf;case 36294:return Yf;case 36295:return Jf;case 36296:return Kf;case 35678:case 36198:case 36298:case 36306:case 35682:return Zf;case 35679:case 36299:case 36307:return $f;case 35680:case 36300:case 36308:case 36293:return Qf;case 36289:case 36303:case 36311:case 36292:return em}}function rm(e,t){e.uniform1fv(this.addr,t)}function im(e,t){let r=Ei(t,this.size,2);e.uniform2fv(this.addr,r)}function am(e,t){let r=Ei(t,this.size,3);e.uniform3fv(this.addr,r)}function nm(e,t){let r=Ei(t,this.size,4);e.uniform4fv(this.addr,r)}function sm(e,t){let r=Ei(t,this.size,4);e.uniformMatrix2fv(this.addr,!1,r)}function om(e,t){let r=Ei(t,this.size,9);e.uniformMatrix3fv(this.addr,!1,r)}function lm(e,t){let r=Ei(t,this.size,16);e.uniformMatrix4fv(this.addr,!1,r)}function hm(e,t){e.uniform1iv(this.addr,t)}function cm(e,t){e.uniform2iv(this.addr,t)}function um(e,t){e.uniform3iv(this.addr,t)}function dm(e,t){e.uniform4iv(this.addr,t)}function pm(e,t){e.uniform1uiv(this.addr,t)}function fm(e,t){e.uniform2uiv(this.addr,t)}function mm(e,t){e.uniform3uiv(this.addr,t)}function gm(e,t){e.uniform4uiv(this.addr,t)}function _m(e,t,r){let i=this.cache,a=t.length,n=Ha(r,a);vt(i,n)||(e.uniform1iv(this.addr,n),xt(i,n));for(let s=0;s!==a;++s)r.setTexture2D(t[s]||xl,n[s])}function vm(e,t,r){let i=this.cache,a=t.length,n=Ha(r,a);vt(i,n)||(e.uniform1iv(this.addr,n),xt(i,n));for(let s=0;s!==a;++s)r.setTexture3D(t[s]||Sl,n[s])}function xm(e,t,r){let i=this.cache,a=t.length,n=Ha(r,a);vt(i,n)||(e.uniform1iv(this.addr,n),xt(i,n));for(let s=0;s!==a;++s)r.setTextureCube(t[s]||Tl,n[s])}function Mm(e,t,r){let i=this.cache,a=t.length,n=Ha(r,a);vt(i,n)||(e.uniform1iv(this.addr,n),xt(i,n));for(let s=0;s!==a;++s)r.setTexture2DArray(t[s]||yl,n[s])}function ym(e){switch(e){case 5126:return rm;case 35664:return im;case 35665:return am;case 35666:return nm;case 35674:return sm;case 35675:return om;case 35676:return lm;case 5124:case 35670:return hm;case 35667:case 35671:return cm;case 35668:case 35672:return um;case 35669:case 35673:return dm;case 5125:return pm;case 36294:return fm;case 36295:return mm;case 36296:return gm;case 35678:case 36198:case 36298:case 36306:case 35682:return _m;case 35679:case 36299:case 36307:return vm;case 35680:case 36300:case 36308:case 36293:return xm;case 36289:case 36303:case 36311:case 36292:return Mm}}var Sm=class{constructor(e,t,r){this.id=e,this.addr=r,this.cache=[],this.type=t.type,this.setValue=tm(t.type)}},Tm=class{constructor(e,t,r){this.id=e,this.addr=r,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=ym(t.type)}},Em=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,r){let i=this.seq;for(let a=0,n=i.length;a!==n;++a){let s=i[a];s.setValue(e,t[s.id],r)}}},Ws=/(\w+)(\])?(\[|\.)?/g;function Rl(e,t){e.seq.push(t),e.map[t.id]=t}function bm(e,t,r){let i=e.name,a=i.length;for(Ws.lastIndex=0;;){let n=Ws.exec(i),s=Ws.lastIndex,o=n[1],l=n[2]==="]",h=n[3];if(l&&(o=o|0),h===void 0||h==="["&&s+2===a){Rl(r,h===void 0?new Sm(o,e,t):new Tm(o,e,t));break}else{let c=r.map[o];c===void 0&&(c=new Em(o),Rl(r,c)),r=c}}}var Wa=class{constructor(e,t){this.seq=[],this.map={};let r=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let i=0;i<r;++i){let a=e.getActiveUniform(t,i),n=e.getUniformLocation(t,a.name);bm(a,n,this)}}setValue(e,t,r,i){let a=this.map[t];a!==void 0&&a.setValue(e,r,i)}setOptional(e,t,r){let i=t[r];i!==void 0&&this.setValue(e,r,i)}static upload(e,t,r,i){for(let a=0,n=t.length;a!==n;++a){let s=t[a],o=r[s.id];o.needsUpdate!==!1&&s.setValue(e,o.value,i)}}static seqWithValue(e,t){let r=[];for(let i=0,a=e.length;i!==a;++i){let n=e[i];n.id in t&&r.push(n)}return r}};function Pl(e,t,r){let i=e.createShader(t);return e.shaderSource(i,r),e.compileShader(i),i}var wm=37297,Am=0;function Cm(e,t){let r=e.split(`
`),i=[],a=Math.max(t-6,0),n=Math.min(t+6,r.length);for(let s=a;s<n;s++){let o=s+1;i.push(`${o===t?">":" "} ${o}: ${r[s]}`)}return i.join(`
`)}var Ll=new Ze;function Rm(e){at._getMatrix(Ll,at.workingColorSpace,e);let t=`mat3( ${Ll.elements.map(r=>r.toFixed(4))} )`;switch(at.getTransfer(e)){case fa:return[t,"LinearTransferOETF"];case lt:return[t,"sRGBTransferOETF"];default:return ke("WebGLProgram: Unsupported color space: ",e),[t,"LinearTransferOETF"]}}function Nl(e,t,r){let i=e.getShaderParameter(t,e.COMPILE_STATUS),a=(e.getShaderInfoLog(t)||"").trim();if(i&&a==="")return"";let n=/ERROR: 0:(\d+)/.exec(a);if(n){let s=parseInt(n[1]);return r.toUpperCase()+`

`+a+`

`+Cm(e.getShaderSource(t),s)}else return a}function Pm(e,t){let r=Rm(t);return[`vec4 ${e}( vec4 value ) {`,`	return ${r[1]}( vec4( value.rgb * ${r[0]}, value.a ) );`,"}"].join(`
`)}function Lm(e,t){let r;switch(t){case yh:r="Linear";break;case Sh:r="Reinhard";break;case Th:r="Cineon";break;case Qs:r="ACESFilmic";break;case bh:r="AgX";break;case wh:r="Neutral";break;case Eh:r="Custom";break;default:ke("WebGLProgram: Unsupported toneMapping:",t),r="Linear"}return"vec3 "+e+"( vec3 color ) { return "+r+"ToneMapping( color ); }"}var Xa=new z;function Nm(){at.getLuminanceCoefficients(Xa);let e=Xa.x.toFixed(4),t=Xa.y.toFixed(4),r=Xa.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${e}, ${t}, ${r} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Um(e){return[e.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",e.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(aa).join(`
`)}function Dm(e){let t=[];for(let r in e){let i=e[r];i!==!1&&t.push("#define "+r+" "+i)}return t.join(`
`)}function Im(e,t){let r={},i=e.getProgramParameter(t,e.ACTIVE_ATTRIBUTES);for(let a=0;a<i;a++){let n=e.getActiveAttrib(t,a),s=n.name,o=1;n.type===e.FLOAT_MAT2&&(o=2),n.type===e.FLOAT_MAT3&&(o=3),n.type===e.FLOAT_MAT4&&(o=4),r[s]={type:n.type,location:e.getAttribLocation(t,s),locationSize:o}}return r}function aa(e){return e!==""}function Ul(e,t){let r=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return e.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,r).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function Dl(e,t){return e.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var Om=/^[ \t]*#include +<([\w\d./]+)>/gm;function Xs(e){return e.replace(Om,Bm)}var Fm=new Map;function Bm(e,t){let r=Je[t];if(r===void 0){let i=Fm.get(t);if(i!==void 0)r=Je[i],ke('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,i);else throw new Error("Can not resolve #include <"+t+">")}return Xs(r)}var zm=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Il(e){return e.replace(zm,Vm)}function Vm(e,t,r,i){let a="";for(let n=parseInt(t);n<parseInt(r);n++)a+=i.replace(/\[\s*i\s*\]/g,"[ "+n+" ]").replace(/UNROLLED_LOOP_INDEX/g,n);return a}function Ol(e){let t=`precision ${e.precision} float;
	precision ${e.precision} int;
	precision ${e.precision} sampler2D;
	precision ${e.precision} samplerCube;
	precision ${e.precision} sampler3D;
	precision ${e.precision} sampler2DArray;
	precision ${e.precision} sampler2DShadow;
	precision ${e.precision} samplerCubeShadow;
	precision ${e.precision} sampler2DArrayShadow;
	precision ${e.precision} isampler2D;
	precision ${e.precision} isampler3D;
	precision ${e.precision} isamplerCube;
	precision ${e.precision} isampler2DArray;
	precision ${e.precision} usampler2D;
	precision ${e.precision} usampler3D;
	precision ${e.precision} usamplerCube;
	precision ${e.precision} usampler2DArray;
	`;return e.precision==="highp"?t+=`
#define HIGH_PRECISION`:e.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:e.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}function km(e){let t="SHADOWMAP_TYPE_BASIC";return e.shadowMapType===Js?t="SHADOWMAP_TYPE_PCF":e.shadowMapType===eh?t="SHADOWMAP_TYPE_PCF_SOFT":e.shadowMapType===nr&&(t="SHADOWMAP_TYPE_VSM"),t}function Gm(e){let t="ENVMAP_TYPE_CUBE";if(e.envMap)switch(e.envMapMode){case $r:case Qr:t="ENVMAP_TYPE_CUBE";break;case oa:t="ENVMAP_TYPE_CUBE_UV";break}return t}function Hm(e){let t="ENVMAP_MODE_REFLECTION";return e.envMap&&e.envMapMode===Qr&&(t="ENVMAP_MODE_REFRACTION"),t}function Wm(e){let t="ENVMAP_BLENDING_NONE";if(e.envMap)switch(e.combine){case $s:t="ENVMAP_BLENDING_MULTIPLY";break;case xh:t="ENVMAP_BLENDING_MIX";break;case Mh:t="ENVMAP_BLENDING_ADD";break}return t}function Xm(e){let t=e.envMapCubeUVHeight;if(t===null)return null;let r=Math.log2(t)-2,i=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,r),112)),texelHeight:i,maxMip:r}}function qm(e,t,r,i){let a=e.getContext(),n=r.defines,s=r.vertexShader,o=r.fragmentShader,l=km(r),h=Gm(r),c=Hm(r),u=Wm(r),d=Xm(r),m=Um(r),x=Dm(n),_=a.createProgram(),f,p,A=r.glslVersion?"#version "+r.glslVersion+`
`:"";r.isRawShaderMaterial?(f=["#define SHADER_TYPE "+r.shaderType,"#define SHADER_NAME "+r.shaderName,x].filter(aa).join(`
`),f.length>0&&(f+=`
`),p=["#define SHADER_TYPE "+r.shaderType,"#define SHADER_NAME "+r.shaderName,x].filter(aa).join(`
`),p.length>0&&(p+=`
`)):(f=[Ol(r),"#define SHADER_TYPE "+r.shaderType,"#define SHADER_NAME "+r.shaderName,x,r.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",r.batching?"#define USE_BATCHING":"",r.batchingColor?"#define USE_BATCHING_COLOR":"",r.instancing?"#define USE_INSTANCING":"",r.instancingColor?"#define USE_INSTANCING_COLOR":"",r.instancingMorph?"#define USE_INSTANCING_MORPH":"",r.useFog&&r.fog?"#define USE_FOG":"",r.useFog&&r.fogExp2?"#define FOG_EXP2":"",r.map?"#define USE_MAP":"",r.envMap?"#define USE_ENVMAP":"",r.envMap?"#define "+c:"",r.lightMap?"#define USE_LIGHTMAP":"",r.aoMap?"#define USE_AOMAP":"",r.bumpMap?"#define USE_BUMPMAP":"",r.normalMap?"#define USE_NORMALMAP":"",r.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",r.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",r.displacementMap?"#define USE_DISPLACEMENTMAP":"",r.emissiveMap?"#define USE_EMISSIVEMAP":"",r.anisotropy?"#define USE_ANISOTROPY":"",r.anisotropyMap?"#define USE_ANISOTROPYMAP":"",r.clearcoatMap?"#define USE_CLEARCOATMAP":"",r.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",r.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",r.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",r.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",r.specularMap?"#define USE_SPECULARMAP":"",r.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",r.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",r.roughnessMap?"#define USE_ROUGHNESSMAP":"",r.metalnessMap?"#define USE_METALNESSMAP":"",r.alphaMap?"#define USE_ALPHAMAP":"",r.alphaHash?"#define USE_ALPHAHASH":"",r.transmission?"#define USE_TRANSMISSION":"",r.transmissionMap?"#define USE_TRANSMISSIONMAP":"",r.thicknessMap?"#define USE_THICKNESSMAP":"",r.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",r.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",r.mapUv?"#define MAP_UV "+r.mapUv:"",r.alphaMapUv?"#define ALPHAMAP_UV "+r.alphaMapUv:"",r.lightMapUv?"#define LIGHTMAP_UV "+r.lightMapUv:"",r.aoMapUv?"#define AOMAP_UV "+r.aoMapUv:"",r.emissiveMapUv?"#define EMISSIVEMAP_UV "+r.emissiveMapUv:"",r.bumpMapUv?"#define BUMPMAP_UV "+r.bumpMapUv:"",r.normalMapUv?"#define NORMALMAP_UV "+r.normalMapUv:"",r.displacementMapUv?"#define DISPLACEMENTMAP_UV "+r.displacementMapUv:"",r.metalnessMapUv?"#define METALNESSMAP_UV "+r.metalnessMapUv:"",r.roughnessMapUv?"#define ROUGHNESSMAP_UV "+r.roughnessMapUv:"",r.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+r.anisotropyMapUv:"",r.clearcoatMapUv?"#define CLEARCOATMAP_UV "+r.clearcoatMapUv:"",r.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+r.clearcoatNormalMapUv:"",r.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+r.clearcoatRoughnessMapUv:"",r.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+r.iridescenceMapUv:"",r.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+r.iridescenceThicknessMapUv:"",r.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+r.sheenColorMapUv:"",r.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+r.sheenRoughnessMapUv:"",r.specularMapUv?"#define SPECULARMAP_UV "+r.specularMapUv:"",r.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+r.specularColorMapUv:"",r.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+r.specularIntensityMapUv:"",r.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+r.transmissionMapUv:"",r.thicknessMapUv?"#define THICKNESSMAP_UV "+r.thicknessMapUv:"",r.vertexTangents&&r.flatShading===!1?"#define USE_TANGENT":"",r.vertexColors?"#define USE_COLOR":"",r.vertexAlphas?"#define USE_COLOR_ALPHA":"",r.vertexUv1s?"#define USE_UV1":"",r.vertexUv2s?"#define USE_UV2":"",r.vertexUv3s?"#define USE_UV3":"",r.pointsUvs?"#define USE_POINTS_UV":"",r.flatShading?"#define FLAT_SHADED":"",r.skinning?"#define USE_SKINNING":"",r.morphTargets?"#define USE_MORPHTARGETS":"",r.morphNormals&&r.flatShading===!1?"#define USE_MORPHNORMALS":"",r.morphColors?"#define USE_MORPHCOLORS":"",r.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+r.morphTextureStride:"",r.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+r.morphTargetsCount:"",r.doubleSided?"#define DOUBLE_SIDED":"",r.flipSided?"#define FLIP_SIDED":"",r.shadowMapEnabled?"#define USE_SHADOWMAP":"",r.shadowMapEnabled?"#define "+l:"",r.sizeAttenuation?"#define USE_SIZEATTENUATION":"",r.numLightProbes>0?"#define USE_LIGHT_PROBES":"",r.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",r.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(aa).join(`
`),p=[Ol(r),"#define SHADER_TYPE "+r.shaderType,"#define SHADER_NAME "+r.shaderName,x,r.useFog&&r.fog?"#define USE_FOG":"",r.useFog&&r.fogExp2?"#define FOG_EXP2":"",r.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",r.map?"#define USE_MAP":"",r.matcap?"#define USE_MATCAP":"",r.envMap?"#define USE_ENVMAP":"",r.envMap?"#define "+h:"",r.envMap?"#define "+c:"",r.envMap?"#define "+u:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",r.lightMap?"#define USE_LIGHTMAP":"",r.aoMap?"#define USE_AOMAP":"",r.bumpMap?"#define USE_BUMPMAP":"",r.normalMap?"#define USE_NORMALMAP":"",r.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",r.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",r.emissiveMap?"#define USE_EMISSIVEMAP":"",r.anisotropy?"#define USE_ANISOTROPY":"",r.anisotropyMap?"#define USE_ANISOTROPYMAP":"",r.clearcoat?"#define USE_CLEARCOAT":"",r.clearcoatMap?"#define USE_CLEARCOATMAP":"",r.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",r.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",r.dispersion?"#define USE_DISPERSION":"",r.iridescence?"#define USE_IRIDESCENCE":"",r.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",r.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",r.specularMap?"#define USE_SPECULARMAP":"",r.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",r.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",r.roughnessMap?"#define USE_ROUGHNESSMAP":"",r.metalnessMap?"#define USE_METALNESSMAP":"",r.alphaMap?"#define USE_ALPHAMAP":"",r.alphaTest?"#define USE_ALPHATEST":"",r.alphaHash?"#define USE_ALPHAHASH":"",r.sheen?"#define USE_SHEEN":"",r.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",r.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",r.transmission?"#define USE_TRANSMISSION":"",r.transmissionMap?"#define USE_TRANSMISSIONMAP":"",r.thicknessMap?"#define USE_THICKNESSMAP":"",r.vertexTangents&&r.flatShading===!1?"#define USE_TANGENT":"",r.vertexColors||r.instancingColor||r.batchingColor?"#define USE_COLOR":"",r.vertexAlphas?"#define USE_COLOR_ALPHA":"",r.vertexUv1s?"#define USE_UV1":"",r.vertexUv2s?"#define USE_UV2":"",r.vertexUv3s?"#define USE_UV3":"",r.pointsUvs?"#define USE_POINTS_UV":"",r.gradientMap?"#define USE_GRADIENTMAP":"",r.flatShading?"#define FLAT_SHADED":"",r.doubleSided?"#define DOUBLE_SIDED":"",r.flipSided?"#define FLIP_SIDED":"",r.shadowMapEnabled?"#define USE_SHADOWMAP":"",r.shadowMapEnabled?"#define "+l:"",r.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",r.numLightProbes>0?"#define USE_LIGHT_PROBES":"",r.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",r.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",r.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",r.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",r.toneMapping!==Sr?"#define TONE_MAPPING":"",r.toneMapping!==Sr?Je.tonemapping_pars_fragment:"",r.toneMapping!==Sr?Lm("toneMapping",r.toneMapping):"",r.dithering?"#define DITHERING":"",r.opaque?"#define OPAQUE":"",Je.colorspace_pars_fragment,Pm("linearToOutputTexel",r.outputColorSpace),Nm(),r.useDepthPacking?"#define DEPTH_PACKING "+r.depthPacking:"",`
`].filter(aa).join(`
`)),s=Xs(s),s=Ul(s,r),s=Dl(s,r),o=Xs(o),o=Ul(o,r),o=Dl(o,r),s=Il(s),o=Il(o),r.isRawShaderMaterial!==!0&&(A=`#version 300 es
`,f=[m,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+f,p=["#define varying in",r.glslVersion===mo?"":"layout(location = 0) out highp vec4 pc_fragColor;",r.glslVersion===mo?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);let S=A+f+s,b=A+p+o,C=Pl(a,a.VERTEX_SHADER,S),L=Pl(a,a.FRAGMENT_SHADER,b);a.attachShader(_,C),a.attachShader(_,L),r.index0AttributeName!==void 0?a.bindAttribLocation(_,0,r.index0AttributeName):r.morphTargets===!0&&a.bindAttribLocation(_,0,"position"),a.linkProgram(_);function U(R){if(e.debug.checkShaderErrors){let q=a.getProgramInfoLog(_)||"",W=a.getShaderInfoLog(C)||"",k=a.getShaderInfoLog(L)||"",ee=q.trim(),j=W.trim(),le=k.trim(),X=!0,ie=!0;if(a.getProgramParameter(_,a.LINK_STATUS)===!1)if(X=!1,typeof e.debug.onShaderError=="function")e.debug.onShaderError(a,_,C,L);else{let Se=Nl(a,C,"vertex"),Ge=Nl(a,L,"fragment");$e("THREE.WebGLProgram: Shader Error "+a.getError()+" - VALIDATE_STATUS "+a.getProgramParameter(_,a.VALIDATE_STATUS)+`

Material Name: `+R.name+`
Material Type: `+R.type+`

Program Info Log: `+ee+`
`+Se+`
`+Ge)}else ee!==""?ke("WebGLProgram: Program Info Log:",ee):(j===""||le==="")&&(ie=!1);ie&&(R.diagnostics={runnable:X,programLog:ee,vertexShader:{log:j,prefix:f},fragmentShader:{log:le,prefix:p}})}a.deleteShader(C),a.deleteShader(L),B=new Wa(a,_),M=Im(a,_)}let B;this.getUniforms=function(){return B===void 0&&U(this),B};let M;this.getAttributes=function(){return M===void 0&&U(this),M};let y=r.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return y===!1&&(y=a.getProgramParameter(_,wm)),y},this.destroy=function(){i.releaseStatesOfProgram(this),a.deleteProgram(_),this.program=void 0},this.type=r.shaderType,this.name=r.shaderName,this.id=Am++,this.cacheKey=t,this.usedTimes=1,this.program=_,this.vertexShader=C,this.fragmentShader=L,this}var jm=0,Ym=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,r=e.fragmentShader,i=this._getShaderStage(t),a=this._getShaderStage(r),n=this._getShaderCacheForMaterial(e);return n.has(i)===!1&&(n.add(i),i.usedTimes++),n.has(a)===!1&&(n.add(a),a.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let r of t)r.usedTimes--,r.usedTimes===0&&this.shaderCache.delete(r.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,r=t.get(e);return r===void 0&&(r=new Set,t.set(e,r)),r}_getShaderStage(e){let t=this.shaderCache,r=t.get(e);return r===void 0&&(r=new Jm(e),t.set(e,r)),r}},Jm=class{constructor(e){this.id=jm++,this.code=e,this.usedTimes=0}};function Km(e,t,r,i,a,n,s){let o=new bo,l=new Ym,h=new Set,c=[],u=a.logarithmicDepthBuffer,d=a.vertexTextures,m=a.precision,x={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(M){return h.add(M),M===0?"uv":`uv${M}`}function f(M,y,R,q,W){let k=q.fog,ee=W.geometry,j=M.isMeshStandardMaterial?q.environment:null,le=(M.isMeshStandardMaterial?r:t).get(M.envMap||j),X=le&&le.mapping===oa?le.image.height:null,ie=x[M.type];M.precision!==null&&(m=a.getMaxPrecision(M.precision),m!==M.precision&&ke("WebGLProgram.getParameters:",M.precision,"not supported, using",m,"instead."));let Se=ee.morphAttributes.position||ee.morphAttributes.normal||ee.morphAttributes.color,Ge=Se!==void 0?Se.length:0,ze=0;ee.morphAttributes.position!==void 0&&(ze=1),ee.morphAttributes.normal!==void 0&&(ze=2),ee.morphAttributes.color!==void 0&&(ze=3);let it,tt,K,fe;if(ie){let nt=ir[ie];it=nt.vertexShader,tt=nt.fragmentShader}else it=M.vertexShader,tt=M.fragmentShader,l.update(M),K=l.getVertexShaderID(M),fe=l.getFragmentShaderID(M);let ce=e.getRenderTarget(),be=e.state.buffers.depth.getReversed(),Ve=W.isInstancedMesh===!0,Ae=W.isBatchedMesh===!0,je=!!M.map,qe=!!M.matcap,Z=!!le,T=!!M.aoMap,de=!!M.lightMap,se=!!M.bumpMap,me=!!M.normalMap,oe=!!M.displacementMap,Ee=!!M.emissiveMap,ge=!!M.metalnessMap,Ce=!!M.roughnessMap,We=M.anisotropy>0,E=M.clearcoat>0,v=M.dispersion>0,F=M.iridescence>0,Y=M.sheen>0,$=M.transmission>0,J=We&&!!M.anisotropyMap,De=E&&!!M.clearcoatMap,_e=E&&!!M.clearcoatNormalMap,Re=E&&!!M.clearcoatRoughnessMap,we=F&&!!M.iridescenceMap,te=F&&!!M.iridescenceThicknessMap,Te=Y&&!!M.sheenColorMap,Xe=Y&&!!M.sheenRoughnessMap,Be=!!M.specularMap,ve=!!M.specularColorMap,He=!!M.specularIntensityMap,N=$&&!!M.transmissionMap,xe=$&&!!M.thicknessMap,ae=!!M.gradientMap,Ue=!!M.alphaMap,re=M.alphaTest>0,Q=!!M.alphaHash,Le=!!M.extensions,Fe=Sr;M.toneMapped&&(ce===null||ce.isXRRenderTarget===!0)&&(Fe=e.toneMapping);let gt={shaderID:ie,shaderType:M.type,shaderName:M.name,vertexShader:it,fragmentShader:tt,defines:M.defines,customVertexShaderID:K,customFragmentShaderID:fe,isRawShaderMaterial:M.isRawShaderMaterial===!0,glslVersion:M.glslVersion,precision:m,batching:Ae,batchingColor:Ae&&W._colorsTexture!==null,instancing:Ve,instancingColor:Ve&&W.instanceColor!==null,instancingMorph:Ve&&W.morphTexture!==null,supportsVertexTextures:d,outputColorSpace:ce===null?e.outputColorSpace:ce.isXRRenderTarget===!0?ce.texture.colorSpace:Br,alphaToCoverage:!!M.alphaToCoverage,map:je,matcap:qe,envMap:Z,envMapMode:Z&&le.mapping,envMapCubeUVHeight:X,aoMap:T,lightMap:de,bumpMap:se,normalMap:me,displacementMap:d&&oe,emissiveMap:Ee,normalMapObjectSpace:me&&M.normalMapType===Ph,normalMapTangentSpace:me&&M.normalMapType===Jn,metalnessMap:ge,roughnessMap:Ce,anisotropy:We,anisotropyMap:J,clearcoat:E,clearcoatMap:De,clearcoatNormalMap:_e,clearcoatRoughnessMap:Re,dispersion:v,iridescence:F,iridescenceMap:we,iridescenceThicknessMap:te,sheen:Y,sheenColorMap:Te,sheenRoughnessMap:Xe,specularMap:Be,specularColorMap:ve,specularIntensityMap:He,transmission:$,transmissionMap:N,thicknessMap:xe,gradientMap:ae,opaque:M.transparent===!1&&M.blending===Kr&&M.alphaToCoverage===!1,alphaMap:Ue,alphaTest:re,alphaHash:Q,combine:M.combine,mapUv:je&&_(M.map.channel),aoMapUv:T&&_(M.aoMap.channel),lightMapUv:de&&_(M.lightMap.channel),bumpMapUv:se&&_(M.bumpMap.channel),normalMapUv:me&&_(M.normalMap.channel),displacementMapUv:oe&&_(M.displacementMap.channel),emissiveMapUv:Ee&&_(M.emissiveMap.channel),metalnessMapUv:ge&&_(M.metalnessMap.channel),roughnessMapUv:Ce&&_(M.roughnessMap.channel),anisotropyMapUv:J&&_(M.anisotropyMap.channel),clearcoatMapUv:De&&_(M.clearcoatMap.channel),clearcoatNormalMapUv:_e&&_(M.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Re&&_(M.clearcoatRoughnessMap.channel),iridescenceMapUv:we&&_(M.iridescenceMap.channel),iridescenceThicknessMapUv:te&&_(M.iridescenceThicknessMap.channel),sheenColorMapUv:Te&&_(M.sheenColorMap.channel),sheenRoughnessMapUv:Xe&&_(M.sheenRoughnessMap.channel),specularMapUv:Be&&_(M.specularMap.channel),specularColorMapUv:ve&&_(M.specularColorMap.channel),specularIntensityMapUv:He&&_(M.specularIntensityMap.channel),transmissionMapUv:N&&_(M.transmissionMap.channel),thicknessMapUv:xe&&_(M.thicknessMap.channel),alphaMapUv:Ue&&_(M.alphaMap.channel),vertexTangents:!!ee.attributes.tangent&&(me||We),vertexColors:M.vertexColors,vertexAlphas:M.vertexColors===!0&&!!ee.attributes.color&&ee.attributes.color.itemSize===4,pointsUvs:W.isPoints===!0&&!!ee.attributes.uv&&(je||Ue),fog:!!k,useFog:M.fog===!0,fogExp2:!!k&&k.isFogExp2,flatShading:M.flatShading===!0&&M.wireframe===!1,sizeAttenuation:M.sizeAttenuation===!0,logarithmicDepthBuffer:u,reversedDepthBuffer:be,skinning:W.isSkinnedMesh===!0,morphTargets:ee.morphAttributes.position!==void 0,morphNormals:ee.morphAttributes.normal!==void 0,morphColors:ee.morphAttributes.color!==void 0,morphTargetsCount:Ge,morphTextureStride:ze,numDirLights:y.directional.length,numPointLights:y.point.length,numSpotLights:y.spot.length,numSpotLightMaps:y.spotLightMap.length,numRectAreaLights:y.rectArea.length,numHemiLights:y.hemi.length,numDirLightShadows:y.directionalShadowMap.length,numPointLightShadows:y.pointShadowMap.length,numSpotLightShadows:y.spotShadowMap.length,numSpotLightShadowsWithMaps:y.numSpotLightShadowsWithMaps,numLightProbes:y.numLightProbes,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:M.dithering,shadowMapEnabled:e.shadowMap.enabled&&R.length>0,shadowMapType:e.shadowMap.type,toneMapping:Fe,decodeVideoTexture:je&&M.map.isVideoTexture===!0&&at.getTransfer(M.map.colorSpace)===lt,decodeVideoTextureEmissive:Ee&&M.emissiveMap.isVideoTexture===!0&&at.getTransfer(M.emissiveMap.colorSpace)===lt,premultipliedAlpha:M.premultipliedAlpha,doubleSided:M.side===Wt,flipSided:M.side===Rt,useDepthPacking:M.depthPacking>=0,depthPacking:M.depthPacking||0,index0AttributeName:M.index0AttributeName,extensionClipCullDistance:Le&&M.extensions.clipCullDistance===!0&&i.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Le&&M.extensions.multiDraw===!0||Ae)&&i.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:i.has("KHR_parallel_shader_compile"),customProgramCacheKey:M.customProgramCacheKey()};return gt.vertexUv1s=h.has(1),gt.vertexUv2s=h.has(2),gt.vertexUv3s=h.has(3),h.clear(),gt}function p(M){let y=[];if(M.shaderID?y.push(M.shaderID):(y.push(M.customVertexShaderID),y.push(M.customFragmentShaderID)),M.defines!==void 0)for(let R in M.defines)y.push(R),y.push(M.defines[R]);return M.isRawShaderMaterial===!1&&(A(y,M),S(y,M),y.push(e.outputColorSpace)),y.push(M.customProgramCacheKey),y.join()}function A(M,y){M.push(y.precision),M.push(y.outputColorSpace),M.push(y.envMapMode),M.push(y.envMapCubeUVHeight),M.push(y.mapUv),M.push(y.alphaMapUv),M.push(y.lightMapUv),M.push(y.aoMapUv),M.push(y.bumpMapUv),M.push(y.normalMapUv),M.push(y.displacementMapUv),M.push(y.emissiveMapUv),M.push(y.metalnessMapUv),M.push(y.roughnessMapUv),M.push(y.anisotropyMapUv),M.push(y.clearcoatMapUv),M.push(y.clearcoatNormalMapUv),M.push(y.clearcoatRoughnessMapUv),M.push(y.iridescenceMapUv),M.push(y.iridescenceThicknessMapUv),M.push(y.sheenColorMapUv),M.push(y.sheenRoughnessMapUv),M.push(y.specularMapUv),M.push(y.specularColorMapUv),M.push(y.specularIntensityMapUv),M.push(y.transmissionMapUv),M.push(y.thicknessMapUv),M.push(y.combine),M.push(y.fogExp2),M.push(y.sizeAttenuation),M.push(y.morphTargetsCount),M.push(y.morphAttributeCount),M.push(y.numDirLights),M.push(y.numPointLights),M.push(y.numSpotLights),M.push(y.numSpotLightMaps),M.push(y.numHemiLights),M.push(y.numRectAreaLights),M.push(y.numDirLightShadows),M.push(y.numPointLightShadows),M.push(y.numSpotLightShadows),M.push(y.numSpotLightShadowsWithMaps),M.push(y.numLightProbes),M.push(y.shadowMapType),M.push(y.toneMapping),M.push(y.numClippingPlanes),M.push(y.numClipIntersection),M.push(y.depthPacking)}function S(M,y){o.disableAll(),y.supportsVertexTextures&&o.enable(0),y.instancing&&o.enable(1),y.instancingColor&&o.enable(2),y.instancingMorph&&o.enable(3),y.matcap&&o.enable(4),y.envMap&&o.enable(5),y.normalMapObjectSpace&&o.enable(6),y.normalMapTangentSpace&&o.enable(7),y.clearcoat&&o.enable(8),y.iridescence&&o.enable(9),y.alphaTest&&o.enable(10),y.vertexColors&&o.enable(11),y.vertexAlphas&&o.enable(12),y.vertexUv1s&&o.enable(13),y.vertexUv2s&&o.enable(14),y.vertexUv3s&&o.enable(15),y.vertexTangents&&o.enable(16),y.anisotropy&&o.enable(17),y.alphaHash&&o.enable(18),y.batching&&o.enable(19),y.dispersion&&o.enable(20),y.batchingColor&&o.enable(21),y.gradientMap&&o.enable(22),M.push(o.mask),o.disableAll(),y.fog&&o.enable(0),y.useFog&&o.enable(1),y.flatShading&&o.enable(2),y.logarithmicDepthBuffer&&o.enable(3),y.reversedDepthBuffer&&o.enable(4),y.skinning&&o.enable(5),y.morphTargets&&o.enable(6),y.morphNormals&&o.enable(7),y.morphColors&&o.enable(8),y.premultipliedAlpha&&o.enable(9),y.shadowMapEnabled&&o.enable(10),y.doubleSided&&o.enable(11),y.flipSided&&o.enable(12),y.useDepthPacking&&o.enable(13),y.dithering&&o.enable(14),y.transmission&&o.enable(15),y.sheen&&o.enable(16),y.opaque&&o.enable(17),y.pointsUvs&&o.enable(18),y.decodeVideoTexture&&o.enable(19),y.decodeVideoTextureEmissive&&o.enable(20),y.alphaToCoverage&&o.enable(21),M.push(o.mask)}function b(M){let y=x[M.type],R;if(y){let q=ir[y];R=hc.clone(q.uniforms)}else R=M.uniforms;return R}function C(M,y){let R;for(let q=0,W=c.length;q<W;q++){let k=c[q];if(k.cacheKey===y){R=k,++R.usedTimes;break}}return R===void 0&&(R=new qm(e,y,M,n),c.push(R)),R}function L(M){if(--M.usedTimes===0){let y=c.indexOf(M);c[y]=c[c.length-1],c.pop(),M.destroy()}}function U(M){l.remove(M)}function B(){l.dispose()}return{getParameters:f,getProgramCacheKey:p,getUniforms:b,acquireProgram:C,releaseProgram:L,releaseShaderCache:U,programs:c,dispose:B}}function Zm(){let e=new WeakMap;function t(s){return e.has(s)}function r(s){let o=e.get(s);return o===void 0&&(o={},e.set(s,o)),o}function i(s){e.delete(s)}function a(s,o,l){e.get(s)[o]=l}function n(){e=new WeakMap}return{has:t,get:r,remove:i,update:a,dispose:n}}function $m(e,t){return e.groupOrder!==t.groupOrder?e.groupOrder-t.groupOrder:e.renderOrder!==t.renderOrder?e.renderOrder-t.renderOrder:e.material.id!==t.material.id?e.material.id-t.material.id:e.z!==t.z?e.z-t.z:e.id-t.id}function Fl(e,t){return e.groupOrder!==t.groupOrder?e.groupOrder-t.groupOrder:e.renderOrder!==t.renderOrder?e.renderOrder-t.renderOrder:e.z!==t.z?t.z-e.z:e.id-t.id}function Bl(){let e=[],t=0,r=[],i=[],a=[];function n(){t=0,r.length=0,i.length=0,a.length=0}function s(u,d,m,x,_,f){let p=e[t];return p===void 0?(p={id:u.id,object:u,geometry:d,material:m,groupOrder:x,renderOrder:u.renderOrder,z:_,group:f},e[t]=p):(p.id=u.id,p.object=u,p.geometry=d,p.material=m,p.groupOrder=x,p.renderOrder=u.renderOrder,p.z=_,p.group=f),t++,p}function o(u,d,m,x,_,f){let p=s(u,d,m,x,_,f);m.transmission>0?i.push(p):m.transparent===!0?a.push(p):r.push(p)}function l(u,d,m,x,_,f){let p=s(u,d,m,x,_,f);m.transmission>0?i.unshift(p):m.transparent===!0?a.unshift(p):r.unshift(p)}function h(u,d){r.length>1&&r.sort(u||$m),i.length>1&&i.sort(d||Fl),a.length>1&&a.sort(d||Fl)}function c(){for(let u=t,d=e.length;u<d;u++){let m=e[u];if(m.id===null)break;m.id=null,m.object=null,m.geometry=null,m.material=null,m.group=null}}return{opaque:r,transmissive:i,transparent:a,init:n,push:o,unshift:l,finish:c,sort:h}}function Qm(){let e=new WeakMap;function t(i,a){let n=e.get(i),s;return n===void 0?(s=new Bl,e.set(i,[s])):a>=n.length?(s=new Bl,n.push(s)):s=n[a],s}function r(){e=new WeakMap}return{get:t,dispose:r}}function eg(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let r;switch(t.type){case"DirectionalLight":r={direction:new z,color:new Qe};break;case"SpotLight":r={position:new z,direction:new z,color:new Qe,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":r={position:new z,color:new Qe,distance:0,decay:0};break;case"HemisphereLight":r={direction:new z,skyColor:new Qe,groundColor:new Qe};break;case"RectAreaLight":r={color:new Qe,position:new z,halfWidth:new z,halfHeight:new z};break}return e[t.id]=r,r}}}function tg(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let r;switch(t.type){case"DirectionalLight":r={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new ye};break;case"SpotLight":r={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new ye};break;case"PointLight":r={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new ye,shadowCameraNear:1,shadowCameraFar:1e3};break}return e[t.id]=r,r}}}var rg=0;function ig(e,t){return(t.castShadow?2:0)-(e.castShadow?2:0)+(t.map?1:0)-(e.map?1:0)}function ag(e){let t=new eg,r=tg(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let h=0;h<9;h++)i.probe.push(new z);let a=new z,n=new ft,s=new ft;function o(h){let c=0,u=0,d=0;for(let M=0;M<9;M++)i.probe[M].set(0,0,0);let m=0,x=0,_=0,f=0,p=0,A=0,S=0,b=0,C=0,L=0,U=0;h.sort(ig);for(let M=0,y=h.length;M<y;M++){let R=h[M],q=R.color,W=R.intensity,k=R.distance,ee=R.shadow&&R.shadow.map?R.shadow.map.texture:null;if(R.isAmbientLight)c+=q.r*W,u+=q.g*W,d+=q.b*W;else if(R.isLightProbe){for(let j=0;j<9;j++)i.probe[j].addScaledVector(R.sh.coefficients[j],W);U++}else if(R.isDirectionalLight){let j=t.get(R);if(j.color.copy(R.color).multiplyScalar(R.intensity),R.castShadow){let le=R.shadow,X=r.get(R);X.shadowIntensity=le.intensity,X.shadowBias=le.bias,X.shadowNormalBias=le.normalBias,X.shadowRadius=le.radius,X.shadowMapSize=le.mapSize,i.directionalShadow[m]=X,i.directionalShadowMap[m]=ee,i.directionalShadowMatrix[m]=R.shadow.matrix,A++}i.directional[m]=j,m++}else if(R.isSpotLight){let j=t.get(R);j.position.setFromMatrixPosition(R.matrixWorld),j.color.copy(q).multiplyScalar(W),j.distance=k,j.coneCos=Math.cos(R.angle),j.penumbraCos=Math.cos(R.angle*(1-R.penumbra)),j.decay=R.decay,i.spot[_]=j;let le=R.shadow;if(R.map&&(i.spotLightMap[C]=R.map,C++,le.updateMatrices(R),R.castShadow&&L++),i.spotLightMatrix[_]=le.matrix,R.castShadow){let X=r.get(R);X.shadowIntensity=le.intensity,X.shadowBias=le.bias,X.shadowNormalBias=le.normalBias,X.shadowRadius=le.radius,X.shadowMapSize=le.mapSize,i.spotShadow[_]=X,i.spotShadowMap[_]=ee,b++}_++}else if(R.isRectAreaLight){let j=t.get(R);j.color.copy(q).multiplyScalar(W),j.halfWidth.set(R.width*.5,0,0),j.halfHeight.set(0,R.height*.5,0),i.rectArea[f]=j,f++}else if(R.isPointLight){let j=t.get(R);if(j.color.copy(R.color).multiplyScalar(R.intensity),j.distance=R.distance,j.decay=R.decay,R.castShadow){let le=R.shadow,X=r.get(R);X.shadowIntensity=le.intensity,X.shadowBias=le.bias,X.shadowNormalBias=le.normalBias,X.shadowRadius=le.radius,X.shadowMapSize=le.mapSize,X.shadowCameraNear=le.camera.near,X.shadowCameraFar=le.camera.far,i.pointShadow[x]=X,i.pointShadowMap[x]=ee,i.pointShadowMatrix[x]=R.shadow.matrix,S++}i.point[x]=j,x++}else if(R.isHemisphereLight){let j=t.get(R);j.skyColor.copy(R.color).multiplyScalar(W),j.groundColor.copy(R.groundColor).multiplyScalar(W),i.hemi[p]=j,p++}}f>0&&(e.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=Me.LTC_FLOAT_1,i.rectAreaLTC2=Me.LTC_FLOAT_2):(i.rectAreaLTC1=Me.LTC_HALF_1,i.rectAreaLTC2=Me.LTC_HALF_2)),i.ambient[0]=c,i.ambient[1]=u,i.ambient[2]=d;let B=i.hash;(B.directionalLength!==m||B.pointLength!==x||B.spotLength!==_||B.rectAreaLength!==f||B.hemiLength!==p||B.numDirectionalShadows!==A||B.numPointShadows!==S||B.numSpotShadows!==b||B.numSpotMaps!==C||B.numLightProbes!==U)&&(i.directional.length=m,i.spot.length=_,i.rectArea.length=f,i.point.length=x,i.hemi.length=p,i.directionalShadow.length=A,i.directionalShadowMap.length=A,i.pointShadow.length=S,i.pointShadowMap.length=S,i.spotShadow.length=b,i.spotShadowMap.length=b,i.directionalShadowMatrix.length=A,i.pointShadowMatrix.length=S,i.spotLightMatrix.length=b+C-L,i.spotLightMap.length=C,i.numSpotLightShadowsWithMaps=L,i.numLightProbes=U,B.directionalLength=m,B.pointLength=x,B.spotLength=_,B.rectAreaLength=f,B.hemiLength=p,B.numDirectionalShadows=A,B.numPointShadows=S,B.numSpotShadows=b,B.numSpotMaps=C,B.numLightProbes=U,i.version=rg++)}function l(h,c){let u=0,d=0,m=0,x=0,_=0,f=c.matrixWorldInverse;for(let p=0,A=h.length;p<A;p++){let S=h[p];if(S.isDirectionalLight){let b=i.directional[u];b.direction.setFromMatrixPosition(S.matrixWorld),a.setFromMatrixPosition(S.target.matrixWorld),b.direction.sub(a),b.direction.transformDirection(f),u++}else if(S.isSpotLight){let b=i.spot[m];b.position.setFromMatrixPosition(S.matrixWorld),b.position.applyMatrix4(f),b.direction.setFromMatrixPosition(S.matrixWorld),a.setFromMatrixPosition(S.target.matrixWorld),b.direction.sub(a),b.direction.transformDirection(f),m++}else if(S.isRectAreaLight){let b=i.rectArea[x];b.position.setFromMatrixPosition(S.matrixWorld),b.position.applyMatrix4(f),s.identity(),n.copy(S.matrixWorld),n.premultiply(f),s.extractRotation(n),b.halfWidth.set(S.width*.5,0,0),b.halfHeight.set(0,S.height*.5,0),b.halfWidth.applyMatrix4(s),b.halfHeight.applyMatrix4(s),x++}else if(S.isPointLight){let b=i.point[d];b.position.setFromMatrixPosition(S.matrixWorld),b.position.applyMatrix4(f),d++}else if(S.isHemisphereLight){let b=i.hemi[_];b.direction.setFromMatrixPosition(S.matrixWorld),b.direction.transformDirection(f),_++}}}return{setup:o,setupView:l,state:i}}function zl(e){let t=new ag(e),r=[],i=[];function a(c){h.camera=c,r.length=0,i.length=0}function n(c){r.push(c)}function s(c){i.push(c)}function o(){t.setup(r)}function l(c){t.setupView(r,c)}let h={lightsArray:r,shadowsArray:i,camera:null,lights:t,transmissionRenderTarget:{}};return{init:a,state:h,setupLights:o,setupLightsView:l,pushLight:n,pushShadow:s}}function ng(e){let t=new WeakMap;function r(a,n=0){let s=t.get(a),o;return s===void 0?(o=new zl(e),t.set(a,[o])):n>=s.length?(o=new zl(e),s.push(o)):o=s[n],o}function i(){t=new WeakMap}return{get:r,dispose:i}}var sg=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,og=`uniform sampler2D shadow_pass;
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
}`;function lg(e,t,r){let i=new Es,a=new ye,n=new ye,s=new ct,o=new tu({depthPacking:Rh}),l=new ru,h={},c=r.maxTextureSize,u={[yr]:Rt,[Rt]:yr,[Wt]:Wt},d=new gr({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new ye},radius:{value:4}},vertexShader:sg,fragmentShader:og}),m=d.clone();m.defines.HORIZONTAL_PASS=1;let x=new Gr;x.setAttribute("position",new Kt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let _=new Zt(x,d),f=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Js;let p=this.type;this.render=function(L,U,B){if(f.enabled===!1||f.autoUpdate===!1&&f.needsUpdate===!1||L.length===0)return;let M=e.getRenderTarget(),y=e.getActiveCubeFace(),R=e.getActiveMipmapLevel(),q=e.state;q.setBlending(sr),q.buffers.depth.getReversed()===!0?q.buffers.color.setClear(0,0,0,0):q.buffers.color.setClear(1,1,1,1),q.buffers.depth.setTest(!0),q.setScissorTest(!1);let W=p!==nr&&this.type===nr,k=p===nr&&this.type!==nr;for(let ee=0,j=L.length;ee<j;ee++){let le=L[ee],X=le.shadow;if(X===void 0){ke("WebGLShadowMap:",le,"has no shadow.");continue}if(X.autoUpdate===!1&&X.needsUpdate===!1)continue;a.copy(X.mapSize);let ie=X.getFrameExtents();if(a.multiply(ie),n.copy(X.mapSize),(a.x>c||a.y>c)&&(a.x>c&&(n.x=Math.floor(c/ie.x),a.x=n.x*ie.x,X.mapSize.x=n.x),a.y>c&&(n.y=Math.floor(c/ie.y),a.y=n.y*ie.y,X.mapSize.y=n.y)),X.map===null||W===!0||k===!0){let Ge=this.type!==nr?{minFilter:Dt,magFilter:Dt}:{};X.map!==null&&X.map.dispose(),X.map=new zr(a.x,a.y,Ge),X.map.texture.name=le.name+".shadowMap",X.camera.updateProjectionMatrix()}e.setRenderTarget(X.map),e.clear();let Se=X.getViewportCount();for(let Ge=0;Ge<Se;Ge++){let ze=X.getViewport(Ge);s.set(n.x*ze.x,n.y*ze.y,n.x*ze.z,n.y*ze.w),q.viewport(s),X.updateMatrices(le,Ge),i=X.getFrustum(),b(U,B,X.camera,le,this.type)}X.isPointLightShadow!==!0&&this.type===nr&&A(X,B),X.needsUpdate=!1}p=this.type,f.needsUpdate=!1,e.setRenderTarget(M,y,R)};function A(L,U){let B=t.update(_);d.defines.VSM_SAMPLES!==L.blurSamples&&(d.defines.VSM_SAMPLES=L.blurSamples,m.defines.VSM_SAMPLES=L.blurSamples,d.needsUpdate=!0,m.needsUpdate=!0),L.mapPass===null&&(L.mapPass=new zr(a.x,a.y)),d.uniforms.shadow_pass.value=L.map.texture,d.uniforms.resolution.value=L.mapSize,d.uniforms.radius.value=L.radius,e.setRenderTarget(L.mapPass),e.clear(),e.renderBufferDirect(U,null,B,d,_,null),m.uniforms.shadow_pass.value=L.mapPass.texture,m.uniforms.resolution.value=L.mapSize,m.uniforms.radius.value=L.radius,e.setRenderTarget(L.map),e.clear(),e.renderBufferDirect(U,null,B,m,_,null)}function S(L,U,B,M){let y=null,R=B.isPointLight===!0?L.customDistanceMaterial:L.customDepthMaterial;if(R!==void 0)y=R;else if(y=B.isPointLight===!0?l:o,e.localClippingEnabled&&U.clipShadows===!0&&Array.isArray(U.clippingPlanes)&&U.clippingPlanes.length!==0||U.displacementMap&&U.displacementScale!==0||U.alphaMap&&U.alphaTest>0||U.map&&U.alphaTest>0||U.alphaToCoverage===!0){let q=y.uuid,W=U.uuid,k=h[q];k===void 0&&(k={},h[q]=k);let ee=k[W];ee===void 0&&(ee=y.clone(),k[W]=ee,U.addEventListener("dispose",C)),y=ee}if(y.visible=U.visible,y.wireframe=U.wireframe,M===nr?y.side=U.shadowSide!==null?U.shadowSide:U.side:y.side=U.shadowSide!==null?U.shadowSide:u[U.side],y.alphaMap=U.alphaMap,y.alphaTest=U.alphaToCoverage===!0?.5:U.alphaTest,y.map=U.map,y.clipShadows=U.clipShadows,y.clippingPlanes=U.clippingPlanes,y.clipIntersection=U.clipIntersection,y.displacementMap=U.displacementMap,y.displacementScale=U.displacementScale,y.displacementBias=U.displacementBias,y.wireframeLinewidth=U.wireframeLinewidth,y.linewidth=U.linewidth,B.isPointLight===!0&&y.isMeshDistanceMaterial===!0){let q=e.properties.get(y);q.light=B}return y}function b(L,U,B,M,y){if(L.visible===!1)return;if(L.layers.test(U.layers)&&(L.isMesh||L.isLine||L.isPoints)&&(L.castShadow||L.receiveShadow&&y===nr)&&(!L.frustumCulled||i.intersectsObject(L))){L.modelViewMatrix.multiplyMatrices(B.matrixWorldInverse,L.matrixWorld);let q=t.update(L),W=L.material;if(Array.isArray(W)){let k=q.groups;for(let ee=0,j=k.length;ee<j;ee++){let le=k[ee],X=W[le.materialIndex];if(X&&X.visible){let ie=S(L,X,M,y);L.onBeforeShadow(e,L,U,B,q,ie,le),e.renderBufferDirect(B,null,q,ie,L,le),L.onAfterShadow(e,L,U,B,q,ie,le)}}}else if(W.visible){let k=S(L,W,M,y);L.onBeforeShadow(e,L,U,B,q,k,null),e.renderBufferDirect(B,null,q,k,L,null),L.onAfterShadow(e,L,U,B,q,k,null)}}let R=L.children;for(let q=0,W=R.length;q<W;q++)b(R[q],U,B,M,y)}function C(L){L.target.removeEventListener("dispose",C);for(let U in h){let B=h[U],M=L.target.uuid;M in B&&(B[M].dispose(),delete B[M])}}}var hg={[en]:tn,[rn]:sn,[an]:on,[Zr]:nn,[tn]:en,[sn]:rn,[on]:an,[nn]:Zr};function cg(e,t){function r(){let N=!1,xe=new ct,ae=null,Ue=new ct(0,0,0,0);return{setMask:function(re){ae!==re&&!N&&(e.colorMask(re,re,re,re),ae=re)},setLocked:function(re){N=re},setClear:function(re,Q,Le,Fe,gt){gt===!0&&(re*=Fe,Q*=Fe,Le*=Fe),xe.set(re,Q,Le,Fe),Ue.equals(xe)===!1&&(e.clearColor(re,Q,Le,Fe),Ue.copy(xe))},reset:function(){N=!1,ae=null,Ue.set(-1,0,0,0)}}}function i(){let N=!1,xe=!1,ae=null,Ue=null,re=null;return{setReversed:function(Q){if(xe!==Q){let Le=t.get("EXT_clip_control");Q?Le.clipControlEXT(Le.LOWER_LEFT_EXT,Le.ZERO_TO_ONE_EXT):Le.clipControlEXT(Le.LOWER_LEFT_EXT,Le.NEGATIVE_ONE_TO_ONE_EXT),xe=Q;let Fe=re;re=null,this.setClear(Fe)}},getReversed:function(){return xe},setTest:function(Q){Q?ce(e.DEPTH_TEST):be(e.DEPTH_TEST)},setMask:function(Q){ae!==Q&&!N&&(e.depthMask(Q),ae=Q)},setFunc:function(Q){if(xe&&(Q=hg[Q]),Ue!==Q){switch(Q){case en:e.depthFunc(e.NEVER);break;case tn:e.depthFunc(e.ALWAYS);break;case rn:e.depthFunc(e.LESS);break;case Zr:e.depthFunc(e.LEQUAL);break;case an:e.depthFunc(e.EQUAL);break;case nn:e.depthFunc(e.GEQUAL);break;case sn:e.depthFunc(e.GREATER);break;case on:e.depthFunc(e.NOTEQUAL);break;default:e.depthFunc(e.LEQUAL)}Ue=Q}},setLocked:function(Q){N=Q},setClear:function(Q){re!==Q&&(xe&&(Q=1-Q),e.clearDepth(Q),re=Q)},reset:function(){N=!1,ae=null,Ue=null,re=null,xe=!1}}}function a(){let N=!1,xe=null,ae=null,Ue=null,re=null,Q=null,Le=null,Fe=null,gt=null;return{setTest:function(nt){N||(nt?ce(e.STENCIL_TEST):be(e.STENCIL_TEST))},setMask:function(nt){xe!==nt&&!N&&(e.stencilMask(nt),xe=nt)},setFunc:function(nt,Bt,Ht){(ae!==nt||Ue!==Bt||re!==Ht)&&(e.stencilFunc(nt,Bt,Ht),ae=nt,Ue=Bt,re=Ht)},setOp:function(nt,Bt,Ht){(Q!==nt||Le!==Bt||Fe!==Ht)&&(e.stencilOp(nt,Bt,Ht),Q=nt,Le=Bt,Fe=Ht)},setLocked:function(nt){N=nt},setClear:function(nt){gt!==nt&&(e.clearStencil(nt),gt=nt)},reset:function(){N=!1,xe=null,ae=null,Ue=null,re=null,Q=null,Le=null,Fe=null,gt=null}}}let n=new r,s=new i,o=new a,l=new WeakMap,h=new WeakMap,c={},u={},d=new WeakMap,m=[],x=null,_=!1,f=null,p=null,A=null,S=null,b=null,C=null,L=null,U=new Qe(0,0,0),B=0,M=!1,y=null,R=null,q=null,W=null,k=null,ee=e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS),j=!1,le=0,X=e.getParameter(e.VERSION);X.indexOf("WebGL")!==-1?(le=parseFloat(/^WebGL (\d)/.exec(X)[1]),j=le>=1):X.indexOf("OpenGL ES")!==-1&&(le=parseFloat(/^OpenGL ES (\d)/.exec(X)[1]),j=le>=2);let ie=null,Se={},Ge=e.getParameter(e.SCISSOR_BOX),ze=e.getParameter(e.VIEWPORT),it=new ct().fromArray(Ge),tt=new ct().fromArray(ze);function K(N,xe,ae,Ue){let re=new Uint8Array(4),Q=e.createTexture();e.bindTexture(N,Q),e.texParameteri(N,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(N,e.TEXTURE_MAG_FILTER,e.NEAREST);for(let Le=0;Le<ae;Le++)N===e.TEXTURE_3D||N===e.TEXTURE_2D_ARRAY?e.texImage3D(xe,0,e.RGBA,1,1,Ue,0,e.RGBA,e.UNSIGNED_BYTE,re):e.texImage2D(xe+Le,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,re);return Q}let fe={};fe[e.TEXTURE_2D]=K(e.TEXTURE_2D,e.TEXTURE_2D,1),fe[e.TEXTURE_CUBE_MAP]=K(e.TEXTURE_CUBE_MAP,e.TEXTURE_CUBE_MAP_POSITIVE_X,6),fe[e.TEXTURE_2D_ARRAY]=K(e.TEXTURE_2D_ARRAY,e.TEXTURE_2D_ARRAY,1,1),fe[e.TEXTURE_3D]=K(e.TEXTURE_3D,e.TEXTURE_3D,1,1),n.setClear(0,0,0,1),s.setClear(1),o.setClear(0),ce(e.DEPTH_TEST),s.setFunc(Zr),se(!1),me(Ys),ce(e.CULL_FACE),T(sr);function ce(N){c[N]!==!0&&(e.enable(N),c[N]=!0)}function be(N){c[N]!==!1&&(e.disable(N),c[N]=!1)}function Ve(N,xe){return u[N]!==xe?(e.bindFramebuffer(N,xe),u[N]=xe,N===e.DRAW_FRAMEBUFFER&&(u[e.FRAMEBUFFER]=xe),N===e.FRAMEBUFFER&&(u[e.DRAW_FRAMEBUFFER]=xe),!0):!1}function Ae(N,xe){let ae=m,Ue=!1;if(N){ae=d.get(xe),ae===void 0&&(ae=[],d.set(xe,ae));let re=N.textures;if(ae.length!==re.length||ae[0]!==e.COLOR_ATTACHMENT0){for(let Q=0,Le=re.length;Q<Le;Q++)ae[Q]=e.COLOR_ATTACHMENT0+Q;ae.length=re.length,Ue=!0}}else ae[0]!==e.BACK&&(ae[0]=e.BACK,Ue=!0);Ue&&e.drawBuffers(ae)}function je(N){return x!==N?(e.useProgram(N),x=N,!0):!1}let qe={[Or]:e.FUNC_ADD,[rh]:e.FUNC_SUBTRACT,[ih]:e.FUNC_REVERSE_SUBTRACT};qe[ah]=e.MIN,qe[nh]=e.MAX;let Z={[sh]:e.ZERO,[oh]:e.ONE,[lh]:e.SRC_COLOR,[$a]:e.SRC_ALPHA,[fh]:e.SRC_ALPHA_SATURATE,[dh]:e.DST_COLOR,[ch]:e.DST_ALPHA,[hh]:e.ONE_MINUS_SRC_COLOR,[Qa]:e.ONE_MINUS_SRC_ALPHA,[ph]:e.ONE_MINUS_DST_COLOR,[uh]:e.ONE_MINUS_DST_ALPHA,[mh]:e.CONSTANT_COLOR,[gh]:e.ONE_MINUS_CONSTANT_COLOR,[_h]:e.CONSTANT_ALPHA,[vh]:e.ONE_MINUS_CONSTANT_ALPHA};function T(N,xe,ae,Ue,re,Q,Le,Fe,gt,nt){if(N===sr){_===!0&&(be(e.BLEND),_=!1);return}if(_===!1&&(ce(e.BLEND),_=!0),N!==th){if(N!==f||nt!==M){if((p!==Or||b!==Or)&&(e.blendEquation(e.FUNC_ADD),p=Or,b=Or),nt)switch(N){case Kr:e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case Za:e.blendFunc(e.ONE,e.ONE);break;case Ks:e.blendFuncSeparate(e.ZERO,e.ONE_MINUS_SRC_COLOR,e.ZERO,e.ONE);break;case Zs:e.blendFuncSeparate(e.DST_COLOR,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE);break;default:$e("WebGLState: Invalid blending: ",N);break}else switch(N){case Kr:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case Za:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE,e.ONE,e.ONE);break;case Ks:$e("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Zs:$e("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:$e("WebGLState: Invalid blending: ",N);break}A=null,S=null,C=null,L=null,U.set(0,0,0),B=0,f=N,M=nt}return}re=re||xe,Q=Q||ae,Le=Le||Ue,(xe!==p||re!==b)&&(e.blendEquationSeparate(qe[xe],qe[re]),p=xe,b=re),(ae!==A||Ue!==S||Q!==C||Le!==L)&&(e.blendFuncSeparate(Z[ae],Z[Ue],Z[Q],Z[Le]),A=ae,S=Ue,C=Q,L=Le),(Fe.equals(U)===!1||gt!==B)&&(e.blendColor(Fe.r,Fe.g,Fe.b,gt),U.copy(Fe),B=gt),f=N,M=!1}function de(N,xe){N.side===Wt?be(e.CULL_FACE):ce(e.CULL_FACE);let ae=N.side===Rt;xe&&(ae=!ae),se(ae),N.blending===Kr&&N.transparent===!1?T(sr):T(N.blending,N.blendEquation,N.blendSrc,N.blendDst,N.blendEquationAlpha,N.blendSrcAlpha,N.blendDstAlpha,N.blendColor,N.blendAlpha,N.premultipliedAlpha),s.setFunc(N.depthFunc),s.setTest(N.depthTest),s.setMask(N.depthWrite),n.setMask(N.colorWrite);let Ue=N.stencilWrite;o.setTest(Ue),Ue&&(o.setMask(N.stencilWriteMask),o.setFunc(N.stencilFunc,N.stencilRef,N.stencilFuncMask),o.setOp(N.stencilFail,N.stencilZFail,N.stencilZPass)),Ee(N.polygonOffset,N.polygonOffsetFactor,N.polygonOffsetUnits),N.alphaToCoverage===!0?ce(e.SAMPLE_ALPHA_TO_COVERAGE):be(e.SAMPLE_ALPHA_TO_COVERAGE)}function se(N){y!==N&&(N?e.frontFace(e.CW):e.frontFace(e.CCW),y=N)}function me(N){N!==$l?(ce(e.CULL_FACE),N!==R&&(N===Ys?e.cullFace(e.BACK):N===Ql?e.cullFace(e.FRONT):e.cullFace(e.FRONT_AND_BACK))):be(e.CULL_FACE),R=N}function oe(N){N!==q&&(j&&e.lineWidth(N),q=N)}function Ee(N,xe,ae){N?(ce(e.POLYGON_OFFSET_FILL),(W!==xe||k!==ae)&&(e.polygonOffset(xe,ae),W=xe,k=ae)):be(e.POLYGON_OFFSET_FILL)}function ge(N){N?ce(e.SCISSOR_TEST):be(e.SCISSOR_TEST)}function Ce(N){N===void 0&&(N=e.TEXTURE0+ee-1),ie!==N&&(e.activeTexture(N),ie=N)}function We(N,xe,ae){ae===void 0&&(ie===null?ae=e.TEXTURE0+ee-1:ae=ie);let Ue=Se[ae];Ue===void 0&&(Ue={type:void 0,texture:void 0},Se[ae]=Ue),(Ue.type!==N||Ue.texture!==xe)&&(ie!==ae&&(e.activeTexture(ae),ie=ae),e.bindTexture(N,xe||fe[N]),Ue.type=N,Ue.texture=xe)}function E(){let N=Se[ie];N!==void 0&&N.type!==void 0&&(e.bindTexture(N.type,null),N.type=void 0,N.texture=void 0)}function v(){try{e.compressedTexImage2D(...arguments)}catch(N){N("WebGLState:",N)}}function F(){try{e.compressedTexImage3D(...arguments)}catch(N){N("WebGLState:",N)}}function Y(){try{e.texSubImage2D(...arguments)}catch(N){N("WebGLState:",N)}}function $(){try{e.texSubImage3D(...arguments)}catch(N){N("WebGLState:",N)}}function J(){try{e.compressedTexSubImage2D(...arguments)}catch(N){N("WebGLState:",N)}}function De(){try{e.compressedTexSubImage3D(...arguments)}catch(N){N("WebGLState:",N)}}function _e(){try{e.texStorage2D(...arguments)}catch(N){N("WebGLState:",N)}}function Re(){try{e.texStorage3D(...arguments)}catch(N){N("WebGLState:",N)}}function we(){try{e.texImage2D(...arguments)}catch(N){N("WebGLState:",N)}}function te(){try{e.texImage3D(...arguments)}catch(N){N("WebGLState:",N)}}function Te(N){it.equals(N)===!1&&(e.scissor(N.x,N.y,N.z,N.w),it.copy(N))}function Xe(N){tt.equals(N)===!1&&(e.viewport(N.x,N.y,N.z,N.w),tt.copy(N))}function Be(N,xe){let ae=h.get(xe);ae===void 0&&(ae=new WeakMap,h.set(xe,ae));let Ue=ae.get(N);Ue===void 0&&(Ue=e.getUniformBlockIndex(xe,N.name),ae.set(N,Ue))}function ve(N,xe){let ae=h.get(xe).get(N);l.get(xe)!==ae&&(e.uniformBlockBinding(xe,ae,N.__bindingPointIndex),l.set(xe,ae))}function He(){e.disable(e.BLEND),e.disable(e.CULL_FACE),e.disable(e.DEPTH_TEST),e.disable(e.POLYGON_OFFSET_FILL),e.disable(e.SCISSOR_TEST),e.disable(e.STENCIL_TEST),e.disable(e.SAMPLE_ALPHA_TO_COVERAGE),e.blendEquation(e.FUNC_ADD),e.blendFunc(e.ONE,e.ZERO),e.blendFuncSeparate(e.ONE,e.ZERO,e.ONE,e.ZERO),e.blendColor(0,0,0,0),e.colorMask(!0,!0,!0,!0),e.clearColor(0,0,0,0),e.depthMask(!0),e.depthFunc(e.LESS),s.setReversed(!1),e.clearDepth(1),e.stencilMask(4294967295),e.stencilFunc(e.ALWAYS,0,4294967295),e.stencilOp(e.KEEP,e.KEEP,e.KEEP),e.clearStencil(0),e.cullFace(e.BACK),e.frontFace(e.CCW),e.polygonOffset(0,0),e.activeTexture(e.TEXTURE0),e.bindFramebuffer(e.FRAMEBUFFER,null),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),e.bindFramebuffer(e.READ_FRAMEBUFFER,null),e.useProgram(null),e.lineWidth(1),e.scissor(0,0,e.canvas.width,e.canvas.height),e.viewport(0,0,e.canvas.width,e.canvas.height),c={},ie=null,Se={},u={},d=new WeakMap,m=[],x=null,_=!1,f=null,p=null,A=null,S=null,b=null,C=null,L=null,U=new Qe(0,0,0),B=0,M=!1,y=null,R=null,q=null,W=null,k=null,it.set(0,0,e.canvas.width,e.canvas.height),tt.set(0,0,e.canvas.width,e.canvas.height),n.reset(),s.reset(),o.reset()}return{buffers:{color:n,depth:s,stencil:o},enable:ce,disable:be,bindFramebuffer:Ve,drawBuffers:Ae,useProgram:je,setBlending:T,setMaterial:de,setFlipSided:se,setCullFace:me,setLineWidth:oe,setPolygonOffset:Ee,setScissorTest:ge,activeTexture:Ce,bindTexture:We,unbindTexture:E,compressedTexImage2D:v,compressedTexImage3D:F,texImage2D:we,texImage3D:te,updateUBOMapping:Be,uniformBlockBinding:ve,texStorage2D:_e,texStorage3D:Re,texSubImage2D:Y,texSubImage3D:$,compressedTexSubImage2D:J,compressedTexSubImage3D:De,scissor:Te,viewport:Xe,reset:He}}function ug(e,t,r,i,a,n,s){let o=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),h=new ye,c=new WeakMap,u,d=new WeakMap,m=!1;try{m=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function x(E,v){return m?new OffscreenCanvas(E,v):Fi("canvas")}function _(E,v,F){let Y=1,$=We(E);if(($.width>F||$.height>F)&&(Y=F/Math.max($.width,$.height)),Y<1)if(typeof HTMLImageElement<"u"&&E instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&E instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&E instanceof ImageBitmap||typeof VideoFrame<"u"&&E instanceof VideoFrame){let J=Math.floor(Y*$.width),De=Math.floor(Y*$.height);u===void 0&&(u=x(J,De));let _e=v?x(J,De):u;return _e.width=J,_e.height=De,_e.getContext("2d").drawImage(E,0,0,J,De),ke("WebGLRenderer: Texture has been resized from ("+$.width+"x"+$.height+") to ("+J+"x"+De+")."),_e}else return"data"in E&&ke("WebGLRenderer: Image in DataTexture is too big ("+$.width+"x"+$.height+")."),E;return E}function f(E){return E.generateMipmaps}function p(E){e.generateMipmap(E)}function A(E){return E.isWebGLCubeRenderTarget?e.TEXTURE_CUBE_MAP:E.isWebGL3DRenderTarget?e.TEXTURE_3D:E.isWebGLArrayRenderTarget||E.isCompressedArrayTexture?e.TEXTURE_2D_ARRAY:e.TEXTURE_2D}function S(E,v,F,Y,$=!1){if(E!==null){if(e[E]!==void 0)return e[E];ke("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+E+"'")}let J=v;if(v===e.RED&&(F===e.FLOAT&&(J=e.R32F),F===e.HALF_FLOAT&&(J=e.R16F),F===e.UNSIGNED_BYTE&&(J=e.R8)),v===e.RED_INTEGER&&(F===e.UNSIGNED_BYTE&&(J=e.R8UI),F===e.UNSIGNED_SHORT&&(J=e.R16UI),F===e.UNSIGNED_INT&&(J=e.R32UI),F===e.BYTE&&(J=e.R8I),F===e.SHORT&&(J=e.R16I),F===e.INT&&(J=e.R32I)),v===e.RG&&(F===e.FLOAT&&(J=e.RG32F),F===e.HALF_FLOAT&&(J=e.RG16F),F===e.UNSIGNED_BYTE&&(J=e.RG8)),v===e.RG_INTEGER&&(F===e.UNSIGNED_BYTE&&(J=e.RG8UI),F===e.UNSIGNED_SHORT&&(J=e.RG16UI),F===e.UNSIGNED_INT&&(J=e.RG32UI),F===e.BYTE&&(J=e.RG8I),F===e.SHORT&&(J=e.RG16I),F===e.INT&&(J=e.RG32I)),v===e.RGB_INTEGER&&(F===e.UNSIGNED_BYTE&&(J=e.RGB8UI),F===e.UNSIGNED_SHORT&&(J=e.RGB16UI),F===e.UNSIGNED_INT&&(J=e.RGB32UI),F===e.BYTE&&(J=e.RGB8I),F===e.SHORT&&(J=e.RGB16I),F===e.INT&&(J=e.RGB32I)),v===e.RGBA_INTEGER&&(F===e.UNSIGNED_BYTE&&(J=e.RGBA8UI),F===e.UNSIGNED_SHORT&&(J=e.RGBA16UI),F===e.UNSIGNED_INT&&(J=e.RGBA32UI),F===e.BYTE&&(J=e.RGBA8I),F===e.SHORT&&(J=e.RGBA16I),F===e.INT&&(J=e.RGBA32I)),v===e.RGB&&(F===e.UNSIGNED_INT_5_9_9_9_REV&&(J=e.RGB9_E5),F===e.UNSIGNED_INT_10F_11F_11F_REV&&(J=e.R11F_G11F_B10F)),v===e.RGBA){let De=$?fa:at.getTransfer(Y);F===e.FLOAT&&(J=e.RGBA32F),F===e.HALF_FLOAT&&(J=e.RGBA16F),F===e.UNSIGNED_BYTE&&(J=De===lt?e.SRGB8_ALPHA8:e.RGBA8),F===e.UNSIGNED_SHORT_4_4_4_4&&(J=e.RGBA4),F===e.UNSIGNED_SHORT_5_5_5_1&&(J=e.RGB5_A1)}return(J===e.R16F||J===e.R32F||J===e.RG16F||J===e.RG32F||J===e.RGBA16F||J===e.RGBA32F)&&t.get("EXT_color_buffer_float"),J}function b(E,v){let F;return E?v===null||v===Fr||v===Di?F=e.DEPTH24_STENCIL8:v===Vt?F=e.DEPTH32F_STENCIL8:v===Ui&&(F=e.DEPTH24_STENCIL8,ke("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):v===null||v===Fr||v===Di?F=e.DEPTH_COMPONENT24:v===Vt?F=e.DEPTH_COMPONENT32F:v===Ui&&(F=e.DEPTH_COMPONENT16),F}function C(E,v){return f(E)===!0||E.isFramebufferTexture&&E.minFilter!==Dt&&E.minFilter!==St?Math.log2(Math.max(v.width,v.height))+1:E.mipmaps!==void 0&&E.mipmaps.length>0?E.mipmaps.length:E.isCompressedTexture&&Array.isArray(E.image)?v.mipmaps.length:1}function L(E){let v=E.target;v.removeEventListener("dispose",L),B(v),v.isVideoTexture&&c.delete(v)}function U(E){let v=E.target;v.removeEventListener("dispose",U),y(v)}function B(E){let v=i.get(E);if(v.__webglInit===void 0)return;let F=E.source,Y=d.get(F);if(Y){let $=Y[v.__cacheKey];$.usedTimes--,$.usedTimes===0&&M(E),Object.keys(Y).length===0&&d.delete(F)}i.remove(E)}function M(E){let v=i.get(E);e.deleteTexture(v.__webglTexture);let F=E.source,Y=d.get(F);delete Y[v.__cacheKey],s.memory.textures--}function y(E){let v=i.get(E);if(E.depthTexture&&(E.depthTexture.dispose(),i.remove(E.depthTexture)),E.isWebGLCubeRenderTarget)for(let Y=0;Y<6;Y++){if(Array.isArray(v.__webglFramebuffer[Y]))for(let $=0;$<v.__webglFramebuffer[Y].length;$++)e.deleteFramebuffer(v.__webglFramebuffer[Y][$]);else e.deleteFramebuffer(v.__webglFramebuffer[Y]);v.__webglDepthbuffer&&e.deleteRenderbuffer(v.__webglDepthbuffer[Y])}else{if(Array.isArray(v.__webglFramebuffer))for(let Y=0;Y<v.__webglFramebuffer.length;Y++)e.deleteFramebuffer(v.__webglFramebuffer[Y]);else e.deleteFramebuffer(v.__webglFramebuffer);if(v.__webglDepthbuffer&&e.deleteRenderbuffer(v.__webglDepthbuffer),v.__webglMultisampledFramebuffer&&e.deleteFramebuffer(v.__webglMultisampledFramebuffer),v.__webglColorRenderbuffer)for(let Y=0;Y<v.__webglColorRenderbuffer.length;Y++)v.__webglColorRenderbuffer[Y]&&e.deleteRenderbuffer(v.__webglColorRenderbuffer[Y]);v.__webglDepthRenderbuffer&&e.deleteRenderbuffer(v.__webglDepthRenderbuffer)}let F=E.textures;for(let Y=0,$=F.length;Y<$;Y++){let J=i.get(F[Y]);J.__webglTexture&&(e.deleteTexture(J.__webglTexture),s.memory.textures--),i.remove(F[Y])}i.remove(E)}let R=0;function q(){R=0}function W(){let E=R;return E>=a.maxTextures&&ke("WebGLTextures: Trying to use "+E+" texture units while this GPU supports only "+a.maxTextures),R+=1,E}function k(E){let v=[];return v.push(E.wrapS),v.push(E.wrapT),v.push(E.wrapR||0),v.push(E.magFilter),v.push(E.minFilter),v.push(E.anisotropy),v.push(E.internalFormat),v.push(E.format),v.push(E.type),v.push(E.generateMipmaps),v.push(E.premultiplyAlpha),v.push(E.flipY),v.push(E.unpackAlignment),v.push(E.colorSpace),v.join()}function ee(E,v){let F=i.get(E);if(E.isVideoTexture&&ge(E),E.isRenderTargetTexture===!1&&E.isExternalTexture!==!0&&E.version>0&&F.__version!==E.version){let Y=E.image;if(Y===null)ke("WebGLRenderer: Texture marked for update but no image data found.");else if(Y.complete===!1)ke("WebGLRenderer: Texture marked for update but image is incomplete");else{fe(F,E,v);return}}else E.isExternalTexture&&(F.__webglTexture=E.sourceTexture?E.sourceTexture:null);r.bindTexture(e.TEXTURE_2D,F.__webglTexture,e.TEXTURE0+v)}function j(E,v){let F=i.get(E);if(E.isRenderTargetTexture===!1&&E.version>0&&F.__version!==E.version){fe(F,E,v);return}else E.isExternalTexture&&(F.__webglTexture=E.sourceTexture?E.sourceTexture:null);r.bindTexture(e.TEXTURE_2D_ARRAY,F.__webglTexture,e.TEXTURE0+v)}function le(E,v){let F=i.get(E);if(E.isRenderTargetTexture===!1&&E.version>0&&F.__version!==E.version){fe(F,E,v);return}r.bindTexture(e.TEXTURE_3D,F.__webglTexture,e.TEXTURE0+v)}function X(E,v){let F=i.get(E);if(E.version>0&&F.__version!==E.version){ce(F,E,v);return}r.bindTexture(e.TEXTURE_CUBE_MAP,F.__webglTexture,e.TEXTURE0+v)}let ie={[Ni]:e.REPEAT,[Xt]:e.CLAMP_TO_EDGE,[cn]:e.MIRRORED_REPEAT},Se={[Dt]:e.NEAREST,[Ah]:e.NEAREST_MIPMAP_NEAREST,[la]:e.NEAREST_MIPMAP_LINEAR,[St]:e.LINEAR,[un]:e.LINEAR_MIPMAP_NEAREST,[Tr]:e.LINEAR_MIPMAP_LINEAR},Ge={[Lh]:e.NEVER,[Fh]:e.ALWAYS,[Nh]:e.LESS,[po]:e.LEQUAL,[Uh]:e.EQUAL,[Oh]:e.GEQUAL,[Dh]:e.GREATER,[Ih]:e.NOTEQUAL};function ze(E,v){if(v.type===Vt&&t.has("OES_texture_float_linear")===!1&&(v.magFilter===St||v.magFilter===un||v.magFilter===la||v.magFilter===Tr||v.minFilter===St||v.minFilter===un||v.minFilter===la||v.minFilter===Tr)&&ke("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),e.texParameteri(E,e.TEXTURE_WRAP_S,ie[v.wrapS]),e.texParameteri(E,e.TEXTURE_WRAP_T,ie[v.wrapT]),(E===e.TEXTURE_3D||E===e.TEXTURE_2D_ARRAY)&&e.texParameteri(E,e.TEXTURE_WRAP_R,ie[v.wrapR]),e.texParameteri(E,e.TEXTURE_MAG_FILTER,Se[v.magFilter]),e.texParameteri(E,e.TEXTURE_MIN_FILTER,Se[v.minFilter]),v.compareFunction&&(e.texParameteri(E,e.TEXTURE_COMPARE_MODE,e.COMPARE_REF_TO_TEXTURE),e.texParameteri(E,e.TEXTURE_COMPARE_FUNC,Ge[v.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(v.magFilter===Dt||v.minFilter!==la&&v.minFilter!==Tr||v.type===Vt&&t.has("OES_texture_float_linear")===!1)return;if(v.anisotropy>1||i.get(v).__currentAnisotropy){let F=t.get("EXT_texture_filter_anisotropic");e.texParameterf(E,F.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(v.anisotropy,a.getMaxAnisotropy())),i.get(v).__currentAnisotropy=v.anisotropy}}}function it(E,v){let F=!1;E.__webglInit===void 0&&(E.__webglInit=!0,v.addEventListener("dispose",L));let Y=v.source,$=d.get(Y);$===void 0&&($={},d.set(Y,$));let J=k(v);if(J!==E.__cacheKey){$[J]===void 0&&($[J]={texture:e.createTexture(),usedTimes:0},s.memory.textures++,F=!0),$[J].usedTimes++;let De=$[E.__cacheKey];De!==void 0&&($[E.__cacheKey].usedTimes--,De.usedTimes===0&&M(v)),E.__cacheKey=J,E.__webglTexture=$[J].texture}return F}function tt(E,v,F){return Math.floor(Math.floor(E/F)/v)}function K(E,v,F,Y){let $=E.updateRanges;if($.length===0)r.texSubImage2D(e.TEXTURE_2D,0,0,0,v.width,v.height,F,Y,v.data);else{$.sort((we,te)=>we.start-te.start);let J=0;for(let we=1;we<$.length;we++){let te=$[J],Te=$[we],Xe=te.start+te.count,Be=tt(Te.start,v.width,4),ve=tt(te.start,v.width,4);Te.start<=Xe+1&&Be===ve&&tt(Te.start+Te.count-1,v.width,4)===Be?te.count=Math.max(te.count,Te.start+Te.count-te.start):(++J,$[J]=Te)}$.length=J+1;let De=e.getParameter(e.UNPACK_ROW_LENGTH),_e=e.getParameter(e.UNPACK_SKIP_PIXELS),Re=e.getParameter(e.UNPACK_SKIP_ROWS);e.pixelStorei(e.UNPACK_ROW_LENGTH,v.width);for(let we=0,te=$.length;we<te;we++){let Te=$[we],Xe=Math.floor(Te.start/4),Be=Math.ceil(Te.count/4),ve=Xe%v.width,He=Math.floor(Xe/v.width),N=Be;e.pixelStorei(e.UNPACK_SKIP_PIXELS,ve),e.pixelStorei(e.UNPACK_SKIP_ROWS,He),r.texSubImage2D(e.TEXTURE_2D,0,ve,He,N,1,F,Y,v.data)}E.clearUpdateRanges(),e.pixelStorei(e.UNPACK_ROW_LENGTH,De),e.pixelStorei(e.UNPACK_SKIP_PIXELS,_e),e.pixelStorei(e.UNPACK_SKIP_ROWS,Re)}}function fe(E,v,F){let Y=e.TEXTURE_2D;(v.isDataArrayTexture||v.isCompressedArrayTexture)&&(Y=e.TEXTURE_2D_ARRAY),v.isData3DTexture&&(Y=e.TEXTURE_3D);let $=it(E,v),J=v.source;r.bindTexture(Y,E.__webglTexture,e.TEXTURE0+F);let De=i.get(J);if(J.version!==De.__version||$===!0){r.activeTexture(e.TEXTURE0+F);let _e=at.getPrimaries(at.workingColorSpace),Re=v.colorSpace===Er?null:at.getPrimaries(v.colorSpace),we=v.colorSpace===Er||_e===Re?e.NONE:e.BROWSER_DEFAULT_WEBGL;e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,v.flipY),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),e.pixelStorei(e.UNPACK_ALIGNMENT,v.unpackAlignment),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,we);let te=_(v.image,!1,a.maxTextureSize);te=Ce(v,te);let Te=n.convert(v.format,v.colorSpace),Xe=n.convert(v.type),Be=S(v.internalFormat,Te,Xe,v.colorSpace,v.isVideoTexture);ze(Y,v);let ve,He=v.mipmaps,N=v.isVideoTexture!==!0,xe=De.__version===void 0||$===!0,ae=J.dataReady,Ue=C(v,te);if(v.isDepthTexture)Be=b(v.format===Oi,v.type),xe&&(N?r.texStorage2D(e.TEXTURE_2D,1,Be,te.width,te.height):r.texImage2D(e.TEXTURE_2D,0,Be,te.width,te.height,0,Te,Xe,null));else if(v.isDataTexture)if(He.length>0){N&&xe&&r.texStorage2D(e.TEXTURE_2D,Ue,Be,He[0].width,He[0].height);for(let re=0,Q=He.length;re<Q;re++)ve=He[re],N?ae&&r.texSubImage2D(e.TEXTURE_2D,re,0,0,ve.width,ve.height,Te,Xe,ve.data):r.texImage2D(e.TEXTURE_2D,re,Be,ve.width,ve.height,0,Te,Xe,ve.data);v.generateMipmaps=!1}else N?(xe&&r.texStorage2D(e.TEXTURE_2D,Ue,Be,te.width,te.height),ae&&K(v,te,Te,Xe)):r.texImage2D(e.TEXTURE_2D,0,Be,te.width,te.height,0,Te,Xe,te.data);else if(v.isCompressedTexture)if(v.isCompressedArrayTexture){N&&xe&&r.texStorage3D(e.TEXTURE_2D_ARRAY,Ue,Be,He[0].width,He[0].height,te.depth);for(let re=0,Q=He.length;re<Q;re++)if(ve=He[re],v.format!==qt)if(Te!==null)if(N){if(ae)if(v.layerUpdates.size>0){let Le=dl(ve.width,ve.height,v.format,v.type);for(let Fe of v.layerUpdates){let gt=ve.data.subarray(Fe*Le/ve.data.BYTES_PER_ELEMENT,(Fe+1)*Le/ve.data.BYTES_PER_ELEMENT);r.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,re,0,0,Fe,ve.width,ve.height,1,Te,gt)}v.clearLayerUpdates()}else r.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,re,0,0,0,ve.width,ve.height,te.depth,Te,ve.data)}else r.compressedTexImage3D(e.TEXTURE_2D_ARRAY,re,Be,ve.width,ve.height,te.depth,0,ve.data,0,0);else ke("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else N?ae&&r.texSubImage3D(e.TEXTURE_2D_ARRAY,re,0,0,0,ve.width,ve.height,te.depth,Te,Xe,ve.data):r.texImage3D(e.TEXTURE_2D_ARRAY,re,Be,ve.width,ve.height,te.depth,0,Te,Xe,ve.data)}else{N&&xe&&r.texStorage2D(e.TEXTURE_2D,Ue,Be,He[0].width,He[0].height);for(let re=0,Q=He.length;re<Q;re++)ve=He[re],v.format!==qt?Te!==null?N?ae&&r.compressedTexSubImage2D(e.TEXTURE_2D,re,0,0,ve.width,ve.height,Te,ve.data):r.compressedTexImage2D(e.TEXTURE_2D,re,Be,ve.width,ve.height,0,ve.data):ke("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):N?ae&&r.texSubImage2D(e.TEXTURE_2D,re,0,0,ve.width,ve.height,Te,Xe,ve.data):r.texImage2D(e.TEXTURE_2D,re,Be,ve.width,ve.height,0,Te,Xe,ve.data)}else if(v.isDataArrayTexture)if(N){if(xe&&r.texStorage3D(e.TEXTURE_2D_ARRAY,Ue,Be,te.width,te.height,te.depth),ae)if(v.layerUpdates.size>0){let re=dl(te.width,te.height,v.format,v.type);for(let Q of v.layerUpdates){let Le=te.data.subarray(Q*re/te.data.BYTES_PER_ELEMENT,(Q+1)*re/te.data.BYTES_PER_ELEMENT);r.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,Q,te.width,te.height,1,Te,Xe,Le)}v.clearLayerUpdates()}else r.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,0,te.width,te.height,te.depth,Te,Xe,te.data)}else r.texImage3D(e.TEXTURE_2D_ARRAY,0,Be,te.width,te.height,te.depth,0,Te,Xe,te.data);else if(v.isData3DTexture)N?(xe&&r.texStorage3D(e.TEXTURE_3D,Ue,Be,te.width,te.height,te.depth),ae&&r.texSubImage3D(e.TEXTURE_3D,0,0,0,0,te.width,te.height,te.depth,Te,Xe,te.data)):r.texImage3D(e.TEXTURE_3D,0,Be,te.width,te.height,te.depth,0,Te,Xe,te.data);else if(v.isFramebufferTexture){if(xe)if(N)r.texStorage2D(e.TEXTURE_2D,Ue,Be,te.width,te.height);else{let re=te.width,Q=te.height;for(let Le=0;Le<Ue;Le++)r.texImage2D(e.TEXTURE_2D,Le,Be,re,Q,0,Te,Xe,null),re>>=1,Q>>=1}}else if(He.length>0){if(N&&xe){let re=We(He[0]);r.texStorage2D(e.TEXTURE_2D,Ue,Be,re.width,re.height)}for(let re=0,Q=He.length;re<Q;re++)ve=He[re],N?ae&&r.texSubImage2D(e.TEXTURE_2D,re,0,0,Te,Xe,ve):r.texImage2D(e.TEXTURE_2D,re,Be,Te,Xe,ve);v.generateMipmaps=!1}else if(N){if(xe){let re=We(te);r.texStorage2D(e.TEXTURE_2D,Ue,Be,re.width,re.height)}ae&&r.texSubImage2D(e.TEXTURE_2D,0,0,0,Te,Xe,te)}else r.texImage2D(e.TEXTURE_2D,0,Be,Te,Xe,te);f(v)&&p(Y),De.__version=J.version,v.onUpdate&&v.onUpdate(v)}E.__version=v.version}function ce(E,v,F){if(v.image.length!==6)return;let Y=it(E,v),$=v.source;r.bindTexture(e.TEXTURE_CUBE_MAP,E.__webglTexture,e.TEXTURE0+F);let J=i.get($);if($.version!==J.__version||Y===!0){r.activeTexture(e.TEXTURE0+F);let De=at.getPrimaries(at.workingColorSpace),_e=v.colorSpace===Er?null:at.getPrimaries(v.colorSpace),Re=v.colorSpace===Er||De===_e?e.NONE:e.BROWSER_DEFAULT_WEBGL;e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,v.flipY),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),e.pixelStorei(e.UNPACK_ALIGNMENT,v.unpackAlignment),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,Re);let we=v.isCompressedTexture||v.image[0].isCompressedTexture,te=v.image[0]&&v.image[0].isDataTexture,Te=[];for(let Q=0;Q<6;Q++)!we&&!te?Te[Q]=_(v.image[Q],!0,a.maxCubemapSize):Te[Q]=te?v.image[Q].image:v.image[Q],Te[Q]=Ce(v,Te[Q]);let Xe=Te[0],Be=n.convert(v.format,v.colorSpace),ve=n.convert(v.type),He=S(v.internalFormat,Be,ve,v.colorSpace),N=v.isVideoTexture!==!0,xe=J.__version===void 0||Y===!0,ae=$.dataReady,Ue=C(v,Xe);ze(e.TEXTURE_CUBE_MAP,v);let re;if(we){N&&xe&&r.texStorage2D(e.TEXTURE_CUBE_MAP,Ue,He,Xe.width,Xe.height);for(let Q=0;Q<6;Q++){re=Te[Q].mipmaps;for(let Le=0;Le<re.length;Le++){let Fe=re[Le];v.format!==qt?Be!==null?N?ae&&r.compressedTexSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Le,0,0,Fe.width,Fe.height,Be,Fe.data):r.compressedTexImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Le,He,Fe.width,Fe.height,0,Fe.data):ke("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):N?ae&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Le,0,0,Fe.width,Fe.height,Be,ve,Fe.data):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Le,He,Fe.width,Fe.height,0,Be,ve,Fe.data)}}}else{if(re=v.mipmaps,N&&xe){re.length>0&&Ue++;let Q=We(Te[0]);r.texStorage2D(e.TEXTURE_CUBE_MAP,Ue,He,Q.width,Q.height)}for(let Q=0;Q<6;Q++)if(te){N?ae&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,Te[Q].width,Te[Q].height,Be,ve,Te[Q].data):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,He,Te[Q].width,Te[Q].height,0,Be,ve,Te[Q].data);for(let Le=0;Le<re.length;Le++){let Fe=re[Le].image[Q].image;N?ae&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Le+1,0,0,Fe.width,Fe.height,Be,ve,Fe.data):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Le+1,He,Fe.width,Fe.height,0,Be,ve,Fe.data)}}else{N?ae&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,Be,ve,Te[Q]):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,He,Be,ve,Te[Q]);for(let Le=0;Le<re.length;Le++){let Fe=re[Le];N?ae&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Le+1,0,0,Be,ve,Fe.image[Q]):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Le+1,He,Be,ve,Fe.image[Q])}}}f(v)&&p(e.TEXTURE_CUBE_MAP),J.__version=$.version,v.onUpdate&&v.onUpdate(v)}E.__version=v.version}function be(E,v,F,Y,$,J){let De=n.convert(F.format,F.colorSpace),_e=n.convert(F.type),Re=S(F.internalFormat,De,_e,F.colorSpace),we=i.get(v),te=i.get(F);if(te.__renderTarget=v,!we.__hasExternalTextures){let Te=Math.max(1,v.width>>J),Xe=Math.max(1,v.height>>J);$===e.TEXTURE_3D||$===e.TEXTURE_2D_ARRAY?r.texImage3D($,J,Re,Te,Xe,v.depth,0,De,_e,null):r.texImage2D($,J,Re,Te,Xe,0,De,_e,null)}r.bindFramebuffer(e.FRAMEBUFFER,E),Ee(v)?o.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,Y,$,te.__webglTexture,0,oe(v)):($===e.TEXTURE_2D||$>=e.TEXTURE_CUBE_MAP_POSITIVE_X&&$<=e.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&e.framebufferTexture2D(e.FRAMEBUFFER,Y,$,te.__webglTexture,J),r.bindFramebuffer(e.FRAMEBUFFER,null)}function Ve(E,v,F){if(e.bindRenderbuffer(e.RENDERBUFFER,E),v.depthBuffer){let Y=v.depthTexture,$=Y&&Y.isDepthTexture?Y.type:null,J=b(v.stencilBuffer,$),De=v.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,_e=oe(v);Ee(v)?o.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,_e,J,v.width,v.height):F?e.renderbufferStorageMultisample(e.RENDERBUFFER,_e,J,v.width,v.height):e.renderbufferStorage(e.RENDERBUFFER,J,v.width,v.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,De,e.RENDERBUFFER,E)}else{let Y=v.textures;for(let $=0;$<Y.length;$++){let J=Y[$],De=n.convert(J.format,J.colorSpace),_e=n.convert(J.type),Re=S(J.internalFormat,De,_e,J.colorSpace),we=oe(v);F&&Ee(v)===!1?e.renderbufferStorageMultisample(e.RENDERBUFFER,we,Re,v.width,v.height):Ee(v)?o.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,we,Re,v.width,v.height):e.renderbufferStorage(e.RENDERBUFFER,Re,v.width,v.height)}}e.bindRenderbuffer(e.RENDERBUFFER,null)}function Ae(E,v){if(v&&v.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(r.bindFramebuffer(e.FRAMEBUFFER,E),!(v.depthTexture&&v.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let F=i.get(v.depthTexture);F.__renderTarget=v,(!F.__webglTexture||v.depthTexture.image.width!==v.width||v.depthTexture.image.height!==v.height)&&(v.depthTexture.image.width=v.width,v.depthTexture.image.height=v.height,v.depthTexture.needsUpdate=!0),ee(v.depthTexture,0);let Y=F.__webglTexture,$=oe(v);if(v.depthTexture.format===Ii)Ee(v)?o.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,e.DEPTH_ATTACHMENT,e.TEXTURE_2D,Y,0,$):e.framebufferTexture2D(e.FRAMEBUFFER,e.DEPTH_ATTACHMENT,e.TEXTURE_2D,Y,0);else if(v.depthTexture.format===Oi)Ee(v)?o.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,e.DEPTH_STENCIL_ATTACHMENT,e.TEXTURE_2D,Y,0,$):e.framebufferTexture2D(e.FRAMEBUFFER,e.DEPTH_STENCIL_ATTACHMENT,e.TEXTURE_2D,Y,0);else throw new Error("Unknown depthTexture format")}function je(E){let v=i.get(E),F=E.isWebGLCubeRenderTarget===!0;if(v.__boundDepthTexture!==E.depthTexture){let Y=E.depthTexture;if(v.__depthDisposeCallback&&v.__depthDisposeCallback(),Y){let $=()=>{delete v.__boundDepthTexture,delete v.__depthDisposeCallback,Y.removeEventListener("dispose",$)};Y.addEventListener("dispose",$),v.__depthDisposeCallback=$}v.__boundDepthTexture=Y}if(E.depthTexture&&!v.__autoAllocateDepthBuffer){if(F)throw new Error("target.depthTexture not supported in Cube render targets");let Y=E.texture.mipmaps;Y&&Y.length>0?Ae(v.__webglFramebuffer[0],E):Ae(v.__webglFramebuffer,E)}else if(F){v.__webglDepthbuffer=[];for(let Y=0;Y<6;Y++)if(r.bindFramebuffer(e.FRAMEBUFFER,v.__webglFramebuffer[Y]),v.__webglDepthbuffer[Y]===void 0)v.__webglDepthbuffer[Y]=e.createRenderbuffer(),Ve(v.__webglDepthbuffer[Y],E,!1);else{let $=E.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,J=v.__webglDepthbuffer[Y];e.bindRenderbuffer(e.RENDERBUFFER,J),e.framebufferRenderbuffer(e.FRAMEBUFFER,$,e.RENDERBUFFER,J)}}else{let Y=E.texture.mipmaps;if(Y&&Y.length>0?r.bindFramebuffer(e.FRAMEBUFFER,v.__webglFramebuffer[0]):r.bindFramebuffer(e.FRAMEBUFFER,v.__webglFramebuffer),v.__webglDepthbuffer===void 0)v.__webglDepthbuffer=e.createRenderbuffer(),Ve(v.__webglDepthbuffer,E,!1);else{let $=E.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,J=v.__webglDepthbuffer;e.bindRenderbuffer(e.RENDERBUFFER,J),e.framebufferRenderbuffer(e.FRAMEBUFFER,$,e.RENDERBUFFER,J)}}r.bindFramebuffer(e.FRAMEBUFFER,null)}function qe(E,v,F){let Y=i.get(E);v!==void 0&&be(Y.__webglFramebuffer,E,E.texture,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,0),F!==void 0&&je(E)}function Z(E){let v=E.texture,F=i.get(E),Y=i.get(v);E.addEventListener("dispose",U);let $=E.textures,J=E.isWebGLCubeRenderTarget===!0,De=$.length>1;if(De||(Y.__webglTexture===void 0&&(Y.__webglTexture=e.createTexture()),Y.__version=v.version,s.memory.textures++),J){F.__webglFramebuffer=[];for(let _e=0;_e<6;_e++)if(v.mipmaps&&v.mipmaps.length>0){F.__webglFramebuffer[_e]=[];for(let Re=0;Re<v.mipmaps.length;Re++)F.__webglFramebuffer[_e][Re]=e.createFramebuffer()}else F.__webglFramebuffer[_e]=e.createFramebuffer()}else{if(v.mipmaps&&v.mipmaps.length>0){F.__webglFramebuffer=[];for(let _e=0;_e<v.mipmaps.length;_e++)F.__webglFramebuffer[_e]=e.createFramebuffer()}else F.__webglFramebuffer=e.createFramebuffer();if(De)for(let _e=0,Re=$.length;_e<Re;_e++){let we=i.get($[_e]);we.__webglTexture===void 0&&(we.__webglTexture=e.createTexture(),s.memory.textures++)}if(E.samples>0&&Ee(E)===!1){F.__webglMultisampledFramebuffer=e.createFramebuffer(),F.__webglColorRenderbuffer=[],r.bindFramebuffer(e.FRAMEBUFFER,F.__webglMultisampledFramebuffer);for(let _e=0;_e<$.length;_e++){let Re=$[_e];F.__webglColorRenderbuffer[_e]=e.createRenderbuffer(),e.bindRenderbuffer(e.RENDERBUFFER,F.__webglColorRenderbuffer[_e]);let we=n.convert(Re.format,Re.colorSpace),te=n.convert(Re.type),Te=S(Re.internalFormat,we,te,Re.colorSpace,E.isXRRenderTarget===!0),Xe=oe(E);e.renderbufferStorageMultisample(e.RENDERBUFFER,Xe,Te,E.width,E.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+_e,e.RENDERBUFFER,F.__webglColorRenderbuffer[_e])}e.bindRenderbuffer(e.RENDERBUFFER,null),E.depthBuffer&&(F.__webglDepthRenderbuffer=e.createRenderbuffer(),Ve(F.__webglDepthRenderbuffer,E,!0)),r.bindFramebuffer(e.FRAMEBUFFER,null)}}if(J){r.bindTexture(e.TEXTURE_CUBE_MAP,Y.__webglTexture),ze(e.TEXTURE_CUBE_MAP,v);for(let _e=0;_e<6;_e++)if(v.mipmaps&&v.mipmaps.length>0)for(let Re=0;Re<v.mipmaps.length;Re++)be(F.__webglFramebuffer[_e][Re],E,v,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+_e,Re);else be(F.__webglFramebuffer[_e],E,v,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+_e,0);f(v)&&p(e.TEXTURE_CUBE_MAP),r.unbindTexture()}else if(De){for(let _e=0,Re=$.length;_e<Re;_e++){let we=$[_e],te=i.get(we),Te=e.TEXTURE_2D;(E.isWebGL3DRenderTarget||E.isWebGLArrayRenderTarget)&&(Te=E.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),r.bindTexture(Te,te.__webglTexture),ze(Te,we),be(F.__webglFramebuffer,E,we,e.COLOR_ATTACHMENT0+_e,Te,0),f(we)&&p(Te)}r.unbindTexture()}else{let _e=e.TEXTURE_2D;if((E.isWebGL3DRenderTarget||E.isWebGLArrayRenderTarget)&&(_e=E.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),r.bindTexture(_e,Y.__webglTexture),ze(_e,v),v.mipmaps&&v.mipmaps.length>0)for(let Re=0;Re<v.mipmaps.length;Re++)be(F.__webglFramebuffer[Re],E,v,e.COLOR_ATTACHMENT0,_e,Re);else be(F.__webglFramebuffer,E,v,e.COLOR_ATTACHMENT0,_e,0);f(v)&&p(_e),r.unbindTexture()}E.depthBuffer&&je(E)}function T(E){let v=E.textures;for(let F=0,Y=v.length;F<Y;F++){let $=v[F];if(f($)){let J=A(E),De=i.get($).__webglTexture;r.bindTexture(J,De),p(J),r.unbindTexture()}}}let de=[],se=[];function me(E){if(E.samples>0){if(Ee(E)===!1){let v=E.textures,F=E.width,Y=E.height,$=e.COLOR_BUFFER_BIT,J=E.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,De=i.get(E),_e=v.length>1;if(_e)for(let we=0;we<v.length;we++)r.bindFramebuffer(e.FRAMEBUFFER,De.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+we,e.RENDERBUFFER,null),r.bindFramebuffer(e.FRAMEBUFFER,De.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+we,e.TEXTURE_2D,null,0);r.bindFramebuffer(e.READ_FRAMEBUFFER,De.__webglMultisampledFramebuffer);let Re=E.texture.mipmaps;Re&&Re.length>0?r.bindFramebuffer(e.DRAW_FRAMEBUFFER,De.__webglFramebuffer[0]):r.bindFramebuffer(e.DRAW_FRAMEBUFFER,De.__webglFramebuffer);for(let we=0;we<v.length;we++){if(E.resolveDepthBuffer&&(E.depthBuffer&&($|=e.DEPTH_BUFFER_BIT),E.stencilBuffer&&E.resolveStencilBuffer&&($|=e.STENCIL_BUFFER_BIT)),_e){e.framebufferRenderbuffer(e.READ_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,De.__webglColorRenderbuffer[we]);let te=i.get(v[we]).__webglTexture;e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,te,0)}e.blitFramebuffer(0,0,F,Y,0,0,F,Y,$,e.NEAREST),l===!0&&(de.length=0,se.length=0,de.push(e.COLOR_ATTACHMENT0+we),E.depthBuffer&&E.resolveDepthBuffer===!1&&(de.push(J),se.push(J),e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,se)),e.invalidateFramebuffer(e.READ_FRAMEBUFFER,de))}if(r.bindFramebuffer(e.READ_FRAMEBUFFER,null),r.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),_e)for(let we=0;we<v.length;we++){r.bindFramebuffer(e.FRAMEBUFFER,De.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+we,e.RENDERBUFFER,De.__webglColorRenderbuffer[we]);let te=i.get(v[we]).__webglTexture;r.bindFramebuffer(e.FRAMEBUFFER,De.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+we,e.TEXTURE_2D,te,0)}r.bindFramebuffer(e.DRAW_FRAMEBUFFER,De.__webglMultisampledFramebuffer)}else if(E.depthBuffer&&E.resolveDepthBuffer===!1&&l){let v=E.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,[v])}}}function oe(E){return Math.min(a.maxSamples,E.samples)}function Ee(E){let v=i.get(E);return E.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&v.__useRenderToTexture!==!1}function ge(E){let v=s.render.frame;c.get(E)!==v&&(c.set(E,v),E.update())}function Ce(E,v){let F=E.colorSpace,Y=E.format,$=E.type;return E.isCompressedTexture===!0||E.isVideoTexture===!0||F!==Br&&F!==Er&&(at.getTransfer(F)===lt?(Y!==qt||$!==$t)&&ke("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):$e("WebGLTextures: Unsupported texture color space:",F)),v}function We(E){return typeof HTMLImageElement<"u"&&E instanceof HTMLImageElement?(h.width=E.naturalWidth||E.width,h.height=E.naturalHeight||E.height):typeof VideoFrame<"u"&&E instanceof VideoFrame?(h.width=E.displayWidth,h.height=E.displayHeight):(h.width=E.width,h.height=E.height),h}this.allocateTextureUnit=W,this.resetTextureUnits=q,this.setTexture2D=ee,this.setTexture2DArray=j,this.setTexture3D=le,this.setTextureCube=X,this.rebindTextures=qe,this.setupRenderTarget=Z,this.updateRenderTargetMipmap=T,this.updateMultisampleRenderTarget=me,this.setupDepthRenderbuffer=je,this.setupFrameBufferTexture=be,this.useMultisampledRTT=Ee}function dg(e,t){function r(i,a=Er){let n,s=at.getTransfer(a);if(i===$t)return e.UNSIGNED_BYTE;if(i===pn)return e.UNSIGNED_SHORT_4_4_4_4;if(i===fn)return e.UNSIGNED_SHORT_5_5_5_1;if(i===io)return e.UNSIGNED_INT_5_9_9_9_REV;if(i===ao)return e.UNSIGNED_INT_10F_11F_11F_REV;if(i===to)return e.BYTE;if(i===ro)return e.SHORT;if(i===Ui)return e.UNSIGNED_SHORT;if(i===dn)return e.INT;if(i===Fr)return e.UNSIGNED_INT;if(i===Vt)return e.FLOAT;if(i===Qt)return e.HALF_FLOAT;if(i===no)return e.ALPHA;if(i===so)return e.RGB;if(i===qt)return e.RGBA;if(i===Ii)return e.DEPTH_COMPONENT;if(i===Oi)return e.DEPTH_STENCIL;if(i===oo)return e.RED;if(i===mn)return e.RED_INTEGER;if(i===gn)return e.RG;if(i===_n)return e.RG_INTEGER;if(i===vn)return e.RGBA_INTEGER;if(i===ha||i===ca||i===ua||i===da)if(s===lt)if(n=t.get("WEBGL_compressed_texture_s3tc_srgb"),n!==null){if(i===ha)return n.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===ca)return n.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===ua)return n.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===da)return n.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(n=t.get("WEBGL_compressed_texture_s3tc"),n!==null){if(i===ha)return n.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===ca)return n.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===ua)return n.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===da)return n.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===xn||i===Mn||i===yn||i===Sn)if(n=t.get("WEBGL_compressed_texture_pvrtc"),n!==null){if(i===xn)return n.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Mn)return n.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===yn)return n.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===Sn)return n.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===Tn||i===En||i===bn)if(n=t.get("WEBGL_compressed_texture_etc"),n!==null){if(i===Tn||i===En)return s===lt?n.COMPRESSED_SRGB8_ETC2:n.COMPRESSED_RGB8_ETC2;if(i===bn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:n.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(i===wn||i===An||i===Cn||i===Rn||i===Pn||i===Ln||i===Nn||i===Un||i===Dn||i===In||i===On||i===Fn||i===Bn||i===zn)if(n=t.get("WEBGL_compressed_texture_astc"),n!==null){if(i===wn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:n.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===An)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:n.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Cn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:n.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Rn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:n.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Pn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:n.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===Ln)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:n.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===Nn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:n.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Un)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:n.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===Dn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:n.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===In)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:n.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===On)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:n.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===Fn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:n.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===Bn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:n.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===zn)return s===lt?n.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:n.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Vn||i===kn||i===Gn)if(n=t.get("EXT_texture_compression_bptc"),n!==null){if(i===Vn)return s===lt?n.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:n.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===kn)return n.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===Gn)return n.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===Hn||i===Wn||i===Xn||i===qn)if(n=t.get("EXT_texture_compression_rgtc"),n!==null){if(i===Hn)return n.COMPRESSED_RED_RGTC1_EXT;if(i===Wn)return n.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===Xn)return n.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===qn)return n.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===Di?e.UNSIGNED_INT_24_8:e[i]!==void 0?e[i]:null}return{convert:r}}var pg=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,fg=`
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

}`,mg=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let r=new qo(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=r}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,r=new gr({vertexShader:pg,fragmentShader:fg,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new Zt(new Us(20,20),r)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},gg=class extends ri{constructor(e,t){super();let r=this,i=null,a=1,n=null,s="local-floor",o=1,l=null,h=null,c=null,u=null,d=null,m=null,x=typeof XRWebGLBinding<"u",_=new mg,f={},p=t.getContextAttributes(),A=null,S=null,b=[],C=[],L=new ye,U=null,B=new Nt;B.viewport=new ct;let M=new Nt;M.viewport=new ct;let y=[B,M],R=new bu,q=null,W=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(K){let fe=b[K];return fe===void 0&&(fe=new Ss,b[K]=fe),fe.getTargetRaySpace()},this.getControllerGrip=function(K){let fe=b[K];return fe===void 0&&(fe=new Ss,b[K]=fe),fe.getGripSpace()},this.getHand=function(K){let fe=b[K];return fe===void 0&&(fe=new Ss,b[K]=fe),fe.getHandSpace()};function k(K){let fe=C.indexOf(K.inputSource);if(fe===-1)return;let ce=b[fe];ce!==void 0&&(ce.update(K.inputSource,K.frame,l||n),ce.dispatchEvent({type:K.type,data:K.inputSource}))}function ee(){i.removeEventListener("select",k),i.removeEventListener("selectstart",k),i.removeEventListener("selectend",k),i.removeEventListener("squeeze",k),i.removeEventListener("squeezestart",k),i.removeEventListener("squeezeend",k),i.removeEventListener("end",ee),i.removeEventListener("inputsourceschange",j);for(let K=0;K<b.length;K++){let fe=C[K];fe!==null&&(C[K]=null,b[K].disconnect(fe))}q=null,W=null,_.reset();for(let K in f)delete f[K];e.setRenderTarget(A),d=null,u=null,c=null,i=null,S=null,tt.stop(),r.isPresenting=!1,e.setPixelRatio(U),e.setSize(L.width,L.height,!1),r.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(K){a=K,r.isPresenting===!0&&ke("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(K){s=K,r.isPresenting===!0&&ke("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return l||n},this.setReferenceSpace=function(K){l=K},this.getBaseLayer=function(){return u!==null?u:d},this.getBinding=function(){return c===null&&x&&(c=new XRWebGLBinding(i,t)),c},this.getFrame=function(){return m},this.getSession=function(){return i},this.setSession=async function(K){if(i=K,i!==null){if(A=e.getRenderTarget(),i.addEventListener("select",k),i.addEventListener("selectstart",k),i.addEventListener("selectend",k),i.addEventListener("squeeze",k),i.addEventListener("squeezestart",k),i.addEventListener("squeezeend",k),i.addEventListener("end",ee),i.addEventListener("inputsourceschange",j),p.xrCompatible!==!0&&await t.makeXRCompatible(),U=e.getPixelRatio(),e.getSize(L),x&&"createProjectionLayer"in XRWebGLBinding.prototype){let fe=null,ce=null,be=null;p.depth&&(be=p.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,fe=p.stencil?Oi:Ii,ce=p.stencil?Di:Fr);let Ve={colorFormat:t.RGBA8,depthFormat:be,scaleFactor:a};c=this.getBinding(),u=c.createProjectionLayer(Ve),i.updateRenderState({layers:[u]}),e.setPixelRatio(1),e.setSize(u.textureWidth,u.textureHeight,!1),S=new zr(u.textureWidth,u.textureHeight,{format:qt,type:$t,depthTexture:new Xo(u.textureWidth,u.textureHeight,ce,void 0,void 0,void 0,void 0,void 0,void 0,fe),stencilBuffer:p.stencil,colorSpace:e.outputColorSpace,samples:p.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1,resolveStencilBuffer:u.ignoreDepthValues===!1})}else{let fe={antialias:p.antialias,alpha:!0,depth:p.depth,stencil:p.stencil,framebufferScaleFactor:a};d=new XRWebGLLayer(i,t,fe),i.updateRenderState({baseLayer:d}),e.setPixelRatio(1),e.setSize(d.framebufferWidth,d.framebufferHeight,!1),S=new zr(d.framebufferWidth,d.framebufferHeight,{format:qt,type:$t,colorSpace:e.outputColorSpace,stencilBuffer:p.stencil,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}S.isXRRenderTarget=!0,this.setFoveation(o),l=null,n=await i.requestReferenceSpace(s),tt.setContext(i),tt.start(),r.isPresenting=!0,r.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function j(K){for(let fe=0;fe<K.removed.length;fe++){let ce=K.removed[fe],be=C.indexOf(ce);be>=0&&(C[be]=null,b[be].disconnect(ce))}for(let fe=0;fe<K.added.length;fe++){let ce=K.added[fe],be=C.indexOf(ce);if(be===-1){for(let Ae=0;Ae<b.length;Ae++)if(Ae>=C.length){C.push(ce),be=Ae;break}else if(C[Ae]===null){C[Ae]=ce,be=Ae;break}if(be===-1)break}let Ve=b[be];Ve&&Ve.connect(ce)}}let le=new z,X=new z;function ie(K,fe,ce){le.setFromMatrixPosition(fe.matrixWorld),X.setFromMatrixPosition(ce.matrixWorld);let be=le.distanceTo(X),Ve=fe.projectionMatrix.elements,Ae=ce.projectionMatrix.elements,je=Ve[14]/(Ve[10]-1),qe=Ve[14]/(Ve[10]+1),Z=(Ve[9]+1)/Ve[5],T=(Ve[9]-1)/Ve[5],de=(Ve[8]-1)/Ve[0],se=(Ae[8]+1)/Ae[0],me=je*de,oe=je*se,Ee=be/(-de+se),ge=Ee*-de;if(fe.matrixWorld.decompose(K.position,K.quaternion,K.scale),K.translateX(ge),K.translateZ(Ee),K.matrixWorld.compose(K.position,K.quaternion,K.scale),K.matrixWorldInverse.copy(K.matrixWorld).invert(),Ve[10]===-1)K.projectionMatrix.copy(fe.projectionMatrix),K.projectionMatrixInverse.copy(fe.projectionMatrixInverse);else{let Ce=je+Ee,We=qe+Ee,E=me-ge,v=oe+(be-ge),F=Z*qe/We*Ce,Y=T*qe/We*Ce;K.projectionMatrix.makePerspective(E,v,F,Y,Ce,We),K.projectionMatrixInverse.copy(K.projectionMatrix).invert()}}function Se(K,fe){fe===null?K.matrixWorld.copy(K.matrix):K.matrixWorld.multiplyMatrices(fe.matrixWorld,K.matrix),K.matrixWorldInverse.copy(K.matrixWorld).invert()}this.updateCamera=function(K){if(i===null)return;let fe=K.near,ce=K.far;_.texture!==null&&(_.depthNear>0&&(fe=_.depthNear),_.depthFar>0&&(ce=_.depthFar)),R.near=M.near=B.near=fe,R.far=M.far=B.far=ce,(q!==R.near||W!==R.far)&&(i.updateRenderState({depthNear:R.near,depthFar:R.far}),q=R.near,W=R.far),R.layers.mask=K.layers.mask|6,B.layers.mask=R.layers.mask&3,M.layers.mask=R.layers.mask&5;let be=K.parent,Ve=R.cameras;Se(R,be);for(let Ae=0;Ae<Ve.length;Ae++)Se(Ve[Ae],be);Ve.length===2?ie(R,B,M):R.projectionMatrix.copy(B.projectionMatrix),Ge(K,R,be)};function Ge(K,fe,ce){ce===null?K.matrix.copy(fe.matrixWorld):(K.matrix.copy(ce.matrixWorld),K.matrix.invert(),K.matrix.multiply(fe.matrixWorld)),K.matrix.decompose(K.position,K.quaternion,K.scale),K.updateMatrixWorld(!0),K.projectionMatrix.copy(fe.projectionMatrix),K.projectionMatrixInverse.copy(fe.projectionMatrixInverse),K.isPerspectiveCamera&&(K.fov=ga*2*Math.atan(1/K.projectionMatrix.elements[5]),K.zoom=1)}this.getCamera=function(){return R},this.getFoveation=function(){if(!(u===null&&d===null))return o},this.setFoveation=function(K){o=K,u!==null&&(u.fixedFoveation=K),d!==null&&d.fixedFoveation!==void 0&&(d.fixedFoveation=K)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(R)},this.getCameraTexture=function(K){return f[K]};let ze=null;function it(K,fe){if(h=fe.getViewerPose(l||n),m=fe,h!==null){let ce=h.views;d!==null&&(e.setRenderTargetFramebuffer(S,d.framebuffer),e.setRenderTarget(S));let be=!1;ce.length!==R.cameras.length&&(R.cameras.length=0,be=!0);for(let Ae=0;Ae<ce.length;Ae++){let je=ce[Ae],qe=null;if(d!==null)qe=d.getViewport(je);else{let T=c.getViewSubImage(u,je);qe=T.viewport,Ae===0&&(e.setRenderTargetTextures(S,T.colorTexture,T.depthStencilTexture),e.setRenderTarget(S))}let Z=y[Ae];Z===void 0&&(Z=new Nt,Z.layers.enable(Ae),Z.viewport=new ct,y[Ae]=Z),Z.matrix.fromArray(je.transform.matrix),Z.matrix.decompose(Z.position,Z.quaternion,Z.scale),Z.projectionMatrix.fromArray(je.projectionMatrix),Z.projectionMatrixInverse.copy(Z.projectionMatrix).invert(),Z.viewport.set(qe.x,qe.y,qe.width,qe.height),Ae===0&&(R.matrix.copy(Z.matrix),R.matrix.decompose(R.position,R.quaternion,R.scale)),be===!0&&R.cameras.push(Z)}let Ve=i.enabledFeatures;if(Ve&&Ve.includes("depth-sensing")&&i.depthUsage=="gpu-optimized"&&x){c=r.getBinding();let Ae=c.getDepthInformation(ce[0]);Ae&&Ae.isValid&&Ae.texture&&_.init(Ae,i.renderState)}if(Ve&&Ve.includes("camera-access")&&x){e.state.unbindTexture(),c=r.getBinding();for(let Ae=0;Ae<ce.length;Ae++){let je=ce[Ae].camera;if(je){let qe=f[je];qe||(qe=new qo,f[je]=qe);let Z=c.getCameraImage(je);qe.sourceTexture=Z}}}}for(let ce=0;ce<b.length;ce++){let be=C[ce],Ve=b[ce];be!==null&&Ve!==void 0&&Ve.update(be,fe,l||n)}ze&&ze(K,fe),fe.detectedPlanes&&r.dispatchEvent({type:"planesdetected",data:fe}),m=null}let tt=new pl;tt.setAnimationLoop(it),this.setAnimationLoop=function(K){ze=K},this.dispose=function(){}}},Jr=new cr,_g=new ft;function vg(e,t){function r(f,p){f.matrixAutoUpdate===!0&&f.updateMatrix(),p.value.copy(f.matrix)}function i(f,p){p.color.getRGB(f.fogColor.value,Bo(e)),p.isFog?(f.fogNear.value=p.near,f.fogFar.value=p.far):p.isFogExp2&&(f.fogDensity.value=p.density)}function a(f,p,A,S,b){p.isMeshBasicMaterial||p.isMeshLambertMaterial?n(f,p):p.isMeshToonMaterial?(n(f,p),u(f,p)):p.isMeshPhongMaterial?(n(f,p),c(f,p)):p.isMeshStandardMaterial?(n(f,p),d(f,p),p.isMeshPhysicalMaterial&&m(f,p,b)):p.isMeshMatcapMaterial?(n(f,p),x(f,p)):p.isMeshDepthMaterial?n(f,p):p.isMeshDistanceMaterial?(n(f,p),_(f,p)):p.isMeshNormalMaterial?n(f,p):p.isLineBasicMaterial?(s(f,p),p.isLineDashedMaterial&&o(f,p)):p.isPointsMaterial?l(f,p,A,S):p.isSpriteMaterial?h(f,p):p.isShadowMaterial?(f.color.value.copy(p.color),f.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function n(f,p){f.opacity.value=p.opacity,p.color&&f.diffuse.value.copy(p.color),p.emissive&&f.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(f.map.value=p.map,r(p.map,f.mapTransform)),p.alphaMap&&(f.alphaMap.value=p.alphaMap,r(p.alphaMap,f.alphaMapTransform)),p.bumpMap&&(f.bumpMap.value=p.bumpMap,r(p.bumpMap,f.bumpMapTransform),f.bumpScale.value=p.bumpScale,p.side===Rt&&(f.bumpScale.value*=-1)),p.normalMap&&(f.normalMap.value=p.normalMap,r(p.normalMap,f.normalMapTransform),f.normalScale.value.copy(p.normalScale),p.side===Rt&&f.normalScale.value.negate()),p.displacementMap&&(f.displacementMap.value=p.displacementMap,r(p.displacementMap,f.displacementMapTransform),f.displacementScale.value=p.displacementScale,f.displacementBias.value=p.displacementBias),p.emissiveMap&&(f.emissiveMap.value=p.emissiveMap,r(p.emissiveMap,f.emissiveMapTransform)),p.specularMap&&(f.specularMap.value=p.specularMap,r(p.specularMap,f.specularMapTransform)),p.alphaTest>0&&(f.alphaTest.value=p.alphaTest);let A=t.get(p),S=A.envMap,b=A.envMapRotation;S&&(f.envMap.value=S,Jr.copy(b),Jr.x*=-1,Jr.y*=-1,Jr.z*=-1,S.isCubeTexture&&S.isRenderTargetTexture===!1&&(Jr.y*=-1,Jr.z*=-1),f.envMapRotation.value.setFromMatrix4(_g.makeRotationFromEuler(Jr)),f.flipEnvMap.value=S.isCubeTexture&&S.isRenderTargetTexture===!1?-1:1,f.reflectivity.value=p.reflectivity,f.ior.value=p.ior,f.refractionRatio.value=p.refractionRatio),p.lightMap&&(f.lightMap.value=p.lightMap,f.lightMapIntensity.value=p.lightMapIntensity,r(p.lightMap,f.lightMapTransform)),p.aoMap&&(f.aoMap.value=p.aoMap,f.aoMapIntensity.value=p.aoMapIntensity,r(p.aoMap,f.aoMapTransform))}function s(f,p){f.diffuse.value.copy(p.color),f.opacity.value=p.opacity,p.map&&(f.map.value=p.map,r(p.map,f.mapTransform))}function o(f,p){f.dashSize.value=p.dashSize,f.totalSize.value=p.dashSize+p.gapSize,f.scale.value=p.scale}function l(f,p,A,S){f.diffuse.value.copy(p.color),f.opacity.value=p.opacity,f.size.value=p.size*A,f.scale.value=S*.5,p.map&&(f.map.value=p.map,r(p.map,f.uvTransform)),p.alphaMap&&(f.alphaMap.value=p.alphaMap,r(p.alphaMap,f.alphaMapTransform)),p.alphaTest>0&&(f.alphaTest.value=p.alphaTest)}function h(f,p){f.diffuse.value.copy(p.color),f.opacity.value=p.opacity,f.rotation.value=p.rotation,p.map&&(f.map.value=p.map,r(p.map,f.mapTransform)),p.alphaMap&&(f.alphaMap.value=p.alphaMap,r(p.alphaMap,f.alphaMapTransform)),p.alphaTest>0&&(f.alphaTest.value=p.alphaTest)}function c(f,p){f.specular.value.copy(p.specular),f.shininess.value=Math.max(p.shininess,1e-4)}function u(f,p){p.gradientMap&&(f.gradientMap.value=p.gradientMap)}function d(f,p){f.metalness.value=p.metalness,p.metalnessMap&&(f.metalnessMap.value=p.metalnessMap,r(p.metalnessMap,f.metalnessMapTransform)),f.roughness.value=p.roughness,p.roughnessMap&&(f.roughnessMap.value=p.roughnessMap,r(p.roughnessMap,f.roughnessMapTransform)),p.envMap&&(f.envMapIntensity.value=p.envMapIntensity)}function m(f,p,A){f.ior.value=p.ior,p.sheen>0&&(f.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),f.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(f.sheenColorMap.value=p.sheenColorMap,r(p.sheenColorMap,f.sheenColorMapTransform)),p.sheenRoughnessMap&&(f.sheenRoughnessMap.value=p.sheenRoughnessMap,r(p.sheenRoughnessMap,f.sheenRoughnessMapTransform))),p.clearcoat>0&&(f.clearcoat.value=p.clearcoat,f.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(f.clearcoatMap.value=p.clearcoatMap,r(p.clearcoatMap,f.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(f.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,r(p.clearcoatRoughnessMap,f.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(f.clearcoatNormalMap.value=p.clearcoatNormalMap,r(p.clearcoatNormalMap,f.clearcoatNormalMapTransform),f.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Rt&&f.clearcoatNormalScale.value.negate())),p.dispersion>0&&(f.dispersion.value=p.dispersion),p.iridescence>0&&(f.iridescence.value=p.iridescence,f.iridescenceIOR.value=p.iridescenceIOR,f.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],f.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(f.iridescenceMap.value=p.iridescenceMap,r(p.iridescenceMap,f.iridescenceMapTransform)),p.iridescenceThicknessMap&&(f.iridescenceThicknessMap.value=p.iridescenceThicknessMap,r(p.iridescenceThicknessMap,f.iridescenceThicknessMapTransform))),p.transmission>0&&(f.transmission.value=p.transmission,f.transmissionSamplerMap.value=A.texture,f.transmissionSamplerSize.value.set(A.width,A.height),p.transmissionMap&&(f.transmissionMap.value=p.transmissionMap,r(p.transmissionMap,f.transmissionMapTransform)),f.thickness.value=p.thickness,p.thicknessMap&&(f.thicknessMap.value=p.thicknessMap,r(p.thicknessMap,f.thicknessMapTransform)),f.attenuationDistance.value=p.attenuationDistance,f.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(f.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(f.anisotropyMap.value=p.anisotropyMap,r(p.anisotropyMap,f.anisotropyMapTransform))),f.specularIntensity.value=p.specularIntensity,f.specularColor.value.copy(p.specularColor),p.specularColorMap&&(f.specularColorMap.value=p.specularColorMap,r(p.specularColorMap,f.specularColorMapTransform)),p.specularIntensityMap&&(f.specularIntensityMap.value=p.specularIntensityMap,r(p.specularIntensityMap,f.specularIntensityMapTransform))}function x(f,p){p.matcap&&(f.matcap.value=p.matcap)}function _(f,p){let A=t.get(p).light;f.referencePosition.value.setFromMatrixPosition(A.matrixWorld),f.nearDistance.value=A.shadow.camera.near,f.farDistance.value=A.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:a}}function xg(e,t,r,i){let a={},n={},s=[],o=e.getParameter(e.MAX_UNIFORM_BUFFER_BINDINGS);function l(A,S){let b=S.program;i.uniformBlockBinding(A,b)}function h(A,S){let b=a[A.id];b===void 0&&(x(A),b=c(A),a[A.id]=b,A.addEventListener("dispose",f));let C=S.program;i.updateUBOMapping(A,C);let L=t.render.frame;n[A.id]!==L&&(d(A),n[A.id]=L)}function c(A){let S=u();A.__bindingPointIndex=S;let b=e.createBuffer(),C=A.__size,L=A.usage;return e.bindBuffer(e.UNIFORM_BUFFER,b),e.bufferData(e.UNIFORM_BUFFER,C,L),e.bindBuffer(e.UNIFORM_BUFFER,null),e.bindBufferBase(e.UNIFORM_BUFFER,S,b),b}function u(){for(let A=0;A<o;A++)if(s.indexOf(A)===-1)return s.push(A),A;return $e("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(A){let S=a[A.id],b=A.uniforms,C=A.__cache;e.bindBuffer(e.UNIFORM_BUFFER,S);for(let L=0,U=b.length;L<U;L++){let B=Array.isArray(b[L])?b[L]:[b[L]];for(let M=0,y=B.length;M<y;M++){let R=B[M];if(m(R,L,M,C)===!0){let q=R.__offset,W=Array.isArray(R.value)?R.value:[R.value],k=0;for(let ee=0;ee<W.length;ee++){let j=W[ee],le=_(j);typeof j=="number"||typeof j=="boolean"?(R.__data[0]=j,e.bufferSubData(e.UNIFORM_BUFFER,q+k,R.__data)):j.isMatrix3?(R.__data[0]=j.elements[0],R.__data[1]=j.elements[1],R.__data[2]=j.elements[2],R.__data[3]=0,R.__data[4]=j.elements[3],R.__data[5]=j.elements[4],R.__data[6]=j.elements[5],R.__data[7]=0,R.__data[8]=j.elements[6],R.__data[9]=j.elements[7],R.__data[10]=j.elements[8],R.__data[11]=0):(j.toArray(R.__data,k),k+=le.storage/Float32Array.BYTES_PER_ELEMENT)}e.bufferSubData(e.UNIFORM_BUFFER,q,R.__data)}}}e.bindBuffer(e.UNIFORM_BUFFER,null)}function m(A,S,b,C){let L=A.value,U=S+"_"+b;if(C[U]===void 0)return typeof L=="number"||typeof L=="boolean"?C[U]=L:C[U]=L.clone(),!0;{let B=C[U];if(typeof L=="number"||typeof L=="boolean"){if(B!==L)return C[U]=L,!0}else if(B.equals(L)===!1)return B.copy(L),!0}return!1}function x(A){let S=A.uniforms,b=0,C=16;for(let U=0,B=S.length;U<B;U++){let M=Array.isArray(S[U])?S[U]:[S[U]];for(let y=0,R=M.length;y<R;y++){let q=M[y],W=Array.isArray(q.value)?q.value:[q.value];for(let k=0,ee=W.length;k<ee;k++){let j=W[k],le=_(j),X=b%C,ie=X%le.boundary,Se=X+ie;b+=ie,Se!==0&&C-Se<le.storage&&(b+=C-Se),q.__data=new Float32Array(le.storage/Float32Array.BYTES_PER_ELEMENT),q.__offset=b,b+=le.storage}}}let L=b%C;return L>0&&(b+=C-L),A.__size=b,A.__cache={},this}function _(A){let S={boundary:0,storage:0};return typeof A=="number"||typeof A=="boolean"?(S.boundary=4,S.storage=4):A.isVector2?(S.boundary=8,S.storage=8):A.isVector3||A.isColor?(S.boundary=16,S.storage=12):A.isVector4?(S.boundary=16,S.storage=16):A.isMatrix3?(S.boundary=48,S.storage=48):A.isMatrix4?(S.boundary=64,S.storage=64):A.isTexture?ke("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ke("WebGLRenderer: Unsupported uniform value type.",A),S}function f(A){let S=A.target;S.removeEventListener("dispose",f);let b=s.indexOf(S.__bindingPointIndex);s.splice(b,1),e.deleteBuffer(a[S.id]),delete a[S.id],delete n[S.id]}function p(){for(let A in a)e.deleteBuffer(a[A]);s=[],a={},n={}}return{bind:l,update:h,dispose:p}}var Mg=new Uint16Array([11481,15204,11534,15171,11808,15015,12385,14843,12894,14716,13396,14600,13693,14483,13976,14366,14237,14171,14405,13961,14511,13770,14605,13598,14687,13444,14760,13305,14822,13066,14876,12857,14923,12675,14963,12517,14997,12379,15025,12230,15049,12023,15070,11843,15086,11687,15100,11551,15111,11433,15120,11330,15127,11217,15132,11060,15135,10922,15138,10801,15139,10695,15139,10600,13012,14923,13020,14917,13064,14886,13176,14800,13349,14666,13513,14526,13724,14398,13960,14230,14200,14020,14383,13827,14488,13651,14583,13491,14667,13348,14740,13132,14803,12908,14856,12713,14901,12542,14938,12394,14968,12241,14992,12017,15010,11822,15024,11654,15034,11507,15041,11380,15044,11269,15044,11081,15042,10913,15037,10764,15031,10635,15023,10520,15014,10419,15003,10330,13657,14676,13658,14673,13670,14660,13698,14622,13750,14547,13834,14442,13956,14317,14112,14093,14291,13889,14407,13704,14499,13538,14586,13389,14664,13201,14733,12966,14792,12758,14842,12577,14882,12418,14915,12272,14940,12033,14959,11826,14972,11646,14980,11490,14983,11355,14983,11212,14979,11008,14971,10830,14961,10675,14950,10540,14936,10420,14923,10315,14909,10204,14894,10041,14089,14460,14090,14459,14096,14452,14112,14431,14141,14388,14186,14305,14252,14130,14341,13941,14399,13756,14467,13585,14539,13430,14610,13272,14677,13026,14737,12808,14790,12617,14833,12449,14869,12303,14896,12065,14916,11845,14929,11655,14937,11490,14939,11347,14936,11184,14930,10970,14921,10783,14912,10621,14900,10480,14885,10356,14867,10247,14848,10062,14827,9894,14805,9745,14400,14208,14400,14206,14402,14198,14406,14174,14415,14122,14427,14035,14444,13913,14469,13767,14504,13613,14548,13463,14598,13324,14651,13082,14704,12858,14752,12658,14795,12483,14831,12330,14860,12106,14881,11875,14895,11675,14903,11501,14905,11351,14903,11178,14900,10953,14892,10757,14880,10589,14865,10442,14847,10313,14827,10162,14805,9965,14782,9792,14757,9642,14731,9507,14562,13883,14562,13883,14563,13877,14566,13862,14570,13830,14576,13773,14584,13689,14595,13582,14613,13461,14637,13336,14668,13120,14704,12897,14741,12695,14776,12516,14808,12358,14835,12150,14856,11910,14870,11701,14878,11519,14882,11361,14884,11187,14880,10951,14871,10748,14858,10572,14842,10418,14823,10286,14801,10099,14777,9897,14751,9722,14725,9567,14696,9430,14666,9309,14702,13604,14702,13604,14702,13600,14703,13591,14705,13570,14707,13533,14709,13477,14712,13400,14718,13305,14727,13106,14743,12907,14762,12716,14784,12539,14807,12380,14827,12190,14844,11943,14855,11727,14863,11539,14870,11376,14871,11204,14868,10960,14858,10748,14845,10565,14829,10406,14809,10269,14786,10058,14761,9852,14734,9671,14705,9512,14674,9374,14641,9253,14608,9076,14821,13366,14821,13365,14821,13364,14821,13358,14821,13344,14821,13320,14819,13252,14817,13145,14815,13011,14814,12858,14817,12698,14823,12539,14832,12389,14841,12214,14850,11968,14856,11750,14861,11558,14866,11390,14867,11226,14862,10972,14853,10754,14840,10565,14823,10401,14803,10259,14780,10032,14754,9820,14725,9635,14694,9473,14661,9333,14627,9203,14593,8988,14557,8798,14923,13014,14922,13014,14922,13012,14922,13004,14920,12987,14919,12957,14915,12907,14909,12834,14902,12738,14894,12623,14888,12498,14883,12370,14880,12203,14878,11970,14875,11759,14873,11569,14874,11401,14872,11243,14865,10986,14855,10762,14842,10568,14825,10401,14804,10255,14781,10017,14754,9799,14725,9611,14692,9445,14658,9301,14623,9139,14587,8920,14548,8729,14509,8562,15008,12672,15008,12672,15008,12671,15007,12667,15005,12656,15001,12637,14997,12605,14989,12556,14978,12490,14966,12407,14953,12313,14940,12136,14927,11934,14914,11742,14903,11563,14896,11401,14889,11247,14879,10992,14866,10767,14851,10570,14833,10400,14812,10252,14789,10007,14761,9784,14731,9592,14698,9424,14663,9279,14627,9088,14588,8868,14548,8676,14508,8508,14467,8360,15080,12386,15080,12386,15079,12385,15078,12383,15076,12378,15072,12367,15066,12347,15057,12315,15045,12253,15030,12138,15012,11998,14993,11845,14972,11685,14951,11530,14935,11383,14920,11228,14904,10981,14887,10762,14870,10567,14850,10397,14827,10248,14803,9997,14774,9771,14743,9578,14710,9407,14674,9259,14637,9048,14596,8826,14555,8632,14514,8464,14471,8317,14427,8182,15139,12008,15139,12008,15138,12008,15137,12007,15135,12003,15130,11990,15124,11969,15115,11929,15102,11872,15086,11794,15064,11693,15041,11581,15013,11459,14987,11336,14966,11170,14944,10944,14921,10738,14898,10552,14875,10387,14850,10239,14824,9983,14794,9758,14762,9563,14728,9392,14692,9244,14653,9014,14611,8791,14569,8597,14526,8427,14481,8281,14436,8110,14391,7885,15188,11617,15188,11617,15187,11617,15186,11618,15183,11617,15179,11612,15173,11601,15163,11581,15150,11546,15133,11495,15110,11427,15083,11346,15051,11246,15024,11057,14996,10868,14967,10687,14938,10517,14911,10362,14882,10206,14853,9956,14821,9737,14787,9543,14752,9375,14715,9228,14675,8980,14632,8760,14589,8565,14544,8395,14498,8248,14451,8049,14404,7824,14357,7630,15228,11298,15228,11298,15227,11299,15226,11301,15223,11303,15219,11302,15213,11299,15204,11290,15191,11271,15174,11217,15150,11129,15119,11015,15087,10886,15057,10744,15024,10599,14990,10455,14957,10318,14924,10143,14891,9911,14856,9701,14820,9516,14782,9352,14744,9200,14703,8946,14659,8725,14615,8533,14568,8366,14521,8220,14472,7992,14423,7770,14374,7578,14315,7408,15260,10819,15260,10819,15259,10822,15258,10826,15256,10832,15251,10836,15246,10841,15237,10838,15225,10821,15207,10788,15183,10734,15151,10660,15120,10571,15087,10469,15049,10359,15012,10249,14974,10041,14937,9837,14900,9647,14860,9475,14820,9320,14779,9147,14736,8902,14691,8688,14646,8499,14598,8335,14549,8189,14499,7940,14448,7720,14397,7529,14347,7363,14256,7218,15285,10410,15285,10411,15285,10413,15284,10418,15282,10425,15278,10434,15272,10442,15264,10449,15252,10445,15235,10433,15210,10403,15179,10358,15149,10301,15113,10218,15073,10059,15033,9894,14991,9726,14951,9565,14909,9413,14865,9273,14822,9073,14777,8845,14730,8641,14682,8459,14633,8300,14583,8129,14531,7883,14479,7670,14426,7482,14373,7321,14305,7176,14201,6939,15305,9939,15305,9940,15305,9945,15304,9955,15302,9967,15298,9989,15293,10010,15286,10033,15274,10044,15258,10045,15233,10022,15205,9975,15174,9903,15136,9808,15095,9697,15053,9578,15009,9451,14965,9327,14918,9198,14871,8973,14825,8766,14775,8579,14725,8408,14675,8259,14622,8058,14569,7821,14515,7615,14460,7435,14405,7276,14350,7108,14256,6866,14149,6653,15321,9444,15321,9445,15321,9448,15320,9458,15317,9470,15314,9490,15310,9515,15302,9540,15292,9562,15276,9579,15251,9577,15226,9559,15195,9519,15156,9463,15116,9389,15071,9304,15025,9208,14978,9023,14927,8838,14878,8661,14827,8496,14774,8344,14722,8206,14667,7973,14612,7749,14556,7555,14499,7382,14443,7229,14385,7025,14322,6791,14210,6588,14100,6409,15333,8920,15333,8921,15332,8927,15332,8943,15329,8965,15326,9002,15322,9048,15316,9106,15307,9162,15291,9204,15267,9221,15244,9221,15212,9196,15175,9134,15133,9043,15088,8930,15040,8801,14990,8665,14938,8526,14886,8391,14830,8261,14775,8087,14719,7866,14661,7664,14603,7482,14544,7322,14485,7178,14426,6936,14367,6713,14281,6517,14166,6348,14054,6198,15341,8360,15341,8361,15341,8366,15341,8379,15339,8399,15336,8431,15332,8473,15326,8527,15318,8585,15302,8632,15281,8670,15258,8690,15227,8690,15191,8664,15149,8612,15104,8543,15055,8456,15001,8360,14948,8259,14892,8122,14834,7923,14776,7734,14716,7558,14656,7397,14595,7250,14534,7070,14472,6835,14410,6628,14350,6443,14243,6283,14125,6135,14010,5889,15348,7715,15348,7717,15348,7725,15347,7745,15345,7780,15343,7836,15339,7905,15334,8e3,15326,8103,15310,8193,15293,8239,15270,8270,15240,8287,15204,8283,15163,8260,15118,8223,15067,8143,15014,8014,14958,7873,14899,7723,14839,7573,14778,7430,14715,7293,14652,7164,14588,6931,14524,6720,14460,6531,14396,6362,14330,6210,14207,6015,14086,5781,13969,5576,15352,7114,15352,7116,15352,7128,15352,7159,15350,7195,15348,7237,15345,7299,15340,7374,15332,7457,15317,7544,15301,7633,15280,7703,15251,7754,15216,7775,15176,7767,15131,7733,15079,7670,15026,7588,14967,7492,14906,7387,14844,7278,14779,7171,14714,6965,14648,6770,14581,6587,14515,6420,14448,6269,14382,6123,14299,5881,14172,5665,14049,5477,13929,5310,15355,6329,15355,6330,15355,6339,15355,6362,15353,6410,15351,6472,15349,6572,15344,6688,15337,6835,15323,6985,15309,7142,15287,7220,15260,7277,15226,7310,15188,7326,15142,7318,15090,7285,15036,7239,14976,7177,14914,7045,14849,6892,14782,6736,14714,6581,14645,6433,14576,6293,14506,6164,14438,5946,14369,5733,14270,5540,14140,5369,14014,5216,13892,5043,15357,5483,15357,5484,15357,5496,15357,5528,15356,5597,15354,5692,15351,5835,15347,6011,15339,6195,15328,6317,15314,6446,15293,6566,15268,6668,15235,6746,15197,6796,15152,6811,15101,6790,15046,6748,14985,6673,14921,6583,14854,6479,14785,6371,14714,6259,14643,6149,14571,5946,14499,5750,14428,5567,14358,5401,14242,5250,14109,5111,13980,4870,13856,4657,15359,4555,15359,4557,15358,4573,15358,4633,15357,4715,15355,4841,15353,5061,15349,5216,15342,5391,15331,5577,15318,5770,15299,5967,15274,6150,15243,6223,15206,6280,15161,6310,15111,6317,15055,6300,14994,6262,14928,6208,14860,6141,14788,5994,14715,5838,14641,5684,14566,5529,14492,5384,14418,5247,14346,5121,14216,4892,14079,4682,13948,4496,13822,4330,15359,3498,15359,3501,15359,3520,15359,3598,15358,3719,15356,3860,15355,4137,15351,4305,15344,4563,15334,4809,15321,5116,15303,5273,15280,5418,15250,5547,15214,5653,15170,5722,15120,5761,15064,5763,15002,5733,14935,5673,14865,5597,14792,5504,14716,5400,14640,5294,14563,5185,14486,5041,14410,4841,14335,4655,14191,4482,14051,4325,13918,4183,13790,4012,15360,2282,15360,2285,15360,2306,15360,2401,15359,2547,15357,2748,15355,3103,15352,3349,15345,3675,15336,4020,15324,4272,15307,4496,15285,4716,15255,4908,15220,5086,15178,5170,15128,5214,15072,5234,15010,5231,14943,5206,14871,5166,14796,5102,14718,4971,14639,4833,14559,4687,14480,4541,14402,4401,14315,4268,14167,4142,14025,3958,13888,3747,13759,3556,15360,923,15360,925,15360,946,15360,1052,15359,1214,15357,1494,15356,1892,15352,2274,15346,2663,15338,3099,15326,3393,15309,3679,15288,3980,15260,4183,15226,4325,15185,4437,15136,4517,15080,4570,15018,4591,14950,4581,14877,4545,14800,4485,14720,4411,14638,4325,14556,4231,14475,4136,14395,3988,14297,3803,14145,3628,13999,3465,13861,3314,13729,3177,15360,263,15360,264,15360,272,15360,325,15359,407,15358,548,15356,780,15352,1144,15347,1580,15339,2099,15328,2425,15312,2795,15292,3133,15264,3329,15232,3517,15191,3689,15143,3819,15088,3923,15025,3978,14956,3999,14882,3979,14804,3931,14722,3855,14639,3756,14554,3645,14470,3529,14388,3409,14279,3289,14124,3173,13975,3055,13834,2848,13701,2658,15360,49,15360,49,15360,52,15360,75,15359,111,15358,201,15356,283,15353,519,15348,726,15340,1045,15329,1415,15314,1795,15295,2173,15269,2410,15237,2649,15197,2866,15150,3054,15095,3140,15032,3196,14963,3228,14888,3236,14808,3224,14725,3191,14639,3146,14553,3088,14466,2976,14382,2836,14262,2692,14103,2549,13952,2409,13808,2278,13674,2154,15360,4,15360,4,15360,4,15360,13,15359,33,15358,59,15357,112,15353,199,15348,302,15341,456,15331,628,15316,827,15297,1082,15272,1332,15241,1601,15202,1851,15156,2069,15101,2172,15039,2256,14970,2314,14894,2348,14813,2358,14728,2344,14640,2311,14551,2263,14463,2203,14376,2133,14247,2059,14084,1915,13930,1761,13784,1609,13648,1464,15360,0,15360,0,15360,0,15360,3,15359,18,15358,26,15357,53,15354,80,15348,97,15341,165,15332,238,15318,326,15299,427,15275,529,15245,654,15207,771,15161,885,15108,994,15046,1089,14976,1170,14900,1229,14817,1266,14731,1284,14641,1282,14550,1260,14460,1223,14370,1174,14232,1116,14066,1050,13909,981,13761,910,13623,839]),vr=null;function yg(){return vr===null&&(vr=new Ho(Mg,32,32,gn,Qt),vr.minFilter=St,vr.magFilter=St,vr.wrapS=Xt,vr.wrapT=Xt,vr.generateMipmaps=!1,vr.needsUpdate=!0),vr}var Sg=class{constructor(e={}){let{canvas:t=Bh(),context:r=null,depth:i=!0,stencil:a=!1,alpha:n=!1,antialias:s=!1,premultipliedAlpha:o=!0,preserveDrawingBuffer:l=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:c=!1,reversedDepthBuffer:u=!1}=e;this.isWebGLRenderer=!0;let d;if(r!==null){if(typeof WebGLRenderingContext<"u"&&r instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");d=r.getContextAttributes().alpha}else d=n;let m=new Set([vn,_n,mn]),x=new Set([$t,Fr,Ui,Di,pn,fn]),_=new Uint32Array(4),f=new Int32Array(4),p=null,A=null,S=[],b=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Sr,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let C=this,L=!1;this._outputColorSpace=Pt;let U=0,B=0,M=null,y=-1,R=null,q=new ct,W=new ct,k=null,ee=new Qe(0),j=0,le=t.width,X=t.height,ie=1,Se=null,Ge=null,ze=new ct(0,0,le,X),it=new ct(0,0,le,X),tt=!1,K=new Es,fe=!1,ce=!1,be=new ft,Ve=new z,Ae=new ct,je={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},qe=!1;function Z(){return M===null?ie:1}let T=r;function de(g,w){return t.getContext(g,w)}try{let g={alpha:!0,depth:i,stencil:a,antialias:s,premultipliedAlpha:o,preserveDrawingBuffer:l,powerPreference:h,failIfMajorPerformanceCaveat:c};if("setAttribute"in t&&t.setAttribute("data-engine","three.js r181"),t.addEventListener("webglcontextlost",Ue,!1),t.addEventListener("webglcontextrestored",re,!1),t.addEventListener("webglcontextcreationerror",Q,!1),T===null){let w="webgl2";if(T=de(w,g),T===null)throw de(w)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(g){throw g("WebGLRenderer: "+g.message),g}let se,me,oe,Ee,ge,Ce,We,E,v,F,Y,$,J,De,_e,Re,we,te,Te,Xe,Be,ve,He,N;function xe(){se=new Pf(T),se.init(),ve=new dg(T,se),me=new yf(T,se,e,ve),oe=new cg(T,se),me.reversedDepthBuffer&&u&&oe.buffers.depth.setReversed(!0),Ee=new Uf(T),ge=new Zm,Ce=new ug(T,se,oe,ge,me,ve,Ee),We=new Tf(C),E=new Rf(C),v=new Ou(T),He=new xf(T,v),F=new Lf(T,v,Ee,He),Y=new If(T,F,v,Ee),Te=new Df(T,me,Ce),Re=new Sf(ge),$=new Km(C,We,E,se,me,He,Re),J=new vg(C,ge),De=new Qm,_e=new ng(se),te=new vf(C,We,E,oe,Y,d,o),we=new lg(C,Y,me),N=new xg(T,Ee,me,oe),Xe=new Mf(T,se,Ee),Be=new Nf(T,se,Ee),Ee.programs=$.programs,C.capabilities=me,C.extensions=se,C.properties=ge,C.renderLists=De,C.shadowMap=we,C.state=oe,C.info=Ee}xe();let ae=new gg(C,T);this.xr=ae,this.getContext=function(){return T},this.getContextAttributes=function(){return T.getContextAttributes()},this.forceContextLoss=function(){let g=se.get("WEBGL_lose_context");g&&g.loseContext()},this.forceContextRestore=function(){let g=se.get("WEBGL_lose_context");g&&g.restoreContext()},this.getPixelRatio=function(){return ie},this.setPixelRatio=function(g){g!==void 0&&(ie=g,this.setSize(le,X,!1))},this.getSize=function(g){return g.set(le,X)},this.setSize=function(g,w,D=!0){if(ae.isPresenting){ke("WebGLRenderer: Can't change size while VR device is presenting.");return}le=g,X=w,t.width=Math.floor(g*ie),t.height=Math.floor(w*ie),D===!0&&(t.style.width=g+"px",t.style.height=w+"px"),this.setViewport(0,0,g,w)},this.getDrawingBufferSize=function(g){return g.set(le*ie,X*ie).floor()},this.setDrawingBufferSize=function(g,w,D){le=g,X=w,ie=D,t.width=Math.floor(g*D),t.height=Math.floor(w*D),this.setViewport(0,0,g,w)},this.getCurrentViewport=function(g){return g.copy(q)},this.getViewport=function(g){return g.copy(ze)},this.setViewport=function(g,w,D,I){g.isVector4?ze.set(g.x,g.y,g.z,g.w):ze.set(g,w,D,I),oe.viewport(q.copy(ze).multiplyScalar(ie).round())},this.getScissor=function(g){return g.copy(it)},this.setScissor=function(g,w,D,I){g.isVector4?it.set(g.x,g.y,g.z,g.w):it.set(g,w,D,I),oe.scissor(W.copy(it).multiplyScalar(ie).round())},this.getScissorTest=function(){return tt},this.setScissorTest=function(g){oe.setScissorTest(tt=g)},this.setOpaqueSort=function(g){Se=g},this.setTransparentSort=function(g){Ge=g},this.getClearColor=function(g){return g.copy(te.getClearColor())},this.setClearColor=function(){te.setClearColor(...arguments)},this.getClearAlpha=function(){return te.getClearAlpha()},this.setClearAlpha=function(){te.setClearAlpha(...arguments)},this.clear=function(g=!0,w=!0,D=!0){let I=0;if(g){let P=!1;if(M!==null){let H=M.texture.format;P=m.has(H)}if(P){let H=M.texture.type,ne=x.has(H),he=te.getClearColor(),pe=te.getClearAlpha(),Pe=he.r,Ie=he.g,Oe=he.b;ne?(_[0]=Pe,_[1]=Ie,_[2]=Oe,_[3]=pe,T.clearBufferuiv(T.COLOR,0,_)):(f[0]=Pe,f[1]=Ie,f[2]=Oe,f[3]=pe,T.clearBufferiv(T.COLOR,0,f))}else I|=T.COLOR_BUFFER_BIT}w&&(I|=T.DEPTH_BUFFER_BIT),D&&(I|=T.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),T.clear(I)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",Ue,!1),t.removeEventListener("webglcontextrestored",re,!1),t.removeEventListener("webglcontextcreationerror",Q,!1),te.dispose(),De.dispose(),_e.dispose(),ge.dispose(),We.dispose(),E.dispose(),Y.dispose(),He.dispose(),N.dispose(),$.dispose(),ae.dispose(),ae.removeEventListener("sessionstart",qa),ae.removeEventListener("sessionend",Nr),ar.stop()};function Ue(g){g.preventDefault(),vo("WebGLRenderer: Context Lost."),L=!0}function re(){vo("WebGLRenderer: Context Restored."),L=!1;let g=Ee.autoReset,w=we.enabled,D=we.autoUpdate,I=we.needsUpdate,P=we.type;xe(),Ee.autoReset=g,we.enabled=w,we.autoUpdate=D,we.needsUpdate=I,we.type=P}function Q(g){$e("WebGLRenderer: A WebGL context could not be created. Reason: ",g.statusMessage)}function Le(g){let w=g.target;w.removeEventListener("dispose",Le),Fe(w)}function Fe(g){gt(g),ge.remove(g)}function gt(g){let w=ge.get(g).programs;w!==void 0&&(w.forEach(function(D){$.releaseProgram(D)}),g.isShaderMaterial&&$.releaseShaderCache(g))}this.renderBufferDirect=function(g,w,D,I,P,H){w===null&&(w=je);let ne=P.isMesh&&P.matrixWorld.determinant()<0,he=Ya(g,w,D,I,P);oe.setMaterial(I,ne);let pe=D.index,Pe=1;if(I.wireframe===!0){if(pe=F.getWireframeAttribute(D),pe===void 0)return;Pe=2}let Ie=D.drawRange,Oe=D.attributes.position,Ye=Ie.start*Pe,et=(Ie.start+Ie.count)*Pe;H!==null&&(Ye=Math.max(Ye,H.start*Pe),et=Math.min(et,(H.start+H.count)*Pe)),pe!==null?(Ye=Math.max(Ye,0),et=Math.min(et,pe.count)):Oe!=null&&(Ye=Math.max(Ye,0),et=Math.min(et,Oe.count));let st=et-Ye;if(st<0||st===1/0)return;He.setup(P,I,he,D,pe);let ht,ot=Xe;if(pe!==null&&(ht=v.get(pe),ot=Be,ot.setIndex(ht)),P.isMesh)I.wireframe===!0?(oe.setLineWidth(I.wireframeLinewidth*Z()),ot.setMode(T.LINES)):ot.setMode(T.TRIANGLES);else if(P.isLine){let Ne=I.linewidth;Ne===void 0&&(Ne=1),oe.setLineWidth(Ne*Z()),P.isLineSegments?ot.setMode(T.LINES):P.isLineLoop?ot.setMode(T.LINE_LOOP):ot.setMode(T.LINE_STRIP)}else P.isPoints?ot.setMode(T.POINTS):P.isSprite&&ot.setMode(T.TRIANGLES);if(P.isBatchedMesh)if(P._multiDrawInstances!==null)Bi("WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),ot.renderMultiDrawInstances(P._multiDrawStarts,P._multiDrawCounts,P._multiDrawCount,P._multiDrawInstances);else if(se.get("WEBGL_multi_draw"))ot.renderMultiDraw(P._multiDrawStarts,P._multiDrawCounts,P._multiDrawCount);else{let Ne=P._multiDrawStarts,pt=P._multiDrawCounts,zt=P._multiDrawCount,bt=pe?v.get(pe).bytesPerElement:1,Dr=ge.get(I).currentProgram.getUniforms();for(let wt=0;wt<zt;wt++)Dr.setValue(T,"_gl_DrawID",wt),ot.render(Ne[wt]/bt,pt[wt])}else if(P.isInstancedMesh)ot.renderInstances(Ye,st,P.count);else if(D.isInstancedBufferGeometry){let Ne=D._maxInstanceCount!==void 0?D._maxInstanceCount:1/0,pt=Math.min(D.instanceCount,Ne);ot.renderInstances(Ye,st,pt)}else ot.render(Ye,st)};function nt(g,w,D){g.transparent===!0&&g.side===Wt&&g.forceSinglePass===!1?(g.side=Rt,g.needsUpdate=!0,Ai(g,w,D),g.side=yr,g.needsUpdate=!0,Ai(g,w,D),g.side=Wt):Ai(g,w,D)}this.compile=function(g,w,D=null){D===null&&(D=g),A=_e.get(D),A.init(w),b.push(A),D.traverseVisible(function(P){P.isLight&&P.layers.test(w.layers)&&(A.pushLight(P),P.castShadow&&A.pushShadow(P))}),g!==D&&g.traverseVisible(function(P){P.isLight&&P.layers.test(w.layers)&&(A.pushLight(P),P.castShadow&&A.pushShadow(P))}),A.setupLights();let I=new Set;return g.traverse(function(P){if(!(P.isMesh||P.isPoints||P.isLine||P.isSprite))return;let H=P.material;if(H)if(Array.isArray(H))for(let ne=0;ne<H.length;ne++){let he=H[ne];nt(he,D,P),I.add(he)}else nt(H,D,P),I.add(H)}),A=b.pop(),I},this.compileAsync=function(g,w,D=null){let I=this.compile(g,w,D);return new Promise(P=>{function H(){if(I.forEach(function(ne){ge.get(ne).currentProgram.isReady()&&I.delete(ne)}),I.size===0){P(g);return}setTimeout(H,10)}se.get("KHR_parallel_shader_compile")!==null?H():setTimeout(H,10)})};let Bt=null;function Ht(g){Bt&&Bt(g)}function qa(){ar.stop()}function Nr(){ar.start()}let ar=new pl;ar.setAnimationLoop(Ht),typeof self<"u"&&ar.setContext(self),this.setAnimationLoop=function(g){Bt=g,ae.setAnimationLoop(g),g===null?ar.stop():ar.start()},ae.addEventListener("sessionstart",qa),ae.addEventListener("sessionend",Nr),this.render=function(g,w){if(w!==void 0&&w.isCamera!==!0){$e("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(L===!0)return;if(g.matrixWorldAutoUpdate===!0&&g.updateMatrixWorld(),w.parent===null&&w.matrixWorldAutoUpdate===!0&&w.updateMatrixWorld(),ae.enabled===!0&&ae.isPresenting===!0&&(ae.cameraAutoUpdate===!0&&ae.updateCamera(w),w=ae.getCamera()),g.isScene===!0&&g.onBeforeRender(C,g,w,M),A=_e.get(g,b.length),A.init(w),b.push(A),be.multiplyMatrices(w.projectionMatrix,w.matrixWorldInverse),K.setFromProjectionMatrix(be,er,w.reversedDepth),ce=this.localClippingEnabled,fe=Re.init(this.clippingPlanes,ce),p=De.get(g,S.length),p.init(),S.push(p),ae.enabled===!0&&ae.isPresenting===!0){let H=C.xr.getDepthSensingMesh();H!==null&&na(H,w,-1/0,C.sortObjects)}na(g,w,0,C.sortObjects),p.finish(),C.sortObjects===!0&&p.sort(Se,Ge),qe=ae.enabled===!1||ae.isPresenting===!1||ae.hasDepthSensing()===!1,qe&&te.addToRenderList(p,g),this.info.render.frame++,fe===!0&&Re.beginShadows();let D=A.state.shadowsArray;we.render(D,g,w),fe===!0&&Re.endShadows(),this.info.autoReset===!0&&this.info.reset();let I=p.opaque,P=p.transmissive;if(A.setupLights(),w.isArrayCamera){let H=w.cameras;if(P.length>0)for(let ne=0,he=H.length;ne<he;ne++){let pe=H[ne];xr(I,P,g,pe)}qe&&te.render(g);for(let ne=0,he=H.length;ne<he;ne++){let pe=H[ne];ja(p,g,pe,pe.viewport)}}else P.length>0&&xr(I,P,g,w),qe&&te.render(g),ja(p,g,w);M!==null&&B===0&&(Ce.updateMultisampleRenderTarget(M),Ce.updateRenderTargetMipmap(M)),g.isScene===!0&&g.onAfterRender(C,g,w),He.resetDefaultState(),y=-1,R=null,b.pop(),b.length>0?(A=b[b.length-1],fe===!0&&Re.setGlobalState(C.clippingPlanes,A.state.camera)):A=null,S.pop(),S.length>0?p=S[S.length-1]:p=null};function na(g,w,D,I){if(g.visible===!1)return;if(g.layers.test(w.layers)){if(g.isGroup)D=g.renderOrder;else if(g.isLOD)g.autoUpdate===!0&&g.update(w);else if(g.isLight)A.pushLight(g),g.castShadow&&A.pushShadow(g);else if(g.isSprite){if(!g.frustumCulled||K.intersectsSprite(g)){I&&Ae.setFromMatrixPosition(g.matrixWorld).applyMatrix4(be);let H=Y.update(g),ne=g.material;ne.visible&&p.push(g,H,ne,D,Ae.z,null)}}else if((g.isMesh||g.isLine||g.isPoints)&&(!g.frustumCulled||K.intersectsObject(g))){let H=Y.update(g),ne=g.material;if(I&&(g.boundingSphere!==void 0?(g.boundingSphere===null&&g.computeBoundingSphere(),Ae.copy(g.boundingSphere.center)):(H.boundingSphere===null&&H.computeBoundingSphere(),Ae.copy(H.boundingSphere.center)),Ae.applyMatrix4(g.matrixWorld).applyMatrix4(be)),Array.isArray(ne)){let he=H.groups;for(let pe=0,Pe=he.length;pe<Pe;pe++){let Ie=he[pe],Oe=ne[Ie.materialIndex];Oe&&Oe.visible&&p.push(g,H,Oe,D,Ae.z,Ie)}}else ne.visible&&p.push(g,H,ne,D,Ae.z,null)}}let P=g.children;for(let H=0,ne=P.length;H<ne;H++)na(P[H],w,D,I)}function ja(g,w,D,I){let{opaque:P,transmissive:H,transparent:ne}=g;A.setupLightsView(D),fe===!0&&Re.setGlobalState(C.clippingPlanes,D),I&&oe.viewport(q.copy(I)),P.length>0&&bi(P,w,D),H.length>0&&bi(H,w,D),ne.length>0&&bi(ne,w,D),oe.buffers.depth.setTest(!0),oe.buffers.depth.setMask(!0),oe.buffers.color.setMask(!0),oe.setPolygonOffset(!1)}function xr(g,w,D,I){if((D.isScene===!0?D.overrideMaterial:null)!==null)return;A.state.transmissionRenderTarget[I.id]===void 0&&(A.state.transmissionRenderTarget[I.id]=new zr(1,1,{generateMipmaps:!0,type:se.has("EXT_color_buffer_half_float")||se.has("EXT_color_buffer_float")?Qt:$t,minFilter:Tr,samples:4,stencilBuffer:a,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:at.workingColorSpace}));let P=A.state.transmissionRenderTarget[I.id],H=I.viewport||q;P.setSize(H.z*C.transmissionResolutionScale,H.w*C.transmissionResolutionScale);let ne=C.getRenderTarget(),he=C.getActiveCubeFace(),pe=C.getActiveMipmapLevel();C.setRenderTarget(P),C.getClearColor(ee),j=C.getClearAlpha(),j<1&&C.setClearColor(16777215,.5),C.clear(),qe&&te.render(D);let Pe=C.toneMapping;C.toneMapping=Sr;let Ie=I.viewport;if(I.viewport!==void 0&&(I.viewport=void 0),A.setupLightsView(I),fe===!0&&Re.setGlobalState(C.clippingPlanes,I),bi(g,D,I),Ce.updateMultisampleRenderTarget(P),Ce.updateRenderTargetMipmap(P),se.has("WEBGL_multisampled_render_to_texture")===!1){let Oe=!1;for(let Ye=0,et=w.length;Ye<et;Ye++){let st=w[Ye],{object:ht,geometry:ot,material:Ne,group:pt}=st;if(Ne.side===Wt&&ht.layers.test(I.layers)){let zt=Ne.side;Ne.side=Rt,Ne.needsUpdate=!0,wi(ht,D,I,ot,Ne,pt),Ne.side=zt,Ne.needsUpdate=!0,Oe=!0}}Oe===!0&&(Ce.updateMultisampleRenderTarget(P),Ce.updateRenderTargetMipmap(P))}C.setRenderTarget(ne,he,pe),C.setClearColor(ee,j),Ie!==void 0&&(I.viewport=Ie),C.toneMapping=Pe}function bi(g,w,D){let I=w.isScene===!0?w.overrideMaterial:null;for(let P=0,H=g.length;P<H;P++){let ne=g[P],{object:he,geometry:pe,group:Pe}=ne,Ie=ne.material;Ie.allowOverride===!0&&I!==null&&(Ie=I),he.layers.test(D.layers)&&wi(he,w,D,pe,Ie,Pe)}}function wi(g,w,D,I,P,H){g.onBeforeRender(C,w,D,I,P,H),g.modelViewMatrix.multiplyMatrices(D.matrixWorldInverse,g.matrixWorld),g.normalMatrix.getNormalMatrix(g.modelViewMatrix),P.onBeforeRender(C,w,D,I,g,H),P.transparent===!0&&P.side===Wt&&P.forceSinglePass===!1?(P.side=Rt,P.needsUpdate=!0,C.renderBufferDirect(D,w,I,P,g,H),P.side=yr,P.needsUpdate=!0,C.renderBufferDirect(D,w,I,P,g,H),P.side=Wt):C.renderBufferDirect(D,w,I,P,g,H),g.onAfterRender(C,w,D,I,P,H)}function Ai(g,w,D){w.isScene!==!0&&(w=je);let I=ge.get(g),P=A.state.lights,H=A.state.shadowsArray,ne=P.state.version,he=$.getParameters(g,P.state,H,w,D),pe=$.getProgramCacheKey(he),Pe=I.programs;I.environment=g.isMeshStandardMaterial?w.environment:null,I.fog=w.fog,I.envMap=(g.isMeshStandardMaterial?E:We).get(g.envMap||I.environment),I.envMapRotation=I.environment!==null&&g.envMap===null?w.environmentRotation:g.envMapRotation,Pe===void 0&&(g.addEventListener("dispose",Le),Pe=new Map,I.programs=Pe);let Ie=Pe.get(pe);if(Ie!==void 0){if(I.currentProgram===Ie&&I.lightsStateVersion===ne)return Ci(g,he),Ie}else he.uniforms=$.getUniforms(g),g.onBeforeCompile(he,C),Ie=$.acquireProgram(he,pe),Pe.set(pe,Ie),I.uniforms=he.uniforms;let Oe=I.uniforms;return(!g.isShaderMaterial&&!g.isRawShaderMaterial||g.clipping===!0)&&(Oe.clippingPlanes=Re.uniform),Ci(g,he),I.needsLights=O(g),I.lightsStateVersion=ne,I.needsLights&&(Oe.ambientLightColor.value=P.state.ambient,Oe.lightProbe.value=P.state.probe,Oe.directionalLights.value=P.state.directional,Oe.directionalLightShadows.value=P.state.directionalShadow,Oe.spotLights.value=P.state.spot,Oe.spotLightShadows.value=P.state.spotShadow,Oe.rectAreaLights.value=P.state.rectArea,Oe.ltc_1.value=P.state.rectAreaLTC1,Oe.ltc_2.value=P.state.rectAreaLTC2,Oe.pointLights.value=P.state.point,Oe.pointLightShadows.value=P.state.pointShadow,Oe.hemisphereLights.value=P.state.hemi,Oe.directionalShadowMap.value=P.state.directionalShadowMap,Oe.directionalShadowMatrix.value=P.state.directionalShadowMatrix,Oe.spotShadowMap.value=P.state.spotShadowMap,Oe.spotLightMatrix.value=P.state.spotLightMatrix,Oe.spotLightMap.value=P.state.spotLightMap,Oe.pointShadowMap.value=P.state.pointShadowMap,Oe.pointShadowMatrix.value=P.state.pointShadowMatrix),I.currentProgram=Ie,I.uniformsList=null,Ie}function sa(g){if(g.uniformsList===null){let w=g.currentProgram.getUniforms();g.uniformsList=Wa.seqWithValue(w.seq,g.uniforms)}return g.uniformsList}function Ci(g,w){let D=ge.get(g);D.outputColorSpace=w.outputColorSpace,D.batching=w.batching,D.batchingColor=w.batchingColor,D.instancing=w.instancing,D.instancingColor=w.instancingColor,D.instancingMorph=w.instancingMorph,D.skinning=w.skinning,D.morphTargets=w.morphTargets,D.morphNormals=w.morphNormals,D.morphColors=w.morphColors,D.morphTargetsCount=w.morphTargetsCount,D.numClippingPlanes=w.numClippingPlanes,D.numIntersection=w.numClipIntersection,D.vertexAlphas=w.vertexAlphas,D.vertexTangents=w.vertexTangents,D.toneMapping=w.toneMapping}function Ya(g,w,D,I,P){w.isScene!==!0&&(w=je),Ce.resetTextureUnits();let H=w.fog,ne=I.isMeshStandardMaterial?w.environment:null,he=M===null?C.outputColorSpace:M.isXRRenderTarget===!0?M.texture.colorSpace:Br,pe=(I.isMeshStandardMaterial?E:We).get(I.envMap||ne),Pe=I.vertexColors===!0&&!!D.attributes.color&&D.attributes.color.itemSize===4,Ie=!!D.attributes.tangent&&(!!I.normalMap||I.anisotropy>0),Oe=!!D.morphAttributes.position,Ye=!!D.morphAttributes.normal,et=!!D.morphAttributes.color,st=Sr;I.toneMapped&&(M===null||M.isXRRenderTarget===!0)&&(st=C.toneMapping);let ht=D.morphAttributes.position||D.morphAttributes.normal||D.morphAttributes.color,ot=ht!==void 0?ht.length:0,Ne=ge.get(I),pt=A.state.lights;if(fe===!0&&(ce===!0||g!==R)){let _t=g===R&&I.id===y;Re.setState(I,g,_t)}let zt=!1;I.version===Ne.__version?(Ne.needsLights&&Ne.lightsStateVersion!==pt.state.version||Ne.outputColorSpace!==he||P.isBatchedMesh&&Ne.batching===!1||!P.isBatchedMesh&&Ne.batching===!0||P.isBatchedMesh&&Ne.batchingColor===!0&&P.colorTexture===null||P.isBatchedMesh&&Ne.batchingColor===!1&&P.colorTexture!==null||P.isInstancedMesh&&Ne.instancing===!1||!P.isInstancedMesh&&Ne.instancing===!0||P.isSkinnedMesh&&Ne.skinning===!1||!P.isSkinnedMesh&&Ne.skinning===!0||P.isInstancedMesh&&Ne.instancingColor===!0&&P.instanceColor===null||P.isInstancedMesh&&Ne.instancingColor===!1&&P.instanceColor!==null||P.isInstancedMesh&&Ne.instancingMorph===!0&&P.morphTexture===null||P.isInstancedMesh&&Ne.instancingMorph===!1&&P.morphTexture!==null||Ne.envMap!==pe||I.fog===!0&&Ne.fog!==H||Ne.numClippingPlanes!==void 0&&(Ne.numClippingPlanes!==Re.numPlanes||Ne.numIntersection!==Re.numIntersection)||Ne.vertexAlphas!==Pe||Ne.vertexTangents!==Ie||Ne.morphTargets!==Oe||Ne.morphNormals!==Ye||Ne.morphColors!==et||Ne.toneMapping!==st||Ne.morphTargetsCount!==ot)&&(zt=!0):(zt=!0,Ne.__version=I.version);let bt=Ne.currentProgram;zt===!0&&(bt=Ai(I,w,P));let Dr=!1,wt=!1,Ir=!1,rt=bt.getUniforms(),yt=Ne.uniforms;if(oe.useProgram(bt.program)&&(Dr=!0,wt=!0,Ir=!0),I.id!==y&&(y=I.id,wt=!0),Dr||R!==g){oe.buffers.depth.getReversed()&&g.reversedDepth!==!0&&(g._reversedDepth=!0,g.updateProjectionMatrix()),rt.setValue(T,"projectionMatrix",g.projectionMatrix),rt.setValue(T,"viewMatrix",g.matrixWorldInverse);let _t=rt.map.cameraPosition;_t!==void 0&&_t.setValue(T,Ve.setFromMatrixPosition(g.matrixWorld)),me.logarithmicDepthBuffer&&rt.setValue(T,"logDepthBufFC",2/(Math.log(g.far+1)/Math.LN2)),(I.isMeshPhongMaterial||I.isMeshToonMaterial||I.isMeshLambertMaterial||I.isMeshBasicMaterial||I.isMeshStandardMaterial||I.isShaderMaterial)&&rt.setValue(T,"isOrthographic",g.isOrthographicCamera===!0),R!==g&&(R=g,wt=!0,Ir=!0)}if(P.isSkinnedMesh){rt.setOptional(T,P,"bindMatrix"),rt.setOptional(T,P,"bindMatrixInverse");let _t=P.skeleton;_t&&(_t.boneTexture===null&&_t.computeBoneTexture(),rt.setValue(T,"boneTexture",_t.boneTexture,Ce))}P.isBatchedMesh&&(rt.setOptional(T,P,"batchingTexture"),rt.setValue(T,"batchingTexture",P._matricesTexture,Ce),rt.setOptional(T,P,"batchingIdTexture"),rt.setValue(T,"batchingIdTexture",P._indirectTexture,Ce),rt.setOptional(T,P,"batchingColorTexture"),P._colorsTexture!==null&&rt.setValue(T,"batchingColorTexture",P._colorsTexture,Ce));let At=D.morphAttributes;if((At.position!==void 0||At.normal!==void 0||At.color!==void 0)&&Te.update(P,D,bt),(wt||Ne.receiveShadow!==P.receiveShadow)&&(Ne.receiveShadow=P.receiveShadow,rt.setValue(T,"receiveShadow",P.receiveShadow)),I.isMeshGouraudMaterial&&I.envMap!==null&&(yt.envMap.value=pe,yt.flipEnvMap.value=pe.isCubeTexture&&pe.isRenderTargetTexture===!1?-1:1),I.isMeshStandardMaterial&&I.envMap===null&&w.environment!==null&&(yt.envMapIntensity.value=w.environmentIntensity),yt.dfgLUT!==void 0&&(yt.dfgLUT.value=yg()),wt&&(rt.setValue(T,"toneMappingExposure",C.toneMappingExposure),Ne.needsLights&&Ur(yt,Ir),H&&I.fog===!0&&J.refreshFogUniforms(yt,H),J.refreshMaterialUniforms(yt,I,ie,X,A.state.transmissionRenderTarget[g.id]),Wa.upload(T,sa(Ne),yt,Ce)),I.isShaderMaterial&&I.uniformsNeedUpdate===!0&&(Wa.upload(T,sa(Ne),yt,Ce),I.uniformsNeedUpdate=!1),I.isSpriteMaterial&&rt.setValue(T,"center",P.center),rt.setValue(T,"modelViewMatrix",P.modelViewMatrix),rt.setValue(T,"normalMatrix",P.normalMatrix),rt.setValue(T,"modelMatrix",P.matrixWorld),I.isShaderMaterial||I.isRawShaderMaterial){let _t=I.uniformsGroups;for(let Ut=0,Ri=_t.length;Ut<Ri;Ut++){let Mr=_t[Ut];N.update(Mr,bt),N.bind(Mr,bt)}}return bt}function Ur(g,w){g.ambientLightColor.needsUpdate=w,g.lightProbe.needsUpdate=w,g.directionalLights.needsUpdate=w,g.directionalLightShadows.needsUpdate=w,g.pointLights.needsUpdate=w,g.pointLightShadows.needsUpdate=w,g.spotLights.needsUpdate=w,g.spotLightShadows.needsUpdate=w,g.rectAreaLights.needsUpdate=w,g.hemisphereLights.needsUpdate=w}function O(g){return g.isMeshLambertMaterial||g.isMeshToonMaterial||g.isMeshPhongMaterial||g.isMeshStandardMaterial||g.isShadowMaterial||g.isShaderMaterial&&g.lights===!0}this.getActiveCubeFace=function(){return U},this.getActiveMipmapLevel=function(){return B},this.getRenderTarget=function(){return M},this.setRenderTargetTextures=function(g,w,D){let I=ge.get(g);I.__autoAllocateDepthBuffer=g.resolveDepthBuffer===!1,I.__autoAllocateDepthBuffer===!1&&(I.__useRenderToTexture=!1),ge.get(g.texture).__webglTexture=w,ge.get(g.depthTexture).__webglTexture=I.__autoAllocateDepthBuffer?void 0:D,I.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(g,w){let D=ge.get(g);D.__webglFramebuffer=w,D.__useDefaultFramebuffer=w===void 0};let G=T.createFramebuffer();this.setRenderTarget=function(g,w=0,D=0){M=g,U=w,B=D;let I=!0,P=null,H=!1,ne=!1;if(g){let he=ge.get(g);if(he.__useDefaultFramebuffer!==void 0)oe.bindFramebuffer(T.FRAMEBUFFER,null),I=!1;else if(he.__webglFramebuffer===void 0)Ce.setupRenderTarget(g);else if(he.__hasExternalTextures)Ce.rebindTextures(g,ge.get(g.texture).__webglTexture,ge.get(g.depthTexture).__webglTexture);else if(g.depthBuffer){let Ie=g.depthTexture;if(he.__boundDepthTexture!==Ie){if(Ie!==null&&ge.has(Ie)&&(g.width!==Ie.image.width||g.height!==Ie.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");Ce.setupDepthRenderbuffer(g)}}let pe=g.texture;(pe.isData3DTexture||pe.isDataArrayTexture||pe.isCompressedArrayTexture)&&(ne=!0);let Pe=ge.get(g).__webglFramebuffer;g.isWebGLCubeRenderTarget?(Array.isArray(Pe[w])?P=Pe[w][D]:P=Pe[w],H=!0):g.samples>0&&Ce.useMultisampledRTT(g)===!1?P=ge.get(g).__webglMultisampledFramebuffer:Array.isArray(Pe)?P=Pe[D]:P=Pe,q.copy(g.viewport),W.copy(g.scissor),k=g.scissorTest}else q.copy(ze).multiplyScalar(ie).floor(),W.copy(it).multiplyScalar(ie).floor(),k=tt;if(D!==0&&(P=G),oe.bindFramebuffer(T.FRAMEBUFFER,P)&&I&&oe.drawBuffers(g,P),oe.viewport(q),oe.scissor(W),oe.setScissorTest(k),H){let he=ge.get(g.texture);T.framebufferTexture2D(T.FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_CUBE_MAP_POSITIVE_X+w,he.__webglTexture,D)}else if(ne){let he=w;for(let pe=0;pe<g.textures.length;pe++){let Pe=ge.get(g.textures[pe]);T.framebufferTextureLayer(T.FRAMEBUFFER,T.COLOR_ATTACHMENT0+pe,Pe.__webglTexture,D,he)}}else if(g!==null&&D!==0){let he=ge.get(g.texture);T.framebufferTexture2D(T.FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_2D,he.__webglTexture,D)}y=-1},this.readRenderTargetPixels=function(g,w,D,I,P,H,ne,he=0){if(!(g&&g.isWebGLRenderTarget)){$e("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let pe=ge.get(g).__webglFramebuffer;if(g.isWebGLCubeRenderTarget&&ne!==void 0&&(pe=pe[ne]),pe){oe.bindFramebuffer(T.FRAMEBUFFER,pe);try{let Pe=g.textures[he],Ie=Pe.format,Oe=Pe.type;if(!me.textureFormatReadable(Ie)){$e("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!me.textureTypeReadable(Oe)){$e("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}w>=0&&w<=g.width-I&&D>=0&&D<=g.height-P&&(g.textures.length>1&&T.readBuffer(T.COLOR_ATTACHMENT0+he),T.readPixels(w,D,I,P,ve.convert(Ie),ve.convert(Oe),H))}finally{let Pe=M!==null?ge.get(M).__webglFramebuffer:null;oe.bindFramebuffer(T.FRAMEBUFFER,Pe)}}},this.readRenderTargetPixelsAsync=async function(g,w,D,I,P,H,ne,he=0){if(!(g&&g.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let pe=ge.get(g).__webglFramebuffer;if(g.isWebGLCubeRenderTarget&&ne!==void 0&&(pe=pe[ne]),pe)if(w>=0&&w<=g.width-I&&D>=0&&D<=g.height-P){oe.bindFramebuffer(T.FRAMEBUFFER,pe);let Pe=g.textures[he],Ie=Pe.format,Oe=Pe.type;if(!me.textureFormatReadable(Ie))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!me.textureTypeReadable(Oe))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Ye=T.createBuffer();T.bindBuffer(T.PIXEL_PACK_BUFFER,Ye),T.bufferData(T.PIXEL_PACK_BUFFER,H.byteLength,T.STREAM_READ),g.textures.length>1&&T.readBuffer(T.COLOR_ATTACHMENT0+he),T.readPixels(w,D,I,P,ve.convert(Ie),ve.convert(Oe),0);let et=M!==null?ge.get(M).__webglFramebuffer:null;oe.bindFramebuffer(T.FRAMEBUFFER,et);let st=T.fenceSync(T.SYNC_GPU_COMMANDS_COMPLETE,0);return T.flush(),await zh(T,st,4),T.bindBuffer(T.PIXEL_PACK_BUFFER,Ye),T.getBufferSubData(T.PIXEL_PACK_BUFFER,0,H),T.deleteBuffer(Ye),T.deleteSync(st),H}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(g,w=null,D=0){let I=Math.pow(2,-D),P=Math.floor(g.image.width*I),H=Math.floor(g.image.height*I),ne=w!==null?w.x:0,he=w!==null?w.y:0;Ce.setTexture2D(g,0),T.copyTexSubImage2D(T.TEXTURE_2D,D,0,0,ne,he,P,H),oe.unbindTexture()};let V=T.createFramebuffer(),ue=T.createFramebuffer();this.copyTextureToTexture=function(g,w,D=null,I=null,P=0,H=null){H===null&&(P!==0?(Bi("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),H=P,P=0):H=0);let ne,he,pe,Pe,Ie,Oe,Ye,et,st,ht=g.isCompressedTexture?g.mipmaps[H]:g.image;if(D!==null)ne=D.max.x-D.min.x,he=D.max.y-D.min.y,pe=D.isBox3?D.max.z-D.min.z:1,Pe=D.min.x,Ie=D.min.y,Oe=D.isBox3?D.min.z:0;else{let At=Math.pow(2,-P);ne=Math.floor(ht.width*At),he=Math.floor(ht.height*At),g.isDataArrayTexture?pe=ht.depth:g.isData3DTexture?pe=Math.floor(ht.depth*At):pe=1,Pe=0,Ie=0,Oe=0}I!==null?(Ye=I.x,et=I.y,st=I.z):(Ye=0,et=0,st=0);let ot=ve.convert(w.format),Ne=ve.convert(w.type),pt;w.isData3DTexture?(Ce.setTexture3D(w,0),pt=T.TEXTURE_3D):w.isDataArrayTexture||w.isCompressedArrayTexture?(Ce.setTexture2DArray(w,0),pt=T.TEXTURE_2D_ARRAY):(Ce.setTexture2D(w,0),pt=T.TEXTURE_2D),T.pixelStorei(T.UNPACK_FLIP_Y_WEBGL,w.flipY),T.pixelStorei(T.UNPACK_PREMULTIPLY_ALPHA_WEBGL,w.premultiplyAlpha),T.pixelStorei(T.UNPACK_ALIGNMENT,w.unpackAlignment);let zt=T.getParameter(T.UNPACK_ROW_LENGTH),bt=T.getParameter(T.UNPACK_IMAGE_HEIGHT),Dr=T.getParameter(T.UNPACK_SKIP_PIXELS),wt=T.getParameter(T.UNPACK_SKIP_ROWS),Ir=T.getParameter(T.UNPACK_SKIP_IMAGES);T.pixelStorei(T.UNPACK_ROW_LENGTH,ht.width),T.pixelStorei(T.UNPACK_IMAGE_HEIGHT,ht.height),T.pixelStorei(T.UNPACK_SKIP_PIXELS,Pe),T.pixelStorei(T.UNPACK_SKIP_ROWS,Ie),T.pixelStorei(T.UNPACK_SKIP_IMAGES,Oe);let rt=g.isDataArrayTexture||g.isData3DTexture,yt=w.isDataArrayTexture||w.isData3DTexture;if(g.isDepthTexture){let At=ge.get(g),_t=ge.get(w),Ut=ge.get(At.__renderTarget),Ri=ge.get(_t.__renderTarget);oe.bindFramebuffer(T.READ_FRAMEBUFFER,Ut.__webglFramebuffer),oe.bindFramebuffer(T.DRAW_FRAMEBUFFER,Ri.__webglFramebuffer);for(let Mr=0;Mr<pe;Mr++)rt&&(T.framebufferTextureLayer(T.READ_FRAMEBUFFER,T.COLOR_ATTACHMENT0,ge.get(g).__webglTexture,P,Oe+Mr),T.framebufferTextureLayer(T.DRAW_FRAMEBUFFER,T.COLOR_ATTACHMENT0,ge.get(w).__webglTexture,H,st+Mr)),T.blitFramebuffer(Pe,Ie,ne,he,Ye,et,ne,he,T.DEPTH_BUFFER_BIT,T.NEAREST);oe.bindFramebuffer(T.READ_FRAMEBUFFER,null),oe.bindFramebuffer(T.DRAW_FRAMEBUFFER,null)}else if(P!==0||g.isRenderTargetTexture||ge.has(g)){let At=ge.get(g),_t=ge.get(w);oe.bindFramebuffer(T.READ_FRAMEBUFFER,V),oe.bindFramebuffer(T.DRAW_FRAMEBUFFER,ue);for(let Ut=0;Ut<pe;Ut++)rt?T.framebufferTextureLayer(T.READ_FRAMEBUFFER,T.COLOR_ATTACHMENT0,At.__webglTexture,P,Oe+Ut):T.framebufferTexture2D(T.READ_FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_2D,At.__webglTexture,P),yt?T.framebufferTextureLayer(T.DRAW_FRAMEBUFFER,T.COLOR_ATTACHMENT0,_t.__webglTexture,H,st+Ut):T.framebufferTexture2D(T.DRAW_FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_2D,_t.__webglTexture,H),P!==0?T.blitFramebuffer(Pe,Ie,ne,he,Ye,et,ne,he,T.COLOR_BUFFER_BIT,T.NEAREST):yt?T.copyTexSubImage3D(pt,H,Ye,et,st+Ut,Pe,Ie,ne,he):T.copyTexSubImage2D(pt,H,Ye,et,Pe,Ie,ne,he);oe.bindFramebuffer(T.READ_FRAMEBUFFER,null),oe.bindFramebuffer(T.DRAW_FRAMEBUFFER,null)}else yt?g.isDataTexture||g.isData3DTexture?T.texSubImage3D(pt,H,Ye,et,st,ne,he,pe,ot,Ne,ht.data):w.isCompressedArrayTexture?T.compressedTexSubImage3D(pt,H,Ye,et,st,ne,he,pe,ot,ht.data):T.texSubImage3D(pt,H,Ye,et,st,ne,he,pe,ot,Ne,ht):g.isDataTexture?T.texSubImage2D(T.TEXTURE_2D,H,Ye,et,ne,he,ot,Ne,ht.data):g.isCompressedTexture?T.compressedTexSubImage2D(T.TEXTURE_2D,H,Ye,et,ht.width,ht.height,ot,ht.data):T.texSubImage2D(T.TEXTURE_2D,H,Ye,et,ne,he,ot,Ne,ht);T.pixelStorei(T.UNPACK_ROW_LENGTH,zt),T.pixelStorei(T.UNPACK_IMAGE_HEIGHT,bt),T.pixelStorei(T.UNPACK_SKIP_PIXELS,Dr),T.pixelStorei(T.UNPACK_SKIP_ROWS,wt),T.pixelStorei(T.UNPACK_SKIP_IMAGES,Ir),H===0&&w.generateMipmaps&&T.generateMipmap(pt),oe.unbindTexture()},this.initRenderTarget=function(g){ge.get(g).__webglFramebuffer===void 0&&Ce.setupRenderTarget(g)},this.initTexture=function(g){g.isCubeTexture?Ce.setTextureCube(g,0):g.isData3DTexture?Ce.setTexture3D(g,0):g.isDataArrayTexture||g.isCompressedArrayTexture?Ce.setTexture2DArray(g,0):Ce.setTexture2D(g,0),oe.unbindTexture()},this.resetState=function(){U=0,B=0,M=null,oe.reset(),He.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return er}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=at._getDrawingBufferColorSpace(e),t.unpackColorSpace=at._getUnpackColorSpace()}},Tg=class extends _u{constructor(e){super(e),this.type=Qt}parse(e){let t=function(_,f){switch(_){case 1:throw new Error("THREE.HDRLoader: Read Error: "+(f||""));case 2:throw new Error("THREE.HDRLoader: Write Error: "+(f||""));case 3:throw new Error("THREE.HDRLoader: Bad File Format: "+(f||""));default:case 4:throw new Error("THREE.HDRLoader: Memory Error: "+(f||""))}},r=function(_,f,p){f=f||1024;let A=_.pos,S=-1,b=0,C="",L=String.fromCharCode.apply(null,new Uint16Array(_.subarray(A,A+128)));for(;0>(S=L.indexOf(`
`))&&b<f&&A<_.byteLength;)C+=L,b+=L.length,A+=128,L+=String.fromCharCode.apply(null,new Uint16Array(_.subarray(A,A+128)));return-1<S?(p!==!1&&(_.pos+=b+S+1),C+L.slice(0,S)):!1},i=function(_){let f=/^#\?(\S+)/,p=/^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,A=/^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,S=/^\s*FORMAT=(\S+)\s*$/,b=/^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,C={valid:0,string:"",comments:"",programtype:"RGBE",format:"",gamma:1,exposure:1,width:0,height:0},L,U;for((_.pos>=_.byteLength||!(L=r(_)))&&t(1,"no header found"),(U=L.match(f))||t(3,"bad initial token"),C.valid|=1,C.programtype=U[1],C.string+=L+`
`;L=r(_),L!==!1;){if(C.string+=L+`
`,L.charAt(0)==="#"){C.comments+=L+`
`;continue}if((U=L.match(p))&&(C.gamma=parseFloat(U[1])),(U=L.match(A))&&(C.exposure=parseFloat(U[1])),(U=L.match(S))&&(C.valid|=2,C.format=U[1]),(U=L.match(b))&&(C.valid|=4,C.height=parseInt(U[1],10),C.width=parseInt(U[2],10)),C.valid&2&&C.valid&4)break}return C.valid&2||t(3,"missing format specifier"),C.valid&4||t(3,"missing image size specifier"),C},a=function(_,f,p){let A=f;if(A<8||A>32767||_[0]!==2||_[1]!==2||_[2]&128)return new Uint8Array(_);A!==(_[2]<<8|_[3])&&t(3,"wrong scanline width");let S=new Uint8Array(4*f*p);S.length||t(4,"unable to allocate buffer space");let b=0,C=0,L=4*A,U=new Uint8Array(4),B=new Uint8Array(L),M=p;for(;M>0&&C<_.byteLength;){C+4>_.byteLength&&t(1),U[0]=_[C++],U[1]=_[C++],U[2]=_[C++],U[3]=_[C++],(U[0]!=2||U[1]!=2||(U[2]<<8|U[3])!=A)&&t(3,"bad rgbe scanline format");let y=0,R;for(;y<L&&C<_.byteLength;){R=_[C++];let W=R>128;if(W&&(R-=128),(R===0||y+R>L)&&t(3,"bad scanline data"),W){let k=_[C++];for(let ee=0;ee<R;ee++)B[y++]=k}else B.set(_.subarray(C,C+R),y),y+=R,C+=R}let q=A;for(let W=0;W<q;W++){let k=0;S[b]=B[W+k],k+=A,S[b+1]=B[W+k],k+=A,S[b+2]=B[W+k],k+=A,S[b+3]=B[W+k],b+=4}M--}return S},n=function(_,f,p,A){let S=_[f+3],b=Math.pow(2,S-128)/255;p[A+0]=_[f+0]*b,p[A+1]=_[f+1]*b,p[A+2]=_[f+2]*b,p[A+3]=1},s=function(_,f,p,A){let S=_[f+3],b=Math.pow(2,S-128)/255;p[A+0]=ba.toHalfFloat(Math.min(_[f+0]*b,65504)),p[A+1]=ba.toHalfFloat(Math.min(_[f+1]*b,65504)),p[A+2]=ba.toHalfFloat(Math.min(_[f+2]*b,65504)),p[A+3]=ba.toHalfFloat(1)},o=new Uint8Array(e);o.pos=0;let l=i(o),h=l.width,c=l.height,u=a(o.subarray(o.pos),h,c),d,m,x;switch(this.type){case Vt:x=u.length/4;let _=new Float32Array(x*4);for(let p=0;p<x;p++)n(u,p*4,_,p*4);d=_,m=Vt;break;case Qt:x=u.length/4;let f=new Uint16Array(x*4);for(let p=0;p<x;p++)s(u,p*4,f,p*4);d=f,m=Qt;break;default:throw new Error("THREE.HDRLoader: Unsupported type: "+this.type)}return{width:h,height:c,data:d,header:l.string,gamma:l.gamma,exposure:l.exposure,type:m}}setDataType(e){return this.type=e,this}load(e,t,r,i){function a(n,s){switch(n.type){case Vt:case Qt:n.colorSpace=Br,n.minFilter=St,n.magFilter=St,n.generateMipmaps=!1,n.flipY=!0;break}t&&t(n,s)}return super.load(e,a,r,i)}};(async()=>{let e=window.__GST,t=e.st;if(window.__gstInstance&&window.__gstInstance.dispose)try{window.__gstInstance.dispose()}catch{}let r=document.getElementById("gst-canvas"),i=new Sg({canvas:r,alpha:!0,antialias:!0,preserveDrawingBuffer:!0});i.setSize(1920,1080,!1),i.setPixelRatio(1),i.setClearColor(657935,1),i.toneMapping=Qs;let a=42,n=5.2,s=.6,o=new mc,l=Math.max(60,n+Math.max(-e.vars.zDist,-e.vars.zOut,0)*1.15+e.vars.sideDist*1.5+12),h=new Nt(a,1920/1080,.1,l);h.position.set(0,0,n);let c=2*(n-s)*Math.tan(a*Math.PI/360),u=c*(1920/1080);o.add(new Eu(16777215,.6));let d=new Mu(16777215,7,0,Math.PI/4,.5,1);d.position.set(0,7.1,2),o.add(d);let m=new Su(13426175,4,0,1);m.position.set(0,-3,1),o.add(m);let x=await new Tg().loadAsync("assets/ferndale_studio_01_1k.hdr"),_=new Hs(i),f=_.fromEquirectangular(x);o.environment=f.texture,o.environmentRotation=new cr(0,.6,0),x.dispose(),_.dispose();let p=await new vu().loadAsync("assets/matcap-1.png");p.colorSpace=Pt,p.wrapS=p.wrapT=Ni;let A=1/.2;p.repeat.set(A,A),p.offset.set((1-A)*.5,(1-A)*.5);try{await Promise.all([document.fonts.load('600 100px "Geist"'),document.fonts.load('400 100px "Geist"')]),await document.fonts.ready}catch{}let S=4096,b=Math.round(S*(c/u)),C=document.createElement("canvas");C.width=S,C.height=b;let L=C.getContext("2d");{L.clearRect(0,0,S,b),L.textAlign="center",L.textBaseline="middle";let O=300;L.font=`600 ${O}px "Geist", ui-sans-serif, sans-serif`,L.letterSpacing=`${-.035*O}px`;let G=L.measureText(e.vars.headline).width,V=S*.7;G>V&&(O=Math.floor(O*V/G)),L.font=`600 ${O}px "Geist", ui-sans-serif, sans-serif`,L.letterSpacing=`${-.035*O}px`,L.fillStyle="#f4f4f8",L.fillText(e.vars.headline,S/2,b/2),e.fontPx=O}let U=new Wo(C);U.colorSpace=Pt,U.anisotropy=16;let B=document.createElement("canvas");B.width=1280,B.height=Math.round(1280*(c/u));let M=B.getContext("2d",{willReadFrequently:!0});{let O=B.width/S;M.clearRect(0,0,B.width,B.height),M.textAlign="center",M.textBaseline="middle",M.font=`600 ${e.fontPx*O}px "Geist", ui-sans-serif, sans-serif`,M.letterSpacing=`${-.035*e.fontPx*O}px`,M.fillStyle="#fff",M.strokeStyle="#fff",M.lineWidth=e.fontPx*O*.22,M.lineJoin="round",M.strokeText(e.vars.headline,B.width/2,B.height/2),M.fillText(e.vars.headline,B.width/2,B.height/2)}let y=M.getImageData(0,0,B.width,B.height).data,R=B.width,q=B.height;function W(O,G){if(!y)return!1;let V=Math.round((O/u+.5)*(R-1)),ue=Math.round((.5-G/c)*(q-1));return V<0||ue<0||V>=R||ue>=q?!1:y[(ue*R+V)*4+3]>24}{L.font=`600 ${e.fontPx}px "Geist", ui-sans-serif, sans-serif`,L.letterSpacing=`${-.035*e.fontPx}px`;let O=L.measureText(e.vars.headline);e.bandW=(O.width+e.fontPx*.2)/S*u,e.bandH=(O.actualBoundingBoxAscent+O.actualBoundingBoxDescent+e.fontPx*.34)/b*c}let k=11,ee=gstMulberry32(k),j=e.bandW/2,le=e.bandH/2,X=e.bandH*(.18+e.vars.padding*.85),ie=j+X,Se=le+X,Ge=gstMulberry32(k*511+3),ze=[];for(let O=2;O<=9;O++)ze.push({k:O,amp:(Ge()*2-1)/Math.sqrt(O),ph:Ge()*Math.PI*2});function it(O,G,V){return O*G/Math.hypot(G*Math.cos(V),O*Math.sin(V))}function tt(O){let G=0;for(let H of ze)G+=H.amp*Math.sin(H.k*O+H.ph);let V=it(ie,Se,O)*(1+e.vars.chaos*2.4*G),ue=Math.abs(Math.cos(O)),g=Math.abs(Math.sin(O)),w=Math.min(ue>1e-6?(j+X*.3)/ue:1e9,g>1e-6?(le+X*.3)/g:1e9);V=Math.max(V,w);let D=Math.abs(Math.cos(O)),I=Math.abs(Math.sin(O)),P=Math.min(D>1e-6?u*.44/D:1e9,I>1e-6?c*.43/I:1e9);return Math.min(V,P)}function K(O,G){return Math.hypot(O,G)<=tt(Math.atan2(G,O))}let fe=0,ce=0,be=0;for(let O=0;O<96;O++){let G=O/96*Math.PI*2,V=tt(G);fe+=.5*V*V*(Math.PI*2/96),ce=Math.max(ce,Math.abs(V*Math.cos(G))),be=Math.max(be,Math.abs(V*Math.sin(G)))}let Ve=Math.max(1,Math.min(400,Math.round(e.vars.tileCount))),Ae=[-ce*1.3,-be*1.3,ce*1.3,be*1.3],je=e.vars.sizeVariance,qe=gstMulberry32(k*977+5),Z=[],T=0;for(;Z.length<4&&T++<400;){let O=(qe()*2-1)*ce,G=(qe()*2-1)*be;K(O,G)&&Z.push([O,G])}function de(O){let G=Math.max(1e-9,O()),V=O();return Math.sqrt(-2*Math.log(G))*Math.cos(2*Math.PI*V)}let se=[],me=0,oe=Math.max(ce,be)*.14;for(;se.length<Ve&&me++<Ve*200;){let O,G;if(Z.length&&ee()<.85*je){let V=Z[Math.floor(ee()*Z.length)%Z.length];O=V[0]+de(ee)*oe,G=V[1]+de(ee)*oe}else O=(ee()*2-1)*ce,G=(ee()*2-1)*be;K(O,G)&&se.push([O,G])}let Ee=se.length,ge=gstMulberry32(k*733+9),Ce=22,We=[];for(let O=0;O<Ce;O++){let G=(O+(ge()-.5)*.72)/Ce*Math.PI*2,V=tt(G)*(1+(ge()-.5)*.09);We.push([V*Math.cos(G),V*Math.sin(G)])}let E=Math.round(3*(1-je));for(let O=0;O<E;O++){let G=d3.Delaunay.from(se).voronoi(Ae);se=se.map((V,ue)=>{let g=G.cellPolygon(ue);if(!g||g.length<3)return V;let w=0,D=0;for(let I of g)w+=I[0],D+=I[1];return[w/g.length,D/g.length]})}function v(O,G,V,ue){let g=(O[0]-G[0])*(V[1]-ue[1])-(O[1]-G[1])*(V[0]-ue[0]);if(Math.abs(g)<1e-9)return null;let w=((O[0]-V[0])*(V[1]-ue[1])-(O[1]-V[1])*(V[0]-ue[0]))/g;return[O[0]+w*(G[0]-O[0]),O[1]+w*(G[1]-O[1])]}function F(O,G){if(G<=0)return O;let V=O.length;if(V<3)return null;let ue=[];for(let I=0;I<V;I++){let P=O[I],H=O[(I+1)%V],ne=H[0]-P[0],he=H[1]-P[1],pe=Math.hypot(ne,he);if(pe<1e-9)continue;let Pe=-he/pe,Ie=ne/pe;ue.push({p1:[P[0]+Pe*G,P[1]+Ie*G],p2:[H[0]+Pe*G,H[1]+Ie*G]})}let g=ue.length;if(g<3)return null;let w=[];for(let I=0;I<g;I++){let P=ue[(I+g-1)%g],H=ue[I];w.push(v(P.p1,P.p2,H.p1,H.p2)||H.p1)}let D=0;for(let I=0;I<w.length;I++){let[P,H]=w[I],[ne,he]=w[(I+1)%w.length];D+=P*he-ne*H}return Math.abs(D)<1e-6?null:w}function Y(O,G,V){let ue=!1;for(let g=0,w=V.length-1;g<V.length;w=g++){let[D,I]=V[g],[P,H]=V[w];I>G!=H>G&&O<(P-D)*(G-I)/(H-I)+D&&(ue=!ue)}return ue}function $(O){let G=1e9,V=1e9,ue=-1e9,g=-1e9;for(let[D,I]of O)D<G&&(G=D),D>ue&&(ue=D),I<V&&(V=I),I>g&&(g=I);let w=7;for(let D=0;D<w;D++)for(let I=0;I<w;I++){let P=G+(D+.5)/w*(ue-G),H=V+(I+.5)/w*(g-V);if(Y(P,H,O)&&W(P,H))return!0}return!1}let J=Math.max(0,e.vars.gap),De=.01+e.vars.roundness*.16,_e=.09;function Re(O){let G=0;for(let V=0;V<O.length;V++){let[ue,g]=O[V],[w,D]=O[(V+1)%O.length];G+=ue*D-w*g}return G/2}function we(O,G){let V=Re(G)>0?1:-1,ue=O;for(let g=0;g<G.length&&ue.length;g++){let w=G[g],D=G[(g+1)%G.length],I=ue;ue=[];let P=H=>V*((D[0]-w[0])*(H[1]-w[1])-(D[1]-w[1])*(H[0]-w[0]))>=-1e-9;for(let H=0;H<I.length;H++){let ne=I[H],he=I[(H+1)%I.length],pe=P(ne),Pe=P(he);pe?(ue.push(ne),Pe||ue.push(v(ne,he,w,D)||he)):Pe&&ue.push(v(ne,he,w,D)||ne)}}return ue}function te(O,G){let V=O;for(let ue=0;ue<3&&V.length>6;ue++){let g=[],w=!1;for(let D=0;D<V.length;D++){let I=V[(D+V.length-1)%V.length],P=V[D],H=V[(D+1)%V.length],ne=P[0]-I[0],he=P[1]-I[1],pe=H[0]-P[0],Pe=H[1]-P[1];if(Math.abs(Math.atan2(ne*Pe-he*pe,ne*pe+he*Pe))<G&&!w&&V.length-1>5){w=!0;continue}w=!1,g.push(P)}if(g.length===V.length)break;V=g}return V}let Te=d3.Delaunay.from(se).voronoi(Ae);function Xe(O){if(!O||O.length<3)return null;let G=[];for(let ue of O){let g=G[G.length-1];g&&Math.hypot(ue[0]-g[0],ue[1]-g[1])<1e-4||G.push(ue)}for(;G.length>1&&Math.hypot(G[0][0]-G[G.length-1][0],G[0][1]-G[G.length-1][1])<1e-4;)G.pop();if(G.length<3)return null;let V=[];for(let ue=0;ue<G.length;ue++){let g=G[(ue+G.length-1)%G.length],w=G[ue],D=G[(ue+1)%G.length],I=(w[0]-g[0])*(D[1]-w[1])-(w[1]-g[1])*(D[0]-w[0]),P=Math.hypot(w[0]-g[0],w[1]-g[1]),H=Math.hypot(D[0]-w[0],D[1]-w[1]);Math.abs(I)<1e-6*Math.max(1e-6,P*H)||V.push(w)}return V.length<3?null:(Re(V)<0&&V.reverse(),V)}function Be(O,G,V,ue){let g=(H,ne,he)=>Math.sign((ne[0]-H[0])*(he[1]-H[1])-(ne[1]-H[1])*(he[0]-H[0])),w=g(O,G,V),D=g(O,G,ue),I=g(V,ue,O),P=g(V,ue,G);return w!==D&&I!==P&&w!==0&&D!==0&&I!==0&&P!==0}function ve(O){let G=O.length;for(let V=0;V<G;V++){let ue=O[V],g=O[(V+1)%G];for(let w=V+1;w<G;w++){if(w===V||(w+1)%G===V||w===(V+1)%G)continue;let D=O[w],I=O[(w+1)%G];if(Be(ue,g,D,I))return!1}}return!0}function He(O,G){let V=Xe(O);return!V||Re(V)<G||!ve(V)?null:V}let N=gstMulberry32(k*31337+7),xe=gstMulberry32(k*9973+1),ae=[],Ue=1/0;for(let O=0;O<Ee;O++){let G=Te.cellPolygon(O);if(!G)continue;let V=G.slice(0,-1),ue=He(te(we(We,V),.14),3e-4);if(!ue){let P=He(V,3e-4);if(!P||!$(P))continue;ue=P}let g=F(ue,J/2);g=g&&He(g,2e-4)||ue;let w=1/0;for(let P=0;P<g.length;P++){let H=g[P],ne=g[(P+1)%g.length],he=Math.hypot(ne[0]-H[0],ne[1]-H[1]);he>1e-6&&he<w&&(w=he)}let D=0,I=0;for(let P of g)D+=P[0],I+=P[1];D/=g.length,I/=g.length,ae.push({cx:D,cy:I,radius:De,local:g.map(P=>[P[0]-D,P[1]-I])})}y=null,B.width=B.height=1;let re=ae.map(O=>{let G=O.cx>=0?1:-1,V=[G*e.vars.sideDist*(.7+N()*.6),e.vars.sideDist===0&&e.vars.zDist===0?0:(N()-.5)*1.7,e.vars.zDist*(.85+N()*.3)],ue=[(N()-.5)*Math.PI*1*e.vars.flyInRotation,(N()-.5)*Math.PI*1.3*e.vars.flyInRotation,(N()-.5)*Math.PI*.5*e.vars.flyInRotation],g=[G*e.vars.sideDist*(.8+N()*.7),e.vars.sideDist===0&&e.vars.zOut===0?0:(N()-.5)*2.2,e.vars.zOut*(.85+N()*.3)],w=[(N()-.5)*Math.PI*1.6*e.vars.flyOutRotation,(N()-.5)*Math.PI*2*e.vars.flyOutRotation,(N()-.5)*Math.PI*.8*e.vars.flyOutRotation];return{cx:O.cx,cy:O.cy,local:O.local,radius:O.radius,baseRot:[(xe()-.5)*.08,(xe()-.5)*.08,(xe()-.5)*.03],wobPhase:xe()*Math.PI*2,wobFreq:.45+xe()*.5,inOff:V,inSpin:ue,outOff:g,outSpin:w,rIn:N(),rOut:N()}}),Q=Math.max(1,re.length-1),Le=re.map((O,G)=>[Math.abs(O.cx),G]).sort((O,G)=>O[0]-G[0]),Fe=e.vars.stagger;Le.forEach((O,G)=>{let V=re[O[1]];V.inDelay=Fe*.85*(G/Q)+V.rIn*.05*Fe,V.inDur=1-V.inDelay}),re.map((O,G)=>[Math.abs(O.cx),G]).sort((O,G)=>G[0]-O[0]).forEach((O,G)=>{let V=re[O[1]];V.outDelay=Fe*.85*(G/Q)+V.rOut*.05*Fe,V.outDur=Math.max(.12,1-V.outDelay)});function gt(O){let G=document.createElement("canvas");G.width=O,G.height=O;let V=G.getContext("2d"),ue=V.createLinearGradient(0,0,O,O);ue.addColorStop(0,"#202020"),ue.addColorStop(.5,"#a0a0a0"),ue.addColorStop(1,"#f0f0f0"),V.fillStyle=ue,V.fillRect(0,0,O,O);let g=V.createRadialGradient(O*.3,O*.4,0,O*.3,O*.4,O*.9);g.addColorStop(0,"rgba(255,255,255,0.4)"),g.addColorStop(1,"rgba(0,0,0,0)"),V.fillStyle=g,V.fillRect(0,0,O,O);let w=new Wo(G);return w.wrapS=w.wrapT=Ni,w}{let O=2*(n+3.5)*Math.tan(a*Math.PI/360),G=new Zt(new Us(O*(1920/1080)*1.05,O*1.05),new vs({color:657935,depthWrite:!1,depthTest:!1}));G.position.z=-3.5,G.renderOrder=-1,o.add(G)}let nt=n-s+.28,Bt=e.vars.fog>0?4.6/Math.max(2,e.vars.fog):0;function Ht(O,G){O.uniforms.uGstFogStart={value:nt},O.uniforms.uGstFogRho={value:Bt},O.uniforms.uGstFogColor={value:new Qe(657935)},O.vertexShader=O.vertexShader.replace("#include <common>",`#include <common>
varying float vGstDep;`).replace("#include <project_vertex>",`#include <project_vertex>
vGstDep = -mvPosition.z;`),O.fragmentShader=O.fragmentShader.replace("#include <common>",`#include <common>
varying float vGstDep;
uniform float uGstFogStart;
uniform float uGstFogRho;
uniform vec3 uGstFogColor;`).replace("#include <dithering_fragment>",(G?`gl_FragColor.rgb *= exp(-pow(max(0.0, vGstDep - uGstFogStart) * uGstFogRho, 2.0));
`:`gl_FragColor.rgb = mix(gl_FragColor.rgb, uGstFogColor, 1.0 - exp(-pow(max(0.0, vGstDep - uGstFogStart) * uGstFogRho, 2.0)));
`)+"#include <dithering_fragment>")}function qa(O){O.vertexShader=O.vertexShader.replace("#include <common>",`#include <common>
varying float vNzObj;`).replace("#include <beginnormal_vertex>",`#include <beginnormal_vertex>
vNzObj = normal.z;`),O.fragmentShader=O.fragmentShader.replace("#include <common>",`#include <common>
varying float vNzObj;`).replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
totalEmissiveRadiance *= smoothstep(0.5, 0.78, vNzObj);`),Ht(O,!1)}let Nr=new eu({color:16777215,transmission:1,thickness:t.thickness,ior:t.ior,dispersion:.24,roughness:t.roughness,metalness:0,clearcoat:1,clearcoatRoughness:.59,specularIntensity:1,specularColor:16777215,attenuationDistance:4.7,attenuationColor:16777215,envMapIntensity:1.1,iridescence:1,iridescenceIOR:2.34,iridescenceThicknessRange:[80,500],iridescenceThicknessMap:gt(256),side:Wt,emissive:16777215,emissiveMap:U,emissiveIntensity:.95});Nr.onBeforeCompile=qa;let ar=new iu({fog:!1,matcap:p,transparent:!0,opacity:.11,blending:Za,depthWrite:!1,side:Wt});ar.onBeforeCompile=O=>Ht(O,!0);function na(O,G,V,ue){if(ue<=0)return Math.min(O,G,V);let g=Math.min(O,G,V);return g-ue*Math.log(Math.exp(-(O-g)/ue)+Math.exp(-(G-g)/ue)+Math.exp(-(V-g)/ue))}function ja(O,G,V,ue,g,w){let D=new Qo,I=O.length;for(let ne=0;ne<I;ne++){let he=O[(ne+I-1)%I],pe=O[ne],Pe=O[(ne+1)%I],Ie=pe[0]-he[0],Oe=pe[1]-he[1],Ye=Pe[0]-pe[0],et=Pe[1]-pe[1],st=Math.hypot(Ie,Oe),ht=Math.hypot(Ye,et);if(st<1e-6||ht<1e-6)continue;let ot=Ie/st,Ne=Oe/st,pt=Ye/ht,zt=et/ht,bt=Math.max(-1,Math.min(1,-ot*pt-Ne*zt)),Dr=Math.sqrt(Math.max(0,1-bt*bt)),wt=1+bt,Ir=wt>1e-6?Dr/wt:0,rt=0;if(Ir>1e-4){let Ri=G/Ir,Mr=st*.49,Eg=ht*.49,Vl=Ri;if(g>0&&w>0){let kl=Math.acos(bt);if(kl<w){let qs=Math.min(1,(w-kl)/w),bg=qs*qs*(3-2*qs);Vl=Math.max(Ri,g*bg)}}rt=Math.max(0,na(Vl,Mr,Eg,ue))}let yt=pe[0]-ot*rt,At=pe[1]-Ne*rt,_t=pe[0]+pt*rt,Ut=pe[1]+zt*rt;ne===0?D.moveTo(yt,At):D.lineTo(yt,At),rt>1e-4?D.bezierCurveTo(yt+ot*rt*.5523,At+Ne*rt*.5523,_t-pt*rt*.5523,Ut-zt*rt*.5523,_t,Ut):D.lineTo(pe[0],pe[1])}D.closePath();let P=V*e.vars.bevel*.714,H=e.vars.bevel>.02;return new Kc(D,{depth:V,bevelEnabled:H,bevelThickness:H?P:0,bevelSize:H?P:0,bevelSegments:Math.max(1,Math.round(e.vars.meshSmooth/.6*6)),curveSegments:Math.max(4,Math.round(e.vars.meshSmooth/.6*24))})}let xr=new Mi;xr.position.z=s,o.add(xr);let bi=28*Math.PI/180,wi=[];for(let O of re){let G=Math.max(J/2,O.radius*1.5),V=ja(O.local,O.radius,_e,0,G,bi);V.translate(0,0,-_e/2);let ue=V.attributes.position,g=new Float32Array(ue.count*2);for(let D=0;D<ue.count;D++)g[D*2]=(ue.getX(D)+O.cx)/u+.5,g[D*2+1]=(ue.getY(D)+O.cy)/c+.5;V.setAttribute("uv",new Kt(g,2));let w=new Mi;w.add(new Zt(V,Nr)),w.add(new Zt(V,ar)),w.position.set(O.cx,O.cy,0),xr.add(w),wi.push(w)}function Ai(O){return 1-Math.pow(1-O,e.vars.easePow)}function sa(O){return O<0?0:O>1?1:O}function Ci(){let O=t.time;Nr.thickness=t.thickness,Nr.roughness=t.roughness,Nr.ior=t.ior,xr.rotation.x=.02*Math.sin(O*.5+.7),xr.rotation.y=.045*Math.sin(O*.33+2.1),xr.position.z=s+.02*Math.sin(O*.5),o.environmentRotation.y=.6+O*.04;for(let G=0;G<re.length;G++){let V=re[G],ue=wi[G],g=sa((t.tin-V.inDelay)/V.inDur),w=1-Ai(g),D=1-(1-Math.pow(1-g,Math.max(1.15,e.vars.easePow*.38))),I=Math.pow(1-g,1.15+V.rIn*.2),P=sa((t.tout-V.outDelay)/V.outDur),H=P*P,ne=Math.pow(P,1.35),he=V.cx,pe=V.cy,Pe=0,Ie=V.baseRot[0],Oe=V.baseRot[1],Ye=V.baseRot[2];(w!==0||D!==0||I!==0)&&(he+=V.inOff[0]*w,pe+=V.inOff[1]*w,Pe+=V.inOff[2]*D,Ie+=V.inSpin[0]*I,Oe+=V.inSpin[1]*I,Ye+=V.inSpin[2]*I);let et=Math.max(0,1-Math.abs(w)*3)*Math.max(0,1-H*3);if(et>.001){let st=V.wobFreq;Ie+=.03*Math.sin(O*st+V.wobPhase)*et,Oe+=.045*Math.sin(O*st*.83+V.wobPhase*2.1)*et,Ye+=.012*Math.sin(O*st*1.31+V.wobPhase*.7)*et,Pe+=.018*Math.sin(O*.9+V.wobPhase)*et}P>0&&(he+=V.outOff[0]*H,pe+=V.outOff[1]*H,Pe+=V.outOff[2]*ne,Ie+=V.outSpin[0]*H,Oe+=V.outSpin[1]*H,Ye+=V.outSpin[2]*H),ue.position.set(he,pe,Pe),ue.rotation.set(Ie,Oe,Ye)}i.render(o,h)}window.__gstRender=Ci,Ci();let Ya=!1;function Ur(O){if(!(O&&O.persisted===!0)&&!Ya){Ya=!0;try{window.removeEventListener("pagehide",Ur),window.removeEventListener("unload",Ur),window.__gstRender===Ci&&(window.__gstRender=null),window.__gstInstance&&window.__gstInstance.dispose===Ur&&(window.__gstInstance=null),o.traverse(function(G){G.geometry&&G.geometry.dispose();let V=Array.isArray(G.material)?G.material:G.material?[G.material]:[];for(let ue of V){for(let g in ue){let w=ue[g];w&&w.isTexture&&w.dispose()}ue.dispose()}}),U.dispose(),p.dispose(),f.dispose(),o.environment=null,o.clear(),wi.length=0,re.length=0,C.width=C.height=1,B.width=B.height=1,i.dispose(),i.forceContextLoss()}catch{}}}window.__gstInstance={dispose:Ur},window.addEventListener("pagehide",Ur),window.addEventListener("unload",Ur)})()})();/*! Bundled license information:

three/build/three.core.js:
three/build/three.module.js:
  (**
   * @license
   * Copyright 2010-2025 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)
*/
