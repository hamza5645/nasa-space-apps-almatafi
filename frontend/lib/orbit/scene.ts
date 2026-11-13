// The orbit scene behind the landing story and the Method header: a lit Earth (NASA Blue
// Marble NG + Black Marble, GIBS), a real week of FIRMS fires, and two NASA satellite models
// (Aqua for MODIS, Suomi NPP for VIIRS) flying their swaths. A story position `p` drives the
// camera between keyframes; the page sets it from the scroll position.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadFires } from "./fires";
import { lerp, llToVec, smooth, sunVec } from "./geo3";
import * as S from "./shaders";

export type Preset = "landing" | "method";

export type OrbitScene = {
  /** Story position: an index into the preset's keyframes (fractions blend between them). */
  setProgress: (p: number) => void;
  setActive: (active: boolean) => void;
  /** Resolves once the globe has drawn its first textured frame. */
  ready: Promise<void>;
  dispose: () => void;
};

type Cam = { pos: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; offX: number; offY: number };
type Look = Cam & { modis: number; viirs: number; heat: number; satScale: number; swath0: number; swath1: number; stars: number };

type Sat = {
  rig: THREE.Group;
  model: THREE.Object3D | null;
  node: number; inc: number; alt: number; halfSwath: number;
  u: number; pos: THREE.Vector3; vel: THREE.Vector3; up: THREE.Vector3; side: THREE.Vector3;
  fan: THREE.Mesh; fanGeo: THREE.BufferGeometry; trail: THREE.Line;
};

const DEG = Math.PI / 180;
const SENSOR = new THREE.Color("#6BD0E4");
const DELTA = { lat: 30.75, lon: 31.0 };

