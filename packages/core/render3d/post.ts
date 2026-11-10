// The picture after the scene, per quality tier (graphics overhaul, Nov 2026).
//
// T0 draws straight to the screen as before: no extra target, no extra pass (a low Android phone keeps its 30 fps).
// T1 ('grade') draws the scene into a multisampled half-float target, and ONE final pass tone-maps it (ACES, the
//    theme's exposure), converts it to sRGB, grades it (contrast, saturation, a warm or cool lift) and darkens the
//    corners a little. A small dither keeps the sky gradients free of bands.
// T2 ('full') also computes ground-contact shading (GTAO at half resolution, denoised) and a soft bloom on the
//    brightest parts (coins, lamps, lit windows, the sun's glow), both read by the same final pass.
//
// Everything this file makes (targets, materials, the quad) is freed by dispose(); a tier change rebuilds only what
// the new tier needs. Fog and sky colours are linear in the scene and come out through the same final transform, so
// the far fog still meets the sky at the horizon.
import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export type PostMode = 'none' | 'grade' | 'full';

/** Objects on this layer are drawn but left out of the contact shading (their shape is made in a vertex shader the
 * normal pass does not run: the grass). The scene's camera must have the layer enabled. */
export const NO_AO_LAYER = 1;

/** How a world is graded (theme.grade; every field optional). */
export interface GradeLook {
  /** 1 = as rendered. Default 1.06. */
  contrast?: number;
  /** 1 = as rendered. Default 1.08. */
  saturation?: number;
  /** Added to the shadows, sRGB 0..1 per channel (a cool night, a warm desert). Default a hair of blue. */
  lift?: [number, number, number];
  /** Corner darkening 0..1. Default 0.28. */
  vignette?: number;
  /** Bloom strength at T2. Default 0.32. */
  bloom?: number;
}

export const DEFAULT_GRADE: Required<GradeLook> = { contrast: 1.06, saturation: 1.08, lift: [0.0, 0.004, 0.012], vignette: 0.28, bloom: 0.32 };

