/**
 * CRT raster display shader overlay for Teletext.
 * Ported from cubed/galaga — 5-pass WebGL pipeline:
 * bloom downsample → H blur → V blur → CRT composite → blit
 *
 * Adapted for 480×240 PAL teletext resolution.
 */

// ── Shared vertex shader ──
const vertexShaderSource = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

// ── CRT raster display shader ──
// 480×240 PAL simulation: gaussian beam scanlines, horizontal bandwidth
// limiting, brightness-dependent beam bloom, halation, aperture grille mask,
// warm color temperature, and subtle interlace flicker.
const crtFragmentSource = `
precision mediump float;

uniform sampler2D u_texture;
uniform sampler2D u_prevFrame;
uniform sampler2D u_bloom;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_phosphorDecay;

varying vec2 v_texCoord;

#define PI 3.14159265359
#define BLOOM_STRENGTH 0.35
#define HALATION_STRENGTH 0.18
#define MASK_STRENGTH 0.10
#define NOISE_STRENGTH 0.002
#define FLICKER_STRENGTH 0.05
#define CURVATURE_STRENGTH 0.0
#define CORNER_RADIUS 0.0

const vec2 vRes = vec2(480.0, 240.0);
const vec2 vTexel = vec2(1.0 / 480.0, 1.0 / 240.0);

vec3 toLinear(vec3 c) { return c * c; }
vec3 toGamma(vec3 c) { return sqrt(c); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 noise3(vec2 co, float t) {
  float r = fract(sin(dot(co + t, vec2(12.9898, 78.233))) * 43758.5453);
  float g = fract(sin(dot(co + t, vec2(93.9898, 67.345))) * 43758.5453);
  float b = fract(sin(dot(co + t, vec2(41.9898, 29.876))) * 43758.5453);
  return vec3(r, g, b) * 2.0 - 1.0;
}

vec2 curveUV(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  c *= 1.0 + dot(c, c) * CURVATURE_STRENGTH;
  return c * 0.5 + 0.5;
}

float roundedRectSDF(vec2 uv, vec2 s, float r) {
  vec2 d = abs(uv - 0.5) * 2.0 - s + r;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

vec3 maxSample(vec2 uv) {
  vec2 vs = vec2(0.0, 0.4 * vTexel.y);
  vec2 hs = vec2(0.4 * vTexel.x, 0.0);
  vec3 s0 = toLinear(texture2D(u_texture, uv).rgb);
  vec3 s1 = toLinear(texture2D(u_texture, uv - vs).rgb);
  vec3 s2 = toLinear(texture2D(u_texture, uv + vs).rgb);
  vec3 s3 = toLinear(texture2D(u_texture, uv - hs).rgb);
  vec3 s4 = toLinear(texture2D(u_texture, uv + hs).rgb);
  return max(max(max(s0, s1), max(s2, s3)), s4);
}

vec3 getBlur(vec2 uv) {
  vec3 r = toLinear(texture2D(u_texture, uv).rgb) * 0.4;
  r += toLinear(texture2D(u_texture, uv + vec2(-vTexel.x, 0.0)).rgb) * 0.15;
  r += toLinear(texture2D(u_texture, uv + vec2( vTexel.x, 0.0)).rgb) * 0.15;
  r += toLinear(texture2D(u_texture, uv + vec2(0.0, -vTexel.y)).rgb) * 0.15;
  r += toLinear(texture2D(u_texture, uv + vec2(0.0,  vTexel.y)).rgb) * 0.15;
  return r;
}

void main() {
  vec2 uv = v_texCoord;

  // No corner clipping — full rectangle
  float cornerMask = 1.0;

  vec2 curved = uv;  // No barrel distortion

  float jitterLine = floor(curved.y * vRes.y);
  float hJitter = fract(sin(jitterLine * 54.37 + floor(u_time * 12.0) * 7.13) * 43758.5) - 0.5;
  curved.x += hJitter * 0.0008;

  const float margin = 0.001;
  if (curved.x < -margin || curved.x > 1.0 + margin ||
      curved.y < -margin || curved.y > 1.0 + margin) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  curved = clamp(curved, 0.0, 1.0);

  vec3 loadSampleCrt = texture2D(u_bloom, vec2(0.25, 0.75)).rgb
                     + texture2D(u_bloom, vec2(0.75, 0.75)).rgb
                     + texture2D(u_bloom, vec2(0.25, 0.25)).rgb
                     + texture2D(u_bloom, vec2(0.75, 0.25)).rgb;
  float screenLoadCrt = luma(loadSampleCrt * 0.25);
  float dynamicBloom = 1.0 + screenLoadCrt * 0.3;

  float pitch = u_resolution.y / vRes.y;

  vec2 vPos = curved * vRes;
  vec2 pxCenter = (floor(vPos) + 0.5) / vRes;

  vec3 center = maxSample(pxCenter);
  vec3 colL = toLinear(texture2D(u_texture, pxCenter - vec2(vTexel.x, 0.0)).rgb);
  vec3 colR = toLinear(texture2D(u_texture, pxCenter + vec2(vTexel.x, 0.0)).rgb);

  float blendAmt = mix(0.12, 0.06, smoothstep(1.5, 3.0, pitch));
  float fx = fract(vPos.x);
  float wL = blendAmt * (1.0 - fx);
  float wR = blendAmt * fx;
  vec3 color = center * (1.0 - wL - wR) + colL * wL + colR * wR;

  float edgeDet = abs(luma(center) - luma(colL)) + abs(luma(center) - luma(colR));
  color += (center - (colL + colR) * 0.5) * edgeDet * 0.15;

  vec3 tightBlur = getBlur(pxCenter);
  color += max(tightBlur - 0.6, 0.0) * 2.5 * BLOOM_STRENGTH * dynamicBloom;

  vec2 ht = vTexel * 3.0;
  vec3 halation = toLinear(texture2D(u_texture, pxCenter + vec2(-ht.x, 0.0)).rgb)
                + toLinear(texture2D(u_texture, pxCenter + vec2( ht.x, 0.0)).rgb)
                + toLinear(texture2D(u_texture, pxCenter + vec2(0.0, -ht.y)).rgb)
                + toLinear(texture2D(u_texture, pxCenter + vec2(0.0,  ht.y)).rgb);
  color += max(halation * 0.25 - 0.45, 0.0) * 1.5 * HALATION_STRENGTH * dynamicBloom;

  float virtualY = curved.y * vRes.y;
  float d = fract(virtualY) - 0.5;

  // Tighter beam = more visible scanline gaps
  float baseSigma = mix(0.38, 0.18, smoothstep(1.5, 3.0, pitch));
  float bright = max(max(color.r, color.g), color.b);
  float sigma = baseSigma + bright * 0.06;
  float beam = exp(-0.5 * d * d / (sigma * sigma));
  // Always apply scanlines (no fade-out at low pitch)
  color *= beam;

  float mx = mod(gl_FragCoord.x, 3.0);
  vec3 mask;
  if (mx < 1.0) {
    mask = vec3(1.0 + MASK_STRENGTH, 1.0 - MASK_STRENGTH * 0.5, 1.0 - MASK_STRENGTH * 0.5);
  } else if (mx < 2.0) {
    mask = vec3(1.0 - MASK_STRENGTH * 0.5, 1.0 + MASK_STRENGTH, 1.0 - MASK_STRENGTH * 0.5);
  } else {
    mask = vec3(1.0 - MASK_STRENGTH * 0.5, 1.0 - MASK_STRENGTH * 0.5, 1.0 + MASK_STRENGTH);
  }
  float sep = smoothstep(0.0, 0.5, mx) * smoothstep(3.0, 2.5, mx);
  mask *= mix(0.88, 1.0, sep);
  color *= mix(vec3(1.0), mask, smoothstep(1.0, 2.0, pitch));

  float moirePhase = sin(curved.y * vRes.y * PI + mx * PI * 0.667 + u_time * 2.0);
  color *= 1.0 + moirePhase * 0.006;

  float convergeDist = length(curved - 0.5);
  float convergeAmt = convergeDist * convergeDist * 0.006;
  vec2 convergeDir = normalize(curved - 0.5 + 0.001);
  vec2 rUV = clamp(curved + convergeDir * convergeAmt, 0.0, 1.0);
  vec2 bUV = clamp(curved - convergeDir * convergeAmt, 0.0, 1.0);
  color.r = mix(color.r, toLinear(texture2D(u_texture, rUV).rgb).r, 0.6);
  color.b = mix(color.b, toLinear(texture2D(u_texture, bUV).rgb).b, 0.6);

  // PAL warm color temperature
  color *= vec3(0.97, 0.94, 0.90);

  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(gray), color, 1.06);

  float fieldPhase = mod(floor(u_time * 25.0), 2.0);  // 25fps PAL
  float scanIdx = floor(virtualY);
  float interlace = mod(scanIdx + fieldPhase, 2.0);
  color *= 1.0 - interlace * 0.012 * smoothstep(1.5, 2.5, pitch);

  vec2 ctr = curved * 2.0 - 1.0;
  color *= 1.0 - dot(ctr, ctr) * 0.10;

  float bandPos = fract(curved.y * 0.5 - u_time * 0.06);
  float band = smoothstep(0.0, 0.15, bandPos) * smoothstep(0.45, 0.15, bandPos);
  color *= 1.0 + band * 0.10;

  color += noise3(floor(vPos), u_time) * NOISE_STRENGTH;

  float flicker = sin(u_time * 13.7) * 0.5 + sin(u_time * 7.3) * 0.3 + sin(u_time * 23.1) * 0.2;
  float cb = max(max(color.r, color.g), color.b);
  color *= 1.0 + flicker * FLICKER_STRENGTH * (1.0 + cb * 0.5);

  vec3 prevCrt = toLinear(texture2D(u_prevFrame, vec2(uv.x, 1.0 - uv.y)).rgb);
  color = max(color, prevCrt * u_phosphorDecay);

  color *= cornerMask;
  gl_FragColor = vec4(clamp(toGamma(color), 0.0, 1.0), 0.0);
}
`;

