// GLSL for the globe. Everything outputs linear light; the OutputPass tone-maps (ACES) and
// converts to sRGB, and the bloom pass picks up anything bright (fires, glints, the rim).

export const earthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vP;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const earthFrag = /* glsl */ `
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform sampler2D uWater;
uniform sampler2D uHeat;
uniform vec3 uSun;
uniform float uCloudShift;
uniform float uHeat0;   // MODIS glow
uniform float uHeat1;   // VIIRS glow
uniform float uTime;
uniform float uRim;     // inner atmosphere strength: full from afar, faint up close
varying vec2 vUv;
varying vec3 vN;
varying vec3 vP;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vP);
  float ndl = dot(N, uSun);
  float day = smoothstep(-0.10, 0.20, ndl);

  vec3 albedo = texture2D(uDay, vUv).rgb;
  float water = texture2D(uWater, vUv).r;
  // Blue Marble NG oceans are near black: lift them into a deep, slightly teal blue.
  albedo = mix(albedo, albedo * vec3(0.7, 0.9, 1.15) + vec3(0.004, 0.018, 0.04), water);

  float shadow = texture2D(uClouds, vUv + vec2(uCloudShift - 0.0012, 0.0008)).r;
  vec3 col = albedo * (max(ndl, 0.0) * 1.05 + 0.004) * (1.0 - shadow * 0.35);

  // Sun glint on water, warmer near the terminator.
  vec3 H = normalize(uSun + V);
  float glint = pow(max(dot(N, H), 0.0), 160.0) * smoothstep(0.6, 1.0, water) * day;
  col += mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.92, 0.8), smoothstep(0.0, 0.5, ndl)) * glint * 0.7;

  // City lights on the night side (sodium-warm).
  float lights = texture2D(uNight, vUv).r;
  // Cities stay faint and pale-cool: on this globe, every warm glow is a fire.
  col += vec3(0.62, 0.7, 0.86) * pow(lights, 2.6) * 0.11 * (1.0 - day);

  // Fire glow: the week's hotspots smoulder into the ground, strongest at night.
  vec2 heat = texture2D(uHeat, vUv).rg;
  float h = heat.r * uHeat0 + heat.g * uHeat1;
  float flick = 0.85 + 0.15 * sin(uTime * 1.7 + vUv.x * 900.0) * sin(uTime * 2.3 + vUv.y * 700.0);
  vec3 ember = mix(vec3(0.55, 0.05, 0.0), vec3(1.0, 0.42, 0.06), clamp(h * 1.4, 0.0, 1.0));
  col += ember * h * flick * mix(0.06, 0.55, 1.0 - day);

  // A warm band along the terminator, then the atmosphere's inner rim.
  float term = exp(-pow(ndl / 0.08, 2.0));
  col += vec3(0.9, 0.32, 0.08) * term * 0.035;
  // Clamped: dot(N, V) can round a hair above 1 facing the camera, and pow() of a negative
  // base is NaN on some GPUs, which the bloom then spreads into a black frame.
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 2.6);
  vec3 atm = mix(vec3(1.0, 0.42, 0.16), vec3(0.32, 0.62, 1.0), smoothstep(-0.05, 0.35, ndl));
  col += atm * fres * smoothstep(-0.25, 0.3, ndl) * 0.85 * uRim;

  gl_FragColor = vec4(col, 1.0);
}`;

export const cloudFrag = /* glsl */ `
uniform sampler2D uClouds;
uniform vec3 uSun;
uniform float uCloudShift;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vP;
void main() {
  vec3 N = normalize(vN);
  float ndl = dot(N, uSun);
  float c = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r;
  c = smoothstep(0.08, 0.9, c);
  vec3 lit = vec3(1.0, 0.98, 0.95) * (max(ndl, 0.0) * 0.95 + 0.006);
  // Sunset tint on the clouds near the terminator.
  lit = mix(lit, vec3(1.0, 0.5, 0.25) * 0.6, exp(-pow((ndl - 0.03) / 0.09, 2.0)) * 0.6);
  float day = smoothstep(-0.15, 0.15, ndl);
  gl_FragColor = vec4(lit, c * uOpacity * mix(0.5, 0.9, day));
}`;