export const FINAL_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const FINAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform float uExposure, uContrast, uSaturation, uVignette, uAO, uBloom, uAspect;
uniform vec3 uLift;
varying vec2 vUv;
vec3 baRrtOdt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 baAces(vec3 color){
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color; color = baRrtOdt(color); color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 baSrgb(vec3 c){ return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
float baHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  // One bad pixel (a NaN from any shader) must not turn the whole picture black through the bloom: drop it here.
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  c = max(c, vec3(0.0));
#ifdef USE_AO
  float ao = texture2D(tAO, vUv).r;
  c *= mix(1.0, ao, uAO);
#endif
#ifdef USE_BLOOM
  c += texture2D(tBloom, vUv).rgb * uBloom;
#endif
  c = baSrgb(baAces(c));
  c = (c - 0.5) * uContrast + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c += uLift * (1.0 - c);
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float v = smoothstep(0.35, 1.05, length(q) * 1.15);
  c *= 1.0 - uVignette * v;
  c += (baHash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/** What the post kit needs of the renderer (a real WebGLRenderer). */
export type PostRenderer = THREE.WebGLRenderer;

export interface PostKit {
  readonly mode: PostMode;
  /** Builds or frees the passes of a mode. 'none' frees everything. */
  setMode(m: PostMode): void;
  /** Size in CSS pixels and the pixel ratio the renderer uses. */
  setSize(width: number, height: number, pixelRatio: number): void;
  setGrade(g: GradeLook | undefined): void;
  /** Draws the scene through the passes to the screen. Falls back to a plain render when the mode is 'none'. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  /**
   * Builds the scene's shaders for the target the passes draw into (three builds other shaders for a target than for the
   * screen: no tone map, linear output). A warm-up against the screen would build shaders that are never used.
   */
  compile(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  /** GPU objects this kit holds now (targets and materials), for the leak counts. */
  counts(): { targets: number; materials: number };
  /**
   * Draw calls and triangles of the scene pass of the last frame drawn through the passes. The renderer's own numbers
   * end with the last full-screen pass (one call, one triangle), so they say nothing about the scene.
   */
  readonly sceneInfo: { readonly calls: number; readonly triangles: number };
  dispose(): void;
}

/** Can this renderer draw into a half-float target (WebGL2 with EXT_color_buffer_float or _half_float)? */
export function canPost(r: THREE.WebGLRenderer): boolean {
  try {
    if (!r.capabilities.isWebGL2) return false;
    return r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
  } catch { return false; }
}

export function createPost(renderer: PostRenderer): PostKit {
  let mode: PostMode = 'none';
  let width = 1, height = 1, ratio = 1;
  let grade: Required<GradeLook> = { ...DEFAULT_GRADE };
  let sceneRT: THREE.WebGLRenderTarget | null = null;
  let gtao: GTAOPass | null = null;
  let bloom: UnrealBloomPass | null = null;
  let quad: FullScreenQuad | null = null;
  let material: THREE.ShaderMaterial | null = null;
  let gtaoScene: THREE.Scene | null = null;
  let gtaoCamera: THREE.Camera | null = null;
  const sceneInfo = { calls: 0, triangles: 0 };

  const px = (): [number, number] => [Math.max(1, Math.floor(width * ratio)), Math.max(1, Math.floor(height * ratio))];

  function freeAll(): void {
    sceneRT?.dispose(); sceneRT = null;
    // three r170 leaves a material of each pass out of its dispose() (GTAO: the AO and blend materials; bloom: the bright
    // pass): their shader programs would stay in the context after every tier change and every round.
    if (gtao) { gtao.gtaoMaterial.dispose(); gtao.blendMaterial.dispose(); gtao.dispose(); }
    gtao = null; gtaoScene = null; gtaoCamera = null;
    if (bloom) { bloom.materialHighPassFilter.dispose(); bloom.dispose(); }
    bloom = null;
    material?.dispose(); material = null;
    quad?.dispose(); quad = null;
  }

  function makeFinal(): void {
    material?.dispose();
    const defines: Record<string, string> = {};
    if (mode === 'full') { defines['USE_AO'] = ''; defines['USE_BLOOM'] = ''; }
    material = new THREE.ShaderMaterial({
      vertexShader: FINAL_VERT, fragmentShader: FINAL_FRAG, defines, depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: null }, tAO: { value: null }, tBloom: { value: null },
        uExposure: { value: 1 }, uContrast: { value: grade.contrast }, uSaturation: { value: grade.saturation },
        uVignette: { value: grade.vignette }, uAO: { value: 0.85 }, uBloom: { value: 1 }, uAspect: { value: 1 },
        uLift: { value: new THREE.Vector3(...grade.lift) },
      },
    });
    if (!quad) quad = new FullScreenQuad(material); else quad.material = material;
  }

  function build(): void {
    const [w, h] = px();
    sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true, colorSpace: THREE.LinearSRGBColorSpace });
    sceneRT.texture.name = 'post-scene';
    makeFinal();
  }

  function ensureFull(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (mode !== 'full') return;
    const [w, h] = px();
    if (!gtao || gtaoScene !== scene || gtaoCamera !== camera) {
      if (gtao) { gtao.gtaoMaterial.dispose(); gtao.blendMaterial.dispose(); gtao.dispose(); }
      // Half resolution: contact shading is soft by nature, and the pass costs a quarter.
      gtao = new GTAOPass(scene, camera, Math.max(1, w >> 1), Math.max(1, h >> 1));
      gtao.output = GTAOPass.OUTPUT.Off;
      gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 0.6, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      gtaoScene = scene; gtaoCamera = camera;
    }
    if (!bloom) {
      bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(1, w >> 1), Math.max(1, h >> 1)), 1, 0.55, 0.92);
    }
  }

  return {
    get mode() { return mode; },
    sceneInfo,
    setMode(m) {
      if (m === mode) return;
      freeAll();
      mode = m;
      if (m !== 'none') build();
    },
    setSize(w, h, pr) {
      width = w; height = h; ratio = pr;
      if (mode === 'none') return;
      const [pw, ph] = px();
      sceneRT?.setSize(pw, ph);
      gtao?.setSize(Math.max(1, pw >> 1), Math.max(1, ph >> 1));
      bloom?.setSize(Math.max(1, pw >> 1), Math.max(1, ph >> 1));
    },
    setGrade(g) {
      grade = { ...DEFAULT_GRADE, ...(g ?? {}) };
      if (material) {
        const u = material.uniforms;
        u['uContrast']!.value = grade.contrast;
        u['uSaturation']!.value = grade.saturation;
        u['uVignette']!.value = grade.vignette;
        (u['uLift']!.value as THREE.Vector3).set(...grade.lift);
      }
    },
    render(scene, camera) {
      if (mode === 'none' || !sceneRT || !material || !quad) { renderer.render(scene, camera); return; }
      ensureFull(scene, camera);
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      sceneInfo.calls = renderer.info.render.calls;
      sceneInfo.triangles = renderer.info.render.triangles;
      const u = material.uniforms;
      if (mode === 'full' && gtao && bloom) {
        camera.layers.disable(NO_AO_LAYER);
        gtao.render(renderer, sceneRT, sceneRT, 0, false);
        camera.layers.enable(NO_AO_LAYER);
        u['tAO']!.value = gtao.pdRenderTarget.texture;
        // The bloom reads the scene and keeps its result in its own first mip target; its last step (adding the glow back
        // onto the input) is skipped by giving it a scratch target that nothing reads.
        bloomInto(renderer, bloom, sceneRT);
        u['tBloom']!.value = bloom.renderTargetsHorizontal[0]!.texture;
        u['uBloom']!.value = grade.bloom;
      }
      u['tScene']!.value = sceneRT.texture;
      u['uExposure']!.value = renderer.toneMappingExposure;
      u['uAspect']!.value = width / Math.max(1, height);
      renderer.setRenderTarget(prevTarget);
      quad.render(renderer);
    },
    compile(scene, camera) {
      if (mode === 'none' || !sceneRT) { renderer.compile(scene, camera); return; }
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(sceneRT);
      try { renderer.compile(scene, camera); } finally { renderer.setRenderTarget(prevTarget); }
    },
    counts() {
      const targets = (sceneRT ? 1 : 0) + (gtao ? 3 : 0) + (bloom ? 1 + 2 * bloom.nMips : 0);
      return { targets, materials: material ? 1 : 0 };
    },
    dispose() { freeAll(); mode = 'none'; },
  };
}