// ── Bloom downsample shader ──
const bloomDownsampleFragSrc = `
precision mediump float;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
varying vec2 v_texCoord;

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec2 halfTexel = texelSize * 0.5;
  vec3 a = texture2D(u_texture, v_texCoord + vec2(-halfTexel.x, -halfTexel.y)).rgb;
  vec3 b = texture2D(u_texture, v_texCoord + vec2( halfTexel.x, -halfTexel.y)).rgb;
  vec3 c = texture2D(u_texture, v_texCoord + vec2(-halfTexel.x,  halfTexel.y)).rgb;
  vec3 d = texture2D(u_texture, v_texCoord + vec2( halfTexel.x,  halfTexel.y)).rgb;
  vec3 color = (a + b + c + d) * 0.25;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  float knee = 0.25;
  float threshold = 0.15;
  float soft = luma - threshold + knee;
  soft = clamp(soft / (2.0 * knee), 0.0, 1.0);
  soft = soft * soft;
  float contribution = max(soft, step(threshold + knee, luma));
  gl_FragColor = vec4(color * contribution, 1.0);
}
`;

// ── Separable Gaussian blur shader ──
const blurFragSrc = `
precision mediump float;
uniform sampler2D u_texture;
uniform vec2 u_direction;
uniform vec2 u_resolution;
varying vec2 v_texCoord;

void main() {
  vec2 texelSize = u_direction / u_resolution;
  vec3 result = vec3(0.0);
  result += texture2D(u_texture, v_texCoord + texelSize * -4.0).rgb * 0.0162;
  result += texture2D(u_texture, v_texCoord + texelSize * -3.0).rgb * 0.0540;
  result += texture2D(u_texture, v_texCoord + texelSize * -2.0).rgb * 0.1216;
  result += texture2D(u_texture, v_texCoord + texelSize * -1.0).rgb * 0.1945;
  result += texture2D(u_texture, v_texCoord).rgb * 0.2270;
  result += texture2D(u_texture, v_texCoord + texelSize *  1.0).rgb * 0.1945;
  result += texture2D(u_texture, v_texCoord + texelSize *  2.0).rgb * 0.1216;
  result += texture2D(u_texture, v_texCoord + texelSize *  3.0).rgb * 0.0540;
  result += texture2D(u_texture, v_texCoord + texelSize *  4.0).rgb * 0.0162;
  gl_FragColor = vec4(result, 1.0);
}
`;

