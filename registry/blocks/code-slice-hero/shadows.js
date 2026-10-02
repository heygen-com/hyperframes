/* Local projected shadows: fixed light, spatial buckets, one extra GPU draw. */
window.CodeSliceShadows = function (gl, tiles, poses, strength, softness) {
  "use strict";
  const stride = 29,
    light = [0.65, 0.8, -1],
    bucketSize = Math.max(64, tiles[0].width);
  const states = tiles.map(() => ({
    c: new Float64Array(3),
    u: new Float64Array(3),
    v: new Float64Array(3),
    n: new Float64Array(3),
    q: new Float64Array(4),
  }));
  const buckets = new Map(),
    usedBuckets = [],
    seen = new Int32Array(tiles.length);
  let stamp = 0,
    count = 0,
    storage = new Float32Array(Math.max(64, tiles.length * 8) * stride),
    capacity = 0;
  const stats = { pairs: 0, shadows: 0 };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const shaders = [];
  function compile(kind, source) {
    const s = gl.createShader(kind);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    shaders.push(s);
    return s;
  }
  const program = gl.createProgram();
  gl.attachShader(
    program,
    compile(
      gl.VERTEX_SHADER,
      `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aCorner;
  layout(location=1) in vec3 aCenter;
  layout(location=2) in vec3 aU;
  layout(location=3) in vec3 aV;
  layout(location=4) in vec3 aReceiver;
  layout(location=5) in vec3 aReceiverU;
  layout(location=6) in vec3 aReceiverV;
  layout(location=7) in vec4 aBounds;
  layout(location=8) in vec4 aShape;
  layout(location=9) in vec3 aRay;
  out vec2 vCasterUV;
  out vec2 vReceiverXY;
  out float vRay;
  flat out vec4 vBounds;
  flat out vec4 vShape;
  void main(){
    vec2 uv=aCorner*(1.0+1.5*aShape.z/aShape.xy);
    vec3 p=aCenter+aU*uv.x+aV*uv.y;
    float w=1.0-p.z/1712.661;
    gl_Position=vec4((p.x-960.0)/960.0,-(p.y-540.0)/540.0,1.00020002*w-0.00116788,w);
    vCasterUV=uv;vReceiverXY=vec2(dot(p-aReceiver,aReceiverU),dot(p-aReceiver,aReceiverV));
    vRay=aRay.x+aRay.y*uv.x+aRay.z*uv.y;vBounds=aBounds;vShape=aShape;
  }`,
    ),
  );
  gl.attachShader(
    program,
    compile(
      gl.FRAGMENT_SHADER,
      `#version 300 es
  precision highp float;
  in vec2 vCasterUV;
  in vec2 vReceiverXY;
  in float vRay;
  flat in vec4 vBounds;
  flat in vec4 vShape;
  out vec4 color;
  void main(){
    if(vRay<=0.2)discard;
    // Clip to the actual rounded receiver face, never the revealed void.
    vec2 q=abs(vReceiverXY)-(vBounds.xy-vBounds.z);
    float receiverDistance=length(max(q,0.0))+min(max(q.x,q.y),0.0)-vBounds.z;
    if(receiverDistance>=0.0)discard;
    vec2 edge=(abs(vCasterUV)-1.0)*vShape.xy;
    float distance=max(edge.x,edge.y);
    float alpha=(1.0-smoothstep(-vShape.z,vShape.z,distance))*vBounds.w;
    alpha*=smoothstep(0.2,3.0,vRay);
    if(alpha<0.002)discard;
    color=vec4(0.0,0.0,0.0,alpha);
  }`,
    ),
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [loc, size, offset] of [
    [1, 3, 0],
    [2, 3, 3],
    [3, 3, 6],
    [4, 3, 9],
    [5, 3, 12],
    [6, 3, 15],
    [7, 4, 18],
    [8, 4, 22],
    [9, 3, 26],
  ]) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
    gl.vertexAttribDivisor(loc, 1);
  }
  function prepare() {
    for (const bucket of usedBuckets) bucket.length = 0;
    usedBuckets.length = 0;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i],
        s = states[i],
        k = i * 14;
      const cx = Math.cos(poses[k + 8]),
        sx = Math.sin(poses[k + 8]),
        cy = Math.cos(poses[k + 9]),
        sy = Math.sin(poses[k + 9]),
        cz = Math.cos(poses[k + 10]),
        sz = Math.sin(poses[k + 10]);
      s.u.set([cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz]);
      s.v.set([-cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz]);
      s.n.set([sy, -sx * cy, cx * cy]);
      s.c.set([t.cx + poses[k + 4], t.cy + poses[k + 5], poses[k + 6]]);
      s.w = (t.width * poses[k + 7]) / 2;
      s.h = (t.height * poses[k + 7]) / 2;
      s.f = poses[k + 11];
      // The visible face is also the depth-tested shadow receiver.
      const front =
        s.n[0] * (960 - s.c[0]) + s.n[1] * (540 - s.c[1]) + s.n[2] * (1712.661 - s.c[2]) >= 0
          ? 1
          : -1;
      const thickness = 1.5 * s.f * poses[k + 7] * front;
      for (let a = 0; a < 3; a++) s.c[a] += s.n[a] * thickness;
      const qx = s.c[0] + light[0] * s.c[2],
        qy = s.c[1] + light[1] * s.c[2];
      const ux = (s.u[0] + light[0] * s.u[2]) * s.w,
        uy = (s.u[1] + light[1] * s.u[2]) * s.w;
      const vx = (s.v[0] + light[0] * s.v[2]) * s.h,
        vy = (s.v[1] + light[1] * s.v[2]) * s.h;
      s.q.set([
        qx - Math.abs(ux) - Math.abs(vx),
        qy - Math.abs(uy) - Math.abs(vy),
        qx + Math.abs(ux) + Math.abs(vx),
        qy + Math.abs(uy) + Math.abs(vy),
      ]);
      for (let y = Math.floor(s.q[1] / bucketSize); y <= Math.floor(s.q[3] / bucketSize); y++)
        for (let x = Math.floor(s.q[0] / bucketSize); x <= Math.floor(s.q[2] / bucketSize); x++) {
          const key = x + "," + y;
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = [];
            buckets.set(key, bucket);
          }
          if (!bucket.length) usedBuckets.push(bucket);
          bucket.push(i);
        }
    }
  }
  const delta = new Float64Array(3),
    center = new Float64Array(3),
    u = new Float64Array(3),
    v = new Float64Array(3);
  function pair(c, r) {
    stats.pairs++;
    const denom = dot(r.n, light);
    if (Math.abs(denom) < 0.12) return;
    for (let a = 0; a < 3; a++) delta[a] = r.c[a] - c.c[a];
    const ray = dot(delta, r.n) / denom,
      ru = (-dot(c.u, r.n) * c.w) / denom,
      rv = (-dot(c.v, r.n) * c.h) / denom;
    if (ray + Math.abs(ru) + Math.abs(rv) < 0.5) return;
    for (let a = 0; a < 3; a++) {
      center[a] = c.c[a] + light[a] * ray;
      u[a] = c.u[a] * c.w + light[a] * ru;
      v[a] = c.v[a] * c.h + light[a] * rv;
      delta[a] = center[a] - r.c[a];
    }
    const blur = softness * (1 + Math.max(0, ray) * 0.035);
    const rx = dot(delta, r.u),
      ry = dot(delta, r.v);
    if (
      Math.abs(rx) > r.w + Math.abs(dot(u, r.u)) + Math.abs(dot(v, r.u)) + blur * 2 ||
      Math.abs(ry) > r.h + Math.abs(dot(u, r.v)) + Math.abs(dot(v, r.v)) + blur * 2
    )
      return;
    const crossX = u[1] * v[2] - u[2] * v[1],
      crossY = u[2] * v[0] - u[0] * v[2],
      crossZ = u[0] * v[1] - u[1] * v[0];
    const area = Math.hypot(crossX, crossY, crossZ),
      altU = area / Math.hypot(...v),
      altV = area / Math.hypot(...u);
    if (!Number.isFinite(altU + altV) || altU < 0.2 || altV < 0.2) return;
    if ((count + 1) * stride > storage.length) {
      const larger = new Float32Array(storage.length * 2);
      larger.set(storage);
      storage = larger;
    }
    const offset = count++ * stride;
    storage.set(center, offset);
    storage.set(u, offset + 3);
    storage.set(v, offset + 6);
    storage.set(r.c, offset + 9);
    storage.set(r.u, offset + 12);
    storage.set(r.v, offset + 15);
    storage.set(
      [
        r.w,
        r.h,
        Math.min(r.w, r.h) * 0.12 * r.f,
        strength,
        altU,
        altV,
        Math.max(0.6, blur),
        0,
        ray,
        ru,
        rv,
      ],
      offset + 18,
    );
  }
  return {
    stats,
    draw() {
      stats.pairs = 0;
      stats.shadows = 0;
      count = 0;
      if (strength <= 0) return 0;
      prepare();
      for (let i = 0; i < states.length; i++) {
        const c = states[i];
        if (c.f < 0.002) continue;
        const pad = softness * (1 + (Math.abs(c.c[2]) + c.w + c.h) * 0.035) * 2;
        stamp++;
        for (
          let y = Math.floor((c.q[1] - pad) / bucketSize);
          y <= Math.floor((c.q[3] + pad) / bucketSize);
          y++
        )
          for (
            let x = Math.floor((c.q[0] - pad) / bucketSize);
            x <= Math.floor((c.q[2] + pad) / bucketSize);
            x++
          ) {
            const bucket = buckets.get(x + "," + y);
            if (!bucket) continue;
            for (const j of bucket) {
              if (j === i || seen[j] === stamp) continue;
              seen[j] = stamp;
              pair(c, states[j]);
            }
          }
      }
      stats.shadows = count;
      if (!count) return 0;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (capacity < storage.byteLength) {
        capacity = storage.byteLength;
        gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, storage.subarray(0, count * stride));
      gl.depthMask(false);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
      return 1;
    },
    dispose() {
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteBuffer(buffer);
      gl.deleteBuffer(corners);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
};