export function createOrbitScene(canvas: HTMLCanvasElement, preset: Preset): OrbitScene {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  let dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.6);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x05070b, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 200);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  // Sun: subsolar point in November (−15°) and west of Africa, so the Delta sits at dusk.
  const sun = sunVec(-15, -52);
  // Subsolar longitude per keyframe: night falls over Africa for the satellite passes,
  // then the Delta sits at dusk for the dive (the film is a sunset).
  const SUN_LON: Record<Preset, number[]> = { landing: [-52, -56, -96, -100, -64, -46, -50], method: [-98, -98, -100, -70] };
  const light = new THREE.DirectionalLight(0xfff1df, 1.7);
  light.position.copy(sun).multiplyScalar(10);
  scene.add(light, new THREE.HemisphereLight(0x6a8fbf, 0x1a120c, 0.35));

  // ---- Earth -------------------------------------------------------------------------------
  // Maps decode off the main thread (decoding the day map on upload froze it for ~380 ms) and
  // upload as each arrives. Safari < 17 and Firefox < 98 ignore createImageBitmap's options
  // (three's GLTFLoader checks the same), so they keep plain images.
  const ua = navigator.userAgent, ver = (re: RegExp, none: number) => +(ua.match(re)?.[1] ?? none);
  const bitmaps = typeof createImageBitmap === "function" && !(/^((?!chrome|android).)*safari/i.test(ua) && ver(/Version\/(\d+)/, 0) < 17)
    && ver(/Firefox\/(\d+)/, 99) >= 98;
  // WebGL ignores UNPACK_FLIP_Y for ImageBitmaps, so they're flipped while decoding instead.
  const loader = bitmaps ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" }) : new THREE.ImageLoader();
  const loads: Promise<void>[] = [];
  const tex = (url: string, srgb: boolean, wrap = true) => {
    const t = new THREE.Texture();
    t.flipY = !bitmaps;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (wrap) t.wrapS = THREE.RepeatWrapping;
    loads.push(new Promise((done) => loader.load(url, (img: ImageBitmap | HTMLImageElement) => {
      if (!disposed) { t.image = img; t.needsUpdate = true; renderer.initTexture(t); } else (img as Partial<ImageBitmap>).close?.();
      done();
    }, undefined, () => done())));
    return t;
  };
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;

  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  // 4K everywhere: the 8K map's upload to the GPU froze big screens for ~290 ms at load.
  const day = tex("/globe/earth-day-4k.jpg", true, false);
  let dayLoaded = false;
  const clouds = tex("/globe/earth-clouds-4k.jpg", false);

  const earthU = {
    uDay: { value: day }, uNight: { value: tex("/globe/earth-night-4k.jpg", false) }, uClouds: { value: clouds },
    uWater: { value: tex("/globe/earth-water.png", false) }, uHeat: { value: black as THREE.Texture },
    uSun: { value: sun }, uCloudShift: { value: 0 }, uHeat0: { value: 0 }, uHeat1: { value: 0 }, uTime: { value: 0 }, uRim: { value: 1 },
  };
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 192, 128),
    new THREE.ShaderMaterial({ uniforms: earthU, vertexShader: S.earthVert, fragmentShader: S.earthFrag }),
  );
  scene.add(earth);

  const cloudU = { uClouds: { value: clouds }, uSun: { value: sun }, uCloudShift: { value: 0 }, uOpacity: { value: 0.85 } };
  const cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.007, 160, 110),
    new THREE.ShaderMaterial({ uniforms: cloudU, vertexShader: S.earthVert, fragmentShader: S.cloudFrag, transparent: true, depthWrite: false }),
  );
  cloudMesh.renderOrder = 1;
  scene.add(cloudMesh);

  const atmoU = { uSun: { value: sun }, uStrength: { value: 1.25 } };
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 128, 96),
    new THREE.ShaderMaterial({ uniforms: atmoU, vertexShader: S.atmoVert, fragmentShader: S.atmoFrag, side: THREE.BackSide,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
  );
  scene.add(atmo);

  // ---- Stars and the sun -------------------------------------------------------------------
  const starU = { uTime: { value: 0 }, uPx: { value: dpr }, uOpacity: { value: 1 } };
  {
    const n = 4200, pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(80);
      pos.set([v.x, v.y, v.z], i * 3);
      size[i] = Math.random() < 0.06 ? 3.2 + Math.random() * 2 : 1.2 + Math.random() * 1.4;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    scene.add(new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: starU, vertexShader: S.starVert, fragmentShader: S.starFrag,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
  }
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff0d8, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true }));
  sunSprite.position.copy(sun).multiplyScalar(60);
  sunSprite.scale.setScalar(9);
  scene.add(sunSprite);

  // ---- Fires -------------------------------------------------------------------------------
  const fireU = {
    uTime: { value: 0 }, uModis: { value: 0 }, uViirs: { value: 0 }, uProj: { value: 800 }, uSize: { value: 0.0042 },
    uSat0: { value: new THREE.Vector3() }, uSat1: { value: new THREE.Vector3() }, uSwath0: { value: 0 }, uSwath1: { value: 0 },
    uSun: { value: sun }, uGain: { value: 1 },
  };
  let fires: THREE.Points | null = null;
  loadFires().then(async (f) => {
    const pts = new THREE.Points(f.geometry, new THREE.ShaderMaterial({ uniforms: fireU, vertexShader: S.fireVert, fragmentShader: S.fireFrag,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    pts.renderOrder = 2;
    // Upload and compile before it joins the scene, so no visible frame stalls on it.
    if (!disposed) { renderer.initTexture(f.heat); await precompile(pts); }
    if (disposed) { f.geometry.dispose(); f.heat.dispose(); pts.material.dispose(); return; }
    fires = pts;
    scene.add(fires);
    earthU.uHeat.value = f.heat;
  }).catch(() => { /* the globe still works without the fire layer */ });

  // ---- Satellites --------------------------------------------------------------------------
  // Aqua (MODIS, 705 km, 2,330 km swath) and Suomi NPP (VIIRS, 824 km, 3,060 km swath),
  // both sun-synchronous at ~98°. Equator crossings over Africa so they pass the camera.
  const sats: Sat[] = [makeSat(26, 98.2, 705, 2330), makeSat(30, 98.7, 824, 3060)];
  const gltf = new GLTFLoader();
  gltf.setMeshoptDecoder(MeshoptDecoder);
  const MODELS: [string, (o: THREE.Object3D) => void][] = [
    // Each model's own axes differ: turn it so its long axis runs along the track, nadir down.
    ["/models/aqua.glb", (o) => { o.rotation.set(0, Math.PI / 2, 0); }],
    ["/models/snpp.glb", (o) => { o.rotation.set(0, 0, 0); }],
  ];
  MODELS.forEach(([url, orient], i) => {
    gltf.load(url, (g) => {
      if (disposed) return;
      const o = g.scene;
      const box = new THREE.Box3().setFromObject(o);
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      o.position.sub(c);
      const holder = new THREE.Group();
      holder.add(o);
      holder.scale.setScalar(1 / Math.max(s.x, s.y, s.z));
      orient(holder);
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((mat) => {
            const sm = mat as THREE.MeshStandardMaterial; if ("envMapIntensity" in sm) sm.envMapIntensity = 0.5;
            // Upload its maps now, not in the frame that first shows the model.
            Object.values(mat).forEach((v) => (v as THREE.Texture | null)?.isTexture && renderer.initTexture(v));
          });
        }
      });
      precompile(holder).then(() => {
        if (disposed) return;
        sats[i].rig.add(holder);
        sats[i].model = holder;
      });
    });
  });

  function makeSat(nodeLon: number, incDeg: number, altKm: number, swathKm: number): Sat {
    const rig = new THREE.Group();
    scene.add(rig);
    const R = 8, C = 33;
    const fanGeo = new THREE.BufferGeometry();
    const aT = new Float32Array(R * C), aS = new Float32Array(R * C), idx: number[] = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      aT[r * C + c] = r / (R - 1); aS[r * C + c] = (c / (C - 1)) * 2 - 1;
      if (r < R - 1 && c < C - 1) { const a = r * C + c; idx.push(a, a + C, a + 1, a + 1, a + C, a + C + 1); }
    }
    fanGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(R * C * 3), 3));
    fanGeo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    fanGeo.setAttribute("aS", new THREE.BufferAttribute(aS, 1));
    fanGeo.setIndex(idx);
    const fan = new THREE.Mesh(fanGeo, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: SENSOR.clone() } },
      vertexShader: S.swathVert, fragmentShader: S.swathFrag, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    fan.frustumCulled = false;
    fan.renderOrder = 3;
    scene.add(fan);
    const TN = 160;
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TN * 3), 3));
    const col = new Float32Array(TN * 3);
    for (let i = 0; i < TN; i++) { const a = Math.pow(i / (TN - 1), 2.2) * 0.9; col.set([SENSOR.r * a, SENSOR.g * a, SENSOR.b * a], i * 3); }
    trailGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false }));
    trail.frustumCulled = false;
    scene.add(trail);
    return {
      rig, model: null, node: nodeLon, inc: incDeg * DEG, alt: altKm / 6371, halfSwath: swathKm / 2 / 6371,
      u: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), up: new THREE.Vector3(), side: new THREE.Vector3(), fan, fanGeo, trail,
    };
  }

  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function orbitPoint(s: Sat, u: number, out: THREE.Vector3, vel?: THREE.Vector3) {
    const n = llToVec(0, s.node, 1, tmpA);
    const e = llToVec(0, s.node + 90, 1, tmpB);
    const ci = Math.cos(s.inc), si = Math.sin(s.inc);
    // m = cos(i)·east + sin(i)·north: the orbit plane's second axis.
    const mx = e.x * ci, my = si, mz = e.z * ci;
    const cu = Math.cos(u), su = Math.sin(u);
    out.set(n.x * cu + mx * su, n.y * cu + my * su, n.z * cu + mz * su).multiplyScalar(1 + s.alt);
    if (vel) vel.set(-n.x * su + mx * cu, -n.y * su + my * cu, -n.z * su + mz * cu).normalize();
    return out;
  }

  const basis = new THREE.Matrix4(), g = new THREE.Vector3(), q = new THREE.Vector3();
  function placeSat(s: Sat, scale: number, swathOpacity: number, time: number) {
    orbitPoint(s, s.u, s.pos, s.vel);
    s.up.copy(s.pos).normalize();
    s.side.crossVectors(s.vel, s.up).normalize();
    s.rig.position.copy(s.pos);
    basis.makeBasis(s.vel, s.up, s.side);
    s.rig.quaternion.setFromRotationMatrix(basis);
    s.rig.scale.setScalar(scale);
    s.rig.visible = scale > 0.0005;
    // Swath fan
    const p = s.fanGeo.getAttribute("position") as THREE.BufferAttribute;
    const R = 8, C = 33;
    for (let c = 0; c < C; c++) {
      const a = ((c / (C - 1)) * 2 - 1) * s.halfSwath;
      g.copy(s.up).multiplyScalar(Math.cos(a)).addScaledVector(s.side, Math.sin(a)).normalize().multiplyScalar(1.002);
      for (let r = 0; r < R; r++) { q.copy(s.pos).lerp(g, r / (R - 1)); p.setXYZ(r * C + c, q.x, q.y, q.z); }
    }
    p.needsUpdate = true;
    const fm = s.fan.material as THREE.ShaderMaterial;
    fm.uniforms.uOpacity.value = swathOpacity;
    fm.uniforms.uTime.value = time;
    s.fan.visible = swathOpacity > 0.01;
    // Trail: the last ~70° of the orbit, fading out behind.
    const tp = s.trail.geometry.getAttribute("position") as THREE.BufferAttribute;
    const TN = tp.count;
    for (let i = 0; i < TN; i++) { orbitPoint(s, s.u - 1.2 * (1 - i / (TN - 1)), q); tp.setXYZ(i, q.x, q.y, q.z); }
    tp.needsUpdate = true;
    (s.trail.material as THREE.LineBasicMaterial).opacity = Math.min(1, swathOpacity * 1.4 + 0.15);
    s.trail.visible = scale > 0.0005;
  }

  // ---- Camera keyframes --------------------------------------------------------------------
  const Y = new THREE.Vector3(0, 1, 0);
  let aspect = 1;
  const drag = { lat: 0, lon: 0, vlat: 0, vlon: 0, mx: 0, my: 0 };

  function globe(lat: number, lon: number, dist: number, offX: number, offY = 0): Cam {
    // Phones: the text sits on top, so the globe moves into the lower half (a positive offY
    // moves the picture down) and pulls back to fit the narrow width.
    const portrait = aspect < 0.9;
    const d = portrait ? dist * Math.min(1.6, 0.9 / aspect) : dist;
    return { pos: llToVec(lat, lon, d), target: new THREE.Vector3(), up: Y.clone(), offX: portrait ? 0 : offX, offY: portrait ? (offY || 0.25) : offY };
  }
  function track(s: Sat, back: number, high: number, side: number): Cam {
    const pos = s.pos.clone().addScaledVector(s.vel, -back).addScaledVector(s.up, high).addScaledVector(s.side, side);
    const target = s.pos.clone().addScaledVector(s.vel, back * 0.45).addScaledVector(s.up, -high * 0.55);
    return { pos, target, up: s.up.clone(), offX: aspect < 0.9 ? 0 : 0.12, offY: aspect < 0.9 ? 0.16 : 0 };
  }
  function above(lat: number, lon: number, alt: number, tiltDeg: number): Cam {
    // From above a place, looking north toward the horizon by `tilt`.
    const pos = llToVec(lat - alt * 18 * Math.sin(tiltDeg * DEG), lon, 1 + alt);
    const target = llToVec(lat + 0.8, lon, 1.0);
    return { pos, target, up: llToVec(lat, lon, 1).normalize(), offX: 0, offY: 0 };
  }

  const keys: Record<Preset, ((p: number) => Look)[]> = {
    landing: [
      () => ({ ...globe(16, 22, 5.3, 0.19), modis: 0, viirs: 1, heat: 1, satScale: 0.04, swath0: 0.0, swath1: 0.0, stars: 1 }),
      () => ({ ...globe(6, 24, 4.4, 0.17), modis: 0.0, viirs: 1, heat: 1, satScale: 0.04, swath0: 0.25, swath1: 0.25, stars: 1 }),
      () => ({ ...track(sats[0], 0.085, 0.032, 0.04), modis: 1, viirs: 0, heat: 0.7, satScale: 0.016, swath0: 1, swath1: 0, stars: 1 }),
      () => ({ ...track(sats[1], 0.12, 0.06, -0.05), modis: 0, viirs: 1, heat: 1, satScale: 0.016, swath0: 0, swath1: 1, stars: 1 }),
      () => ({ ...globe(22, 28, 4.8, 0.16), modis: 0, viirs: 1, heat: 1, satScale: 0.03, swath0: 0.2, swath1: 0.2, stars: 1 }),
      () => ({ ...above(DELTA.lat, DELTA.lon, 0.62, 22), modis: 0, viirs: 1, heat: 1, satScale: 0.0, swath0: 0, swath1: 0, stars: 0.6 }),
      () => ({ ...above(DELTA.lat, DELTA.lon, 0.2, 40), modis: 0, viirs: 1, heat: 0.8, satScale: 0.0, swath0: 0, swath1: 0, stars: 0.2 }),
    ],
    method: [
      // Title: Aqua from further back. MODIS chapter: close on Aqua. VIIRS: Suomi NPP. Then away.
      () => ({ ...track(sats[0], 0.15, 0.065, 0.07), modis: 1, viirs: 0, heat: 0.7, satScale: 0.016, swath0: 1, swath1: 0, stars: 1 }),
      () => ({ ...track(sats[0], 0.075, 0.028, 0.042), modis: 1, viirs: 0, heat: 0.7, satScale: 0.016, swath0: 1, swath1: 0, stars: 1 }),
      () => ({ ...track(sats[1], 0.12, 0.06, -0.05), modis: 0, viirs: 1, heat: 1, satScale: 0.016, swath0: 0, swath1: 1, stars: 1 }),
      // Leaving: pull back along Suomi NPP's orbit, the swath still sweeping.
      () => ({ ...track(sats[1], 0.42, 0.3, -0.12), modis: 0, viirs: 1, heat: 1, satScale: 0.02, swath0: 0, swath1: 0.8, stars: 1 }),
    ],
  };
  // Where each satellite is along its orbit for a story position (radians from the node).
  const phase: Record<Preset, (p: number) => [number, number]> = {
    landing: (p) => [-0.62 + p * 0.22, -1.25 + Math.max(0, p - 1.2) * 0.26 + p * 0.08],
    method: (p) => [-0.3 + p * 0.22, -0.55 + Math.max(0, p - 1.2) * 0.3],
  };

  // ---- Post ------------------------------------------------------------------------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Shader programs compile in parallel (KHR_parallel_shader_compile) instead of stalling the
  // first frame that draws them. Programs depend on their target, so compile against the composer's.
  function precompile(o: THREE.Object3D, into = scene) {
    renderer.setRenderTarget(composer.readBuffer);
    const done = renderer.compileAsync(o, camera, into);
    renderer.setRenderTarget(null);
    return done;
  }
  // Draw nothing until every map is up and every program is linked, the hidden ones too: the
  // swath fans first showed mid-scroll and froze that frame for ~0.5 s compiling. The bloom
  // pass's programs come along; the output pass's tiny one compiles on the first, unseen frame.
  Promise.all(loads).then(async () => {
    if (disposed || !day.image) return; // no day map, no globe (as before)
    const quad = new THREE.PlaneGeometry(), post = new THREE.Scene();
    [bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.blendMaterial]
      .forEach((m) => post.add(new THREE.Mesh(quad, m)));
    await Promise.all([precompile(scene), precompile(post, post)]);
    quad.dispose();
    dayLoaded = true;
  });

  let cw = 1, ch = 1; // the canvas size, kept here so frames don't read layout
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    cw = canvas.clientWidth || 1; ch = canvas.clientHeight || 1;
    aspect = w / h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = aspect;
    fireU.uProj.value = (h * dpr) / (2 * Math.tan((camera.fov * DEG) / 2));
    starU.uPx.value = dpr;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // ---- Input (hero only) ---------------------------------------------------------------------
  let dragging = false, lastX = 0, lastY = 0;
  const onDown = (e: PointerEvent) => { if (target < 0.6) { dragging = true; lastX = e.clientX; lastY = e.clientY; } };
  const onMove = (e: PointerEvent) => {
    drag.mx = (e.clientX / window.innerWidth) * 2 - 1; drag.my = (e.clientY / window.innerHeight) * 2 - 1;
    if (!dragging) return;
    drag.vlon = -(e.clientX - lastX) * 0.22; drag.vlat = (e.clientY - lastY) * 0.12;
    drag.lon += drag.vlon; drag.lat = Math.max(-40, Math.min(40, drag.lat + drag.vlat));
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = () => { dragging = false; };
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", onUp);

  // ---- Loop ------------------------------------------------------------------------------
  let target = 0, p = 0, active = true, disposed = false, raf = 0, last = performance.now(), time = 0;
  let intro = 0, firstDrawn = false, slowFrames = 0;
  const cam: Cam = { pos: new THREE.Vector3(0, 0, 8), target: new THREE.Vector3(), up: Y.clone(), offX: 0, offY: 0 };
  const heroOff = new THREE.Vector3(), heroDir = new THREE.Vector3(), heroQ = new THREE.Quaternion();
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function blend(list: ((p: number) => Look)[], x: number): Look {
    const i = Math.max(0, Math.min(list.length - 1, Math.floor(x)));
    const j = Math.min(list.length - 1, i + 1);
    const t = smooth(0, 1, x - i);
    const a = list[i](x), b = list[j](x);
    return {
      pos: a.pos.lerp(b.pos, t), target: a.target.lerp(b.target, t), up: a.up.lerp(b.up, t).normalize(),
      offX: lerp(a.offX, b.offX, t), offY: lerp(a.offY, b.offY, t), modis: lerp(a.modis, b.modis, t), viirs: lerp(a.viirs, b.viirs, t),
      heat: lerp(a.heat, b.heat, t), satScale: lerp(a.satScale, b.satScale, t), swath0: lerp(a.swath0, b.swath0, t),
      swath1: lerp(a.swath1, b.swath1, t), stars: lerp(a.stars, b.stars, t),
    };
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    // rAF's timestamp can be a little older than performance.now() at start: never negative.
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!active) return;
    time += still ? 0 : dt;
    if (dayLoaded) intro = Math.min(1, intro + dt / 2.6);

    // Ease toward the scroll position, so scrubbing glides instead of stepping.
    p += (target - p) * (1 - Math.exp(-dt * 7));

    const [u0, u1] = phase[preset](p);
    sats[0].u = u0 + time * 0.006;
    sats[1].u = u1 + time * 0.006;
    sats.forEach((s) => orbitPoint(s, s.u, s.pos, s.vel));
    sats.forEach((s) => { s.up.copy(s.pos).normalize(); s.side.crossVectors(s.vel, s.up).normalize(); });

    // Drag inertia and a little mouse parallax in the hero.
    if (!dragging) { drag.lon += drag.vlon; drag.vlon *= 0.93; drag.vlat *= 0.9; }
    const heroW = preset === "landing" ? 1 - smooth(0.15, 0.8, p) : 0;
    const look = blend(keys[preset], p);
    if (heroW > 0.001) {
      const off = llToVec(drag.lat * heroW + drag.my * 2 * heroW, 0, 1, heroOff);
      const r = look.pos.length();
      const dir = heroDir.copy(look.pos).normalize();
      dir.applyQuaternion(heroQ.setFromAxisAngle(Y, (drag.lon - drag.mx * 2) * heroW * DEG));
      dir.y += off.y * 0.5; dir.normalize();
      look.pos.copy(dir.multiplyScalar(r));
    }
    // Intro: arrive from deep space.
    const e = 1 - Math.pow(1 - intro, 3);
    look.pos.multiplyScalar(lerp(2.4, 1, e));

    const k = 1 - Math.exp(-dt * 9);
    cam.pos.lerp(look.pos, firstDrawn ? k : 1);
    cam.target.lerp(look.target, firstDrawn ? k : 1);
    cam.up.lerp(look.up, firstDrawn ? k : 1).normalize();
    cam.offX = lerp(cam.offX, look.offX, firstDrawn ? k : 1);
    cam.offY = lerp(cam.offY, look.offY, firstDrawn ? k : 1);
    camera.position.copy(cam.pos);
    camera.up.copy(cam.up);
    camera.lookAt(cam.target);
    camera.setViewOffset(cw, ch, -cam.offX * cw, -cam.offY * ch, cw, ch);
    camera.near = Math.max(0.002, (cam.pos.length() - 1) * 0.2);
    camera.updateProjectionMatrix();

    const sl = SUN_LON[preset], si = Math.max(0, Math.min(sl.length - 1, Math.floor(p)));
    sunVec(-15, lerp(sl[si], sl[Math.min(sl.length - 1, si + 1)], smooth(0, 1, p - si)), sun);
    light.position.copy(sun).multiplyScalar(10);
    sunSprite.position.copy(sun).multiplyScalar(60);
    const alt = cam.pos.length() - 1;
    earthU.uRim.value = smooth(0.12, 1.4, alt);
    fireU.uGain.value = lerp(0.42, 1, smooth(0.05, 1.6, alt));
    fireU.uModis.value = look.modis; fireU.uViirs.value = look.viirs; fireU.uTime.value = time;
    fireU.uSat0.value.copy(look.swath0 > 0.3 ? sats[0].pos : tmpA.set(0, 0, 0));
    fireU.uSat1.value.copy(look.swath1 > 0.3 ? sats[1].pos : tmpB.set(0, 0, 0));
    fireU.uSwath0.value = sats[0].halfSwath; fireU.uSwath1.value = sats[1].halfSwath;
    // Fires get a touch bigger up close so the Delta's fields read at low altitude.
    fireU.uSize.value = lerp(0.0012, 0.0034, smooth(0.04, 1.2, cam.pos.length() - 1));
    // The ground glow is a 2048 px map: lovely from afar, a smear up close, so it fades as we descend.
    const glow = look.heat * smooth(0.08, 0.9, alt);
    earthU.uHeat0.value = look.modis * glow; earthU.uHeat1.value = look.viirs * glow;
    earthU.uTime.value = time;
    earthU.uCloudShift.value = cloudU.uCloudShift.value = time * 0.0009;
    cloudU.uOpacity.value = lerp(0.85, 0.35, smooth(0.25, 0.04, cam.pos.length() - 1));
    starU.uTime.value = time; starU.uOpacity.value = look.stars;
    renderer.toneMappingExposure = lerp(0.0, 1.0, Math.min(1, intro * 1.6));
    sats.forEach((s, i) => placeSat(s, look.satScale * (s.model ? 1 : 0), i === 0 ? look.swath0 : look.swath1, time));

    if (!dayLoaded) return; // nothing to show yet, and drawing now would stall on the compiles
    composer.render(dt);
    if (!firstDrawn) { firstDrawn = true; resolveReady(); }

    // Too slow? Drop resolution once.
    if (dt > 0.028) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 30 && dpr > 1) { dpr = 1; slowFrames = 0; resize(); }
  }
  raf = requestAnimationFrame(frame);
  if (process.env.NODE_ENV !== "production") (window as unknown as Record<string, unknown>).__orbit = { renderer, scene, camera, cam, get p() { return p; }, get intro() { return intro; }, get active() { return active; }, get dayLoaded() { return dayLoaded; }, get time() { return time; } };

  return {
    setProgress: (x) => { target = x; if (still) p = x; },
    setActive: (a) => { if (a && !active) last = performance.now(); active = a; },
    ready,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      loader.abort(); // maps still on their way
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        mats.forEach((mat) => {
          Object.values((mat as THREE.ShaderMaterial).uniforms ?? {}).forEach((u) => (u.value as THREE.Texture)?.isTexture && (u.value as THREE.Texture).dispose());
          mat.dispose();
        });
      });
      // Decoded bitmaps hold their pixels (32 MB for the day map) until closed.
      [day, clouds, earthU.uNight.value, earthU.uWater.value].forEach((t) => (t.image as Partial<ImageBitmap> | null)?.close?.());
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.08, "rgba(255,240,215,0.9)");
  grad.addColorStop(0.3, "rgba(255,190,120,0.18)");
  grad.addColorStop(1, "rgba(255,160,80,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
