/* One shared pair of text atlases, one instance buffer, one surface draw and one batched shadow draw per seek. */
window.CodeSliceSurface = function (stage, front, back, tiles, options) {
  "use strict";
  const canvas = document.createElement("canvas");
  canvas.id = "csh-surface";
  canvas.width = 1920;
  canvas.height = 1080;
  canvas.style.cssText = "display:block;width:1920px;height:1080px";
  stage.appendChild(canvas);
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("Code Slice Hero requires WebGL 2 for its full tile surface.");
  const vertex = `#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPosition;
  layout(location=1) in vec2 aUV;
  layout(location=2) in float aFace;
  layout(location=3) in vec4 aCell;
  layout(location=4) in vec4 aMotion;
  layout(location=5) in vec4 aAngles;
  layout(location=6) in vec2 aSurface;
  out vec2 vUV;
  out vec2 vAtlasUV;
  flat out float vFace;
  flat out float vFormation;
  flat out float vShade;
  flat out float vInk;
  void main() {
    vec3 p = vec3(aPosition.xy * aCell.zw, aPosition.z * 3.0 * aAngles.w) * aMotion.w;
    // CSS transform order is translate * Rx * Ry * Rz * scale.
    vec3 c = cos(aAngles.xyz), s = sin(aAngles.xyz);
    p.xy = vec2(c.z*p.x-s.z*p.y, s.z*p.x+c.z*p.y);
    p.xz = vec2(c.y*p.x+s.y*p.z, -s.y*p.x+c.y*p.z);
    p.yz = vec2(c.x*p.y-s.x*p.z, s.x*p.y+c.x*p.z);
    p += vec3(aCell.xy, 0.0) + aMotion.xyz;
    float w = 1.0 - p.z / 1712.661;
    gl_Position = vec4((p.x-960.0)/960.0, -(p.y-540.0)/540.0,
      1.00020002*w - 0.00116788, w);
    vUV = aUV;
    vAtlasUV = (aCell.xy + (aUV-0.5)*aCell.zw) / vec2(1920.0,1080.0);
    vFace = aFace; vFormation = aAngles.w; vShade = aSurface.x; vInk = aSurface.y;
  }`;
  const fragment = `#version 300 es
  precision highp float;
  uniform sampler2D uFront;
  uniform sampler2D uBack;
  in vec2 vUV;
  in vec2 vAtlasUV;
  flat in float vFace;
  flat in float vFormation;
  flat in float vShade;
  flat in float vInk;
  out vec4 color;
  void main() {
    if (vFace > 1.5) {
      if (vInk < 0.5 || vFormation < 0.003) discard;
      float shade = vFace == 4.0 ? 0.910 : vFace == 5.0 ? 0.651 : 0.741;
      color = vec4(vec3(shade),1.0); return;
    }
    float radius = 0.06*vFormation;
    vec2 q = abs(vUV-0.5) - (0.5-radius);
    float distance = length(max(q,0.0)) + min(max(q.x,q.y),0.0) - radius;
    // At zero radius adjacent faces use their exact shared pixel boundary.
    float alpha = radius > 0.00001 ? 1.0-smoothstep(-fwidth(distance),0.0,distance) : 1.0;
    if (alpha < 0.01) discard;
    vec3 ink = vInk < 0.5 ? vec3(1.0) :
      (vFace < 0.5 ? texture(uFront,vAtlasUV).rgb : texture(uBack,vAtlasUV).rgb);
    color = vec4(ink*vShade,alpha);
  }`;
  const shaders = [];
  function compile(kind, source) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader));
    shaders.push(shader);
    return shader;
  }
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const vertices = [];
  function quad(corners, face) {
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) vertices.push(...corners[i], ...uv[i], face);
  }
  quad(
    [
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
    ],
    0,
  );
  // Rear UVs are reversed in local X, just like a CSS rotateY(180deg) face.
  quad(
    [
      [0.5, -0.5, -0.5],
      [-0.5, -0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [0.5, 0.5, -0.5],
    ],
    1,
  );
  quad(
    [
      [-0.5, -0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, 0.5, -0.5],
    ],
    2,
  );
  quad(
    [
      [0.5, -0.5, 0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, 0.5, 0.5],
    ],
    3,
  );
  quad(
    [
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, -0.5, 0.5],
      [-0.5, -0.5, 0.5],
    ],
    4,
  );
  quad(
    [
      [-0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5],
    ],
    5,
  );
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const geometry = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, geometry);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  for (const [location, size, offset] of [
    [0, 3, 0],
    [1, 2, 12],
    [2, 1, 20],
  ]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 24, offset);
  }
  const data = new Float32Array(tiles.length * 14),
    instances = gl.createBuffer();
  tiles.forEach((tile, i) => {
    data.set([tile.cx, tile.cy, tile.width, tile.height], i * 14);
    data[i * 14 + 13] = tile.active ? 1 : 0;
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  for (const [location, size, offset] of [
    [3, 4, 0],
    [4, 4, 16],
    [5, 4, 32],
    [6, 2, 48],
  ]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 56, offset);
    gl.vertexAttribDivisor(location, 1);
  }
  const textures = [front, back].map((source, i) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.uniform1i(gl.getUniformLocation(program, i === 0 ? "uFront" : "uBack"), i);
    return texture;
  });
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.frontFace(gl.CW);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const rgb = options.behindColor.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16) / 255);
  const shadows = window.CodeSliceShadows(
    gl,
    tiles,
    data,
    options.shadowStrength,
    options.shadowSoftness,
  );
  gl.clearColor(...rgb, 1);
  gl.viewport(0, 0, 1920, 1080);
  return {
    data,
    shadowStats: shadows.stats,
    set(index, p) {
      const offset = index * 14 + 4;
      data.set(
        [
          p.x,
          p.y,
          p.z,
          p.scale,
          (p.rx * Math.PI) / 180,
          (p.ry * Math.PI) / 180,
          (p.rz * Math.PI) / 180,
          p.formation,
          p.shade,
        ],
        offset,
      );
    },
    draw() {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, tiles.length);
      return 1 + shadows.draw();
    },
    dispose() {
      shadows.dispose();
      textures.forEach((t) => gl.deleteTexture(t));
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteBuffer(instances);
      gl.deleteBuffer(geometry);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      canvas.remove();
    },
  };
};