export const atmoVert = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Outer halo, drawn on the back faces of a slightly larger sphere.
export const atmoFrag = /* glsl */ `
uniform vec3 uSun;
uniform float uStrength;
varying vec3 vN;
varying vec3 vP;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vP);
  // Back faces: dot(N, V) is about -0.42 where the ray grazes the planet (r = 1 inside r = 1.1)
  // and 0 at the shell's own edge, so the glow hugs the limb and fades outward.
  float rim = pow(clamp(-dot(N, V) / 0.42, 0.0, 1.0), 3.2);
  float ndl = dot(N, uSun);
  vec3 c = mix(vec3(1.0, 0.38, 0.12), vec3(0.3, 0.6, 1.0), smoothstep(-0.1, 0.4, ndl));
  float lit = smoothstep(-0.35, 0.25, ndl);
  gl_FragColor = vec4(c * rim * lit * uStrength, 1.0);
}`;

export const fireVert = /* glsl */ `
attribute float aCount;
attribute float aFrp;
attribute float aSensor;
attribute float aSeed;
attribute float aNight;
uniform float uTime;
uniform float uModis;
uniform float uViirs;
uniform float uProj;     // pixels per world unit at distance 1
uniform float uSize;     // world size of one cell's glow
uniform vec3 uSat0;      // MODIS satellite (world)
uniform vec3 uSat1;      // VIIRS satellite (world)
uniform float uSwath0;   // half swath, radians
uniform float uSwath1;
uniform vec3 uSun;
uniform float uGain;     // dims the layer up close, where cells overlap on screen
varying float vI;
varying float vHot;
varying float vScan;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(wp.xyz);
  float isV = step(0.5, aSensor);
  float vis = mix(uModis, uViirs, isV);
  vec3 toCam = cameraPosition - wp.xyz;
  float facing = dot(n, normalize(toCam));

  // Fires light up as a satellite's swath passes over them.
  vec3 sat = mix(uSat0, uSat1, isV);
  float sw = mix(uSwath0, uSwath1, isV);
  float d = acos(clamp(dot(n, normalize(sat)), -1.0, 1.0));
  vScan = smoothstep(sw, sw * 0.55, d) * step(0.001, length(sat));

  float c = log2(1.0 + aCount);
  float flicker = 0.7 + 0.3 * sin(uTime * (2.0 + aSeed * 6.0) + aSeed * 60.0);
  float dayside = smoothstep(-0.1, 0.25, dot(n, uSun));
  vI = vis * (0.55 + 0.45 * flicker) * (0.16 + 0.08 * c) * mix(1.25, 0.5, dayside) * (1.0 + vScan * 1.8) * uGain;
  vHot = clamp(log2(1.0 + aFrp) / 8.5, 0.0, 1.0);

  vec4 mv = viewMatrix * wp;
  float size = uSize * (0.75 + 0.55 * c) * (0.7 + 0.5 * vHot) * (1.0 + vScan * 0.6);
  gl_PointSize = min(26.0, size * uProj / -mv.z) * step(0.02, facing) * step(0.002, vis);
  gl_Position = projectionMatrix * mv;
}`;

export const fireFrag = /* glsl */ `
varying float vI;
varying float vHot;
varying float vScan;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float core = exp(-r * 10.0);
  float halo = exp(-r * 3.2) * 0.42;
  vec3 ember = mix(vec3(1.0, 0.22, 0.03), vec3(1.0, 0.62, 0.22), vHot);
  vec3 col = ember * (halo + core) + vec3(1.0, 0.93, 0.78) * core * core * (0.35 + 0.65 * vHot);
  col = mix(col, col + vec3(0.25, 0.75, 0.85) * core * 0.6, vScan * 0.6);
  gl_FragColor = vec4(col * vI, 1.0);
}`;

// The sensor's swath: a fan from the satellite down to the ground, with scan lines.
export const swathVert = /* glsl */ `
attribute float aT;      // 0 at the satellite, 1 on the ground
attribute float aS;      // -1..1 across the swath
varying float vT;
varying float vS;
void main() {
  vT = aT; vS = aS;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

export const swathFrag = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
varying float vT;
varying float vS;
void main() {
  float edge = smoothstep(1.0, 0.82, abs(vS));
  float scan = 0.55 + 0.45 * smoothstep(0.75, 1.0, fract(vS * 0.5 + 0.5 - uTime * 1.4));
  float body = mix(0.06, 0.34, vT * vT) * edge * scan;
  float ground = smoothstep(0.9, 1.0, vT) * edge * 0.9;
  gl_FragColor = vec4(uColor * (body + ground) * uOpacity, 1.0);
}`;

export const starVert = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform float uPx;
varying float vA;
void main() {
  vA = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 50.0);
  gl_PointSize = aSize * uPx;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

export const starFrag = /* glsl */ `
uniform float uOpacity;
varying float vA;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * exp(-r * 5.0) * vA * uOpacity, 1.0);
}`;