/**
 * UnrealBloomPass without its final additive copy: bright pass, the mip blurs and the composite, which leaves the glow in
 * renderTargetsHorizontal[0]. Same steps as UnrealBloomPass.render (three r170), minus writing back into the scene target
 * (a multisampled target would have to be resolved twice).
 */
const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

function bloomInto(renderer: THREE.WebGLRenderer, b: UnrealBloomPass, input: THREE.WebGLRenderTarget): void {
  const oldClear = new THREE.Color();
  renderer.getClearColor(oldClear);
  const oldAlpha = renderer.getClearAlpha();
  const oldAuto = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setClearColor(b.clearColor, 0);
  const fs = (b as unknown as { fsQuad: FullScreenQuad }).fsQuad;
  const high = b.highPassUniforms as Record<string, THREE.IUniform>;
  high['tDiffuse']!.value = input.texture;
  high['luminosityThreshold']!.value = b.threshold;
  fs.material = b.materialHighPassFilter;
  renderer.setRenderTarget(b.renderTargetBright);
  renderer.clear();
  fs.render(renderer);
  let inputRT: THREE.WebGLRenderTarget = b.renderTargetBright;
  for (let i = 0; i < b.nMips; i++) {
    const m = b.separableBlurMaterials[i]!;
    fs.material = m;
    m.uniforms['colorTexture']!.value = inputRT.texture;
    m.uniforms['direction']!.value = BLUR_X;
    renderer.setRenderTarget(b.renderTargetsHorizontal[i]!);
    renderer.clear();
    fs.render(renderer);
    m.uniforms['colorTexture']!.value = b.renderTargetsHorizontal[i]!.texture;
    m.uniforms['direction']!.value = BLUR_Y;
    renderer.setRenderTarget(b.renderTargetsVertical[i]!);
    renderer.clear();
    fs.render(renderer);
    inputRT = b.renderTargetsVertical[i]!;
  }
  fs.material = b.compositeMaterial;
  b.compositeMaterial.uniforms['bloomStrength']!.value = b.strength;
  b.compositeMaterial.uniforms['bloomRadius']!.value = b.radius;
  b.compositeMaterial.uniforms['bloomTintColors']!.value = b.bloomTintColors;
  renderer.setRenderTarget(b.renderTargetsHorizontal[0]!);
  renderer.clear();
  fs.render(renderer);
  renderer.setClearColor(oldClear, oldAlpha);
  renderer.autoClear = oldAuto;
}