// ── Passthrough shader ──
const passthroughFragmentSource = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_texCoord;
void main() {
  vec4 c = texture2D(u_texture, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
  gl_FragColor = vec4(c.rgb, 1.0);
}
`;

// ── GL helpers ──

interface ShaderProgram {
  program: WebGLProgram;
  aPosition: number;
  aTexCoord: number;
  uResolution: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
}

interface FBO {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

function compileShader(gl: WebGLRenderingContext, src: string, type: number): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function buildProgram(gl: WebGLRenderingContext, vertSrc: string, fragSrc: string): ShaderProgram | null {
  const vs = compileShader(gl, vertSrc, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  return {
    program: prog,
    aPosition: gl.getAttribLocation(prog, 'a_position'),
    aTexCoord: gl.getAttribLocation(prog, 'a_texCoord'),
    uResolution: gl.getUniformLocation(prog, 'u_resolution'),
    uTime: gl.getUniformLocation(prog, 'u_time'),
  };
}

// ── Public API ──

export function createCRTOverlay(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const overlay = document.createElement('canvas');
  overlay.style.position = 'fixed';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '1000';

  const updatePosition = () => {
    const rect = sourceCanvas.getBoundingClientRect();
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.width = Math.round(rect.width);
    overlay.height = Math.round(rect.height);
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  };

  document.body.appendChild(overlay);
  setTimeout(updatePosition, 0);
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', updatePosition);

  const gl = overlay.getContext('webgl') || overlay.getContext('experimental-webgl') as WebGLRenderingContext | null;
  if (!gl) { console.error('WebGL not supported'); return null; }

  const programs = {
    crt: buildProgram(gl, vertexShaderSource, crtFragmentSource)!,
    bloomDownsample: buildProgram(gl, vertexShaderSource, bloomDownsampleFragSrc)!,
    blur: buildProgram(gl, vertexShaderSource, blurFragSrc)!,
    passthrough: buildProgram(gl, vertexShaderSource, passthroughFragmentSource)!,
  };

  if (!programs.crt || !programs.blur || !programs.bloomDownsample || !programs.passthrough) {
    console.error('Failed to compile CRT shaders');
    return null;
  }

  const blurUDirection = gl.getUniformLocation(programs.blur.program, 'u_direction');
  const crtUTexture = gl.getUniformLocation(programs.crt.program, 'u_texture');
  const crtUPrevFrame = gl.getUniformLocation(programs.crt.program, 'u_prevFrame');
  const crtUBloom = gl.getUniformLocation(programs.crt.program, 'u_bloom');
  const crtUPhosphorDecay = gl.getUniformLocation(programs.crt.program, 'u_phosphorDecay');

  let persistA: FBO | null = null, persistB: FBO | null = null;
  let persistW = 0, persistH = 0, pingPong = 0;
  let bloomA: FBO | null = null, bloomB: FBO | null = null;
  let bloomW = 0, bloomH = 0;

  function makeFBO(w: number, h: number): FBO {
    const tex = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    const fb = gl!.createFramebuffer()!;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fb);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    return { fb, tex };
  }

  function ensurePersistFBOs(w: number, h: number) {
    if (persistW === w && persistH === h) return;
    persistA = makeFBO(w, h);
    persistB = makeFBO(w, h);
    persistW = w; persistH = h; pingPong = 0;
  }

  function ensureBloomFBOs(w: number, h: number) {
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));
    if (bloomW === hw && bloomH === hh) return;
    bloomA = makeFBO(hw, hh);
    bloomB = makeFBO(hw, hh);
    bloomW = hw; bloomH = hh;
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 1,  1, -1, 1, 1,  -1, 1, 0, 0,  1, 1, 1, 0,
  ]), gl.STATIC_DRAW);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.clearColor(0, 0, 0, 0);

  function activate(prog: ShaderProgram) {
    gl!.useProgram(prog.program);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    gl!.enableVertexAttribArray(prog.aPosition);
    gl!.vertexAttribPointer(prog.aPosition, 2, gl!.FLOAT, false, 16, 0);
    gl!.enableVertexAttribArray(prog.aTexCoord);
    gl!.vertexAttribPointer(prog.aTexCoord, 2, gl!.FLOAT, false, 16, 8);
  }

  let lastRenderTime = 0;

  function renderCRT() {
    updatePosition();
    if (overlay.width <= 0 || overlay.height <= 0) { requestAnimationFrame(renderCRT); return; }

    const now = performance.now() / 1000;
    const dt = lastRenderTime > 0 ? Math.min(now - lastRenderTime, 0.1) : 1 / 60;
    lastRenderTime = now;

    ensurePersistFBOs(overlay.width, overlay.height);
    ensureBloomFBOs(overlay.width, overlay.height);

    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, sourceCanvas);

    // Pass 1: bloom downsample
    activate(programs.bloomDownsample);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, bloomA!.fb);
    gl!.viewport(0, 0, bloomW, bloomH);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.uniform1i(gl!.getUniformLocation(programs.bloomDownsample.program, 'u_texture'), 0);
    gl!.uniform2f(programs.bloomDownsample.uResolution, sourceCanvas.width, sourceCanvas.height);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    // Pass 2: H blur
    activate(programs.blur);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, bloomB!.fb);
    gl!.viewport(0, 0, bloomW, bloomH);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, bloomA!.tex);
    gl!.uniform1i(gl!.getUniformLocation(programs.blur.program, 'u_texture'), 0);
    gl!.uniform2f(blurUDirection, 1.0, 0.0);
    gl!.uniform2f(programs.blur.uResolution, bloomW, bloomH);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    // Pass 3: V blur
    activate(programs.blur);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, bloomA!.fb);
    gl!.viewport(0, 0, bloomW, bloomH);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, bloomB!.tex);
    gl!.uniform2f(blurUDirection, 0.0, 1.0);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    // Pass 4: CRT composite
    const writeFBO = pingPong === 0 ? persistA! : persistB!;
    const readFBO = pingPong === 0 ? persistB! : persistA!;

    activate(programs.crt);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, writeFBO.fb);
    gl!.viewport(0, 0, persistW, persistH);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.uniform1i(crtUTexture, 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, bloomA!.tex);
    gl!.uniform1i(crtUBloom, 1);
    gl!.activeTexture(gl!.TEXTURE2);
    gl!.bindTexture(gl!.TEXTURE_2D, readFBO.tex);
    gl!.uniform1i(crtUPrevFrame, 2);
    gl!.uniform2f(programs.crt.uResolution, overlay.width, overlay.height);
    gl!.uniform1f(programs.crt.uTime, now);
    gl!.uniform1f(crtUPhosphorDecay, Math.pow(0.15, dt * 60.0));
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    // Pass 5: blit to screen
    activate(programs.passthrough);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, overlay.width, overlay.height);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, writeFBO.tex);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    pingPong = 1 - pingPong;
    requestAnimationFrame(renderCRT);
  }

  setTimeout(renderCRT, 50);
  return overlay;
}