// The CPU twin of the final pass's tone map (ACES fit with the input and output matrices, then sRGB), for colours the
// old direct path showed as they were: the sky gradient (a raw shader) and the fog (mixed in after the tone map).
const ACES_IN = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777];
const ACES_OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
const fit = (v: number): number => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const srgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** What the final pass shows for a scene-linear colour (r, g, b), as display values 0..1. Pure. */
export function displayOf(rgb: readonly [number, number, number], exposure: number): [number, number, number] {
  const s = exposure / 0.6;
  const x = rgb.map((v) => v * s);
  const a = [0, 1, 2].map((i) => fit(ACES_IN[i * 3]! * x[0]! + ACES_IN[i * 3 + 1]! * x[1]! + ACES_IN[i * 3 + 2]! * x[2]!));
  return [0, 1, 2].map((i) => srgb(clamp01(ACES_OUT[i * 3]! * a[0]! + ACES_OUT[i * 3 + 1]! * a[1]! + ACES_OUT[i * 3 + 2]! * a[2]!))) as [number, number, number];
}

/**
 * The scene-linear colour that the final pass shows as `display` (0..1 per channel): so a colour the direct path drew
 * raw (the sky, the fog) looks the same through the passes. Damped Gauss-Newton (Levenberg-Marquardt) in log space with a
 * numeric Jacobian, since the ACES matrices mix the channels; a few deep blues lose their last trace of red (ACES cannot
 * show it), the rest match to about 1e-5. Pure.
 */
export function sceneForDisplay(display: readonly [number, number, number], exposure: number): [number, number, number] {
  const d = [display[0], display[1], display[2]];
  const x = d.map((v) => Math.log(Math.max(0.004, v * 0.4)));
  const err = (lx: number[]): number[] => displayOf(lx.map(Math.exp) as [number, number, number], exposure).map((v, i) => v - d[i]!);
  for (let k = 0; k < 60; k++) {
    const f = err(x);
    if (Math.max(Math.abs(f[0]!), Math.abs(f[1]!), Math.abs(f[2]!)) < 1e-5) break;
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];   // J[i][j] = d f_i / d x_j
    for (let j = 0; j < 3; j++) {
      const xp = x.slice(); xp[j]! += 1e-4;
      const fp = err(xp);
      for (let i = 0; i < 3; i++) J[i]![j] = (fp[i]! - f[i]!) / 1e-4;
    }
    const jt = (r: number, c: number): number => J[0]![r]! * J[0]![c]! + J[1]![r]! * J[1]![c]! + J[2]![r]! * J[2]![c]!;
    const M = [0, 1, 2].map((r) => [0, 1, 2].map((c) => jt(r, c)));
    const tr = M[0]![0]! + M[1]![1]! + M[2]![2]!;
    for (let i = 0; i < 3; i++) M[i]![i]! += 1e-6 * tr + 1e-12;
    const g = [0, 1, 2].map((r) => J[0]![r]! * f[0]! + J[1]![r]! * f[1]! + J[2]![r]! * f[2]!);
    const dx = solve3(M, g);
    for (let i = 0; i < 3; i++) x[i] = Math.min(4, Math.max(-12, x[i]! - Math.max(-1.5, Math.min(1.5, dx[i]!))));
  }
  return x.map(Math.exp) as [number, number, number];
}

function solve3(M: number[][], b: number[]): number[] {
  const [a, c, e] = M as [number[], number[], number[]];
  const det = a[0]! * (c[1]! * e[2]! - c[2]! * e[1]!) - a[1]! * (c[0]! * e[2]! - c[2]! * e[0]!) + a[2]! * (c[0]! * e[1]! - c[1]! * e[0]!);
  if (Math.abs(det) < 1e-30) return [0, 0, 0];
  const inv = [
    [c[1]! * e[2]! - c[2]! * e[1]!, a[2]! * e[1]! - a[1]! * e[2]!, a[1]! * c[2]! - a[2]! * c[1]!],
    [c[2]! * e[0]! - c[0]! * e[2]!, a[0]! * e[2]! - a[2]! * e[0]!, a[2]! * c[0]! - a[0]! * c[2]!],
    [c[0]! * e[1]! - c[1]! * e[0]!, a[1]! * e[0]! - a[0]! * e[1]!, a[0]! * c[1]! - a[1]! * c[0]!],
  ];
  return [0, 1, 2].map((i) => (inv[i]![0]! * b[0]! + inv[i]![1]! * b[1]! + inv[i]![2]! * b[2]!) / det);
}
