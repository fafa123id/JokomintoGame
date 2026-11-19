import * as THREE from "/asset/vendor/three/three.module.min.js";
import { motionEnabled } from "../motion.js";

// Sprite space is 200 x 314, y pointing down (see pet.js). The mesh covers a padded box so
// accessories that stick out (hats, wings) are kept; the canvas adds headroom for jumps.
const PLANE = { x: -30, y: -40, w: 260, h: 370 };
const VIEW = { x: -60, y: -110, w: 320, h: 455 };
const UNIT = 0.01;
const FOV = 30;
const SEGMENTS = { x: 84, y: 120 };

const RIG = {
  earPivotL: [55, 74],
  earPivotR: [138, 72],
  shoulderL: [38, 208],
  shoulderR: [162, 208],
  neck: [100, 205],
  feet: [100, 314],
  eyeL: [77, 137],
  eyeR: [123, 137],
  skinSample: [100, 127],
};

const EXPRESSIVE_EYES = new Set(["idle", "happy"]);
const SHADED_EYES_SKINS = new Set(["cool"]);

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec4 uPlane;
  uniform float uUnit;
  uniform float uBreath;
  uniform float uSquash;
  uniform float uWobble;
  uniform float uLean;
  uniform float uHeadTilt;
  uniform vec2 uHeadShift;
  uniform float uEarL;
  uniform float uEarR;
  uniform float uArmL;
  uniform float uArmR;

  varying vec2 vUv;
  varying vec2 vSprite;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  vec2 rotateAround(vec2 p, vec2 pivot, float a) {
    vec2 d = p - pivot;
    float c = cos(a);
    float s = sin(a);
    return pivot + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  }

  void main() {
    vUv = uv;
    vec2 rest = vec2(uPlane.x + uv.x * uPlane.z, uPlane.y + (1.0 - uv.y) * uPlane.w);
    vSprite = rest;
    vec2 p = rest;

    // Ears bend progressively from their base so they flop rather than swing rigidly.
    float earBand = smoothstep(82.0, 66.0, rest.y);
    float earZoneL = earBand * (1.0 - smoothstep(92.0, 104.0, rest.x));
    float earZoneR = earBand * smoothstep(96.0, 108.0, rest.x);
    float bend = clamp((74.0 - rest.y) / 72.0, 0.0, 1.0);
    p = mix(p, rotateAround(p, vec2(${RIG.earPivotL.join(".0, ")}.0), uEarL * bend), earZoneL);
    p = mix(p, rotateAround(p, vec2(${RIG.earPivotR.join(".0, ")}.0), uEarR * bend), earZoneR);

    float armBand = smoothstep(198.0, 212.0, rest.y) * (1.0 - smoothstep(272.0, 286.0, rest.y));
    float armL = smoothstep(42.0, 28.0, rest.x) * armBand;
    float armR = smoothstep(158.0, 172.0, rest.x) * armBand;
    p = mix(p, rotateAround(p, vec2(${RIG.shoulderL.join(".0, ")}.0), uArmL), armL);
    p = mix(p, rotateAround(p, vec2(${RIG.shoulderR.join(".0, ")}.0), uArmR), armR);

    float head = 1.0 - smoothstep(184.0, 214.0, rest.y);
    vec2 headPose = rotateAround(p, vec2(${RIG.neck.join(".0, ")}.0), uHeadTilt) + uHeadShift;
    p = mix(p, headPose, head * (1.0 - max(armL, armR)));

    float height = clamp((314.0 - rest.y) / 314.0, 0.0, 1.3);
    float stretch = uBreath - uSquash;
    p.y = 314.0 + (p.y - 314.0) * (1.0 + stretch);
    p.x = 100.0 + (p.x - 100.0) * (1.0 - stretch * 0.6);
    p.x += uWobble * sin(height * 9.0 - uTime * 18.0) * 6.0 * height;
    p = rotateAround(p, vec2(${RIG.feet.join(".0, ")}.0), uLean * height);

    // Volume: a rounded torso, a domed face, ears set back and arms in front.
    float nx = clamp((rest.x - 100.0) / 92.0, -1.0, 1.0);
    float torso = sqrt(max(0.0, 1.0 - nx * nx));
    vec2 fd = (rest - vec2(100.0, 146.0)) / 56.0;
    float fr = dot(fd, fd);
    float inFace = step(fr, 1.0);
    float dome = sqrt(max(0.0, 1.0 - fr)) * inFace;
    float earZone = max(earZoneL, earZoneR);
    float armZone = max(armL, armR);
    float z = 16.0 * torso + 10.0 * dome;
    z = mix(z, 4.0 + 6.0 * torso, earZone);
    z = mix(z, 24.0, armZone);

    vec3 n = normalize(vec3(nx * 1.1 + fd.x * dome * 0.9, -fd.y * dome * 0.8 + 0.12, 1.0));
    n = normalize(mix(n, vec3(nx * 0.4, 0.2, 1.0), earZone));

    vec3 world = vec3((p.x - 100.0) * uUnit, (uPlane.y + uPlane.w - p.y) * uUnit, z * uUnit);
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    vNormal = normalize(normalMatrix * n);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform vec4 uPlane;
  uniform float uBlink;
  uniform float uEyes;
  uniform vec2 uLook;
  uniform vec3 uLightDir;
  uniform vec3 uRimColor;
  uniform float uRim;
  uniform float uShade;

  varying vec2 vUv;
  varying vec2 vSprite;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  vec2 spriteUv(vec2 s) {
    return vec2((s.x - uPlane.x) / uPlane.z, 1.0 - (s.y - uPlane.y) / uPlane.w);
  }

  vec4 eye(vec4 color, vec2 s, vec2 center, vec3 skin) {
    vec2 d = (s - center) / vec2(9.5, 11.5);
    float r = length(d);
    float mask = smoothstep(1.45, 1.05, r);
    if (mask <= 0.0) return color;

    vec4 looked = texture2D(map, spriteUv(s - uLook * vec2(3.2, 2.4)));
    color = mix(color, looked, mask);

    float inside = mask;
    float lidY = center.y - 12.0 + 24.0 * uBlink;
    float lid = (1.0 - smoothstep(lidY - 0.6, lidY + 0.6, s.y)) * inside * step(0.02, uBlink);
    color.rgb = mix(color.rgb, skin, lid);
    float lash = (1.0 - smoothstep(0.0, 1.7, abs(s.y - lidY))) * inside * smoothstep(0.1, 0.3, uBlink);
    color.rgb = mix(color.rgb, vec3(0.12, 0.1, 0.1), lash);
    return color;
  }

  void main() {
    vec4 color = texture2D(map, vUv);
    if (uEyes > 0.5) {
      vec3 skin = texture2D(map, spriteUv(vec2(${RIG.skinSample.join(".0, ")}.0))).rgb;
      color = eye(color, vSprite, vec2(${RIG.eyeL.join(".0, ")}.0), skin);
      color = eye(color, vSprite, vec2(${RIG.eyeR.join(".0, ")}.0), skin);
    }
    if (color.a < 0.03) discard;

    vec3 n = normalize(vNormal);
    float diffuse = max(dot(n, normalize(uLightDir)), 0.0);
    float rim = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 2.6);
    vec3 lit = color.rgb * (1.0 - uShade + uShade * 1.35 * diffuse) + uRimColor * rim * uRim;
    gl_FragColor = vec4(lit, color.a);
    #include <colorspace_fragment>
  }
`;

class Spring {
  constructor(stiffness, damping, value = 0) {
    this.k = stiffness;
    this.d = damping;
    this.value = value;
    this.velocity = 0;
    this.target = value;
  }

  step(dt) {
    const accel = -this.k * (this.value - this.target) - this.d * this.velocity;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  kick(impulse) {
    this.velocity += impulse;
  }
}

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const smooth = (t) => t * t * (3 - 2 * t);
const pulse = (progress) => Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI);

function layerImage(svgLayer, scale) {
  if (!svgLayer || !svgLayer.innerHTML.trim()) return Promise.resolve(null);
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${PLANE.x} ${PLANE.y} ${PLANE.w} ${PLANE.h}" ` +
    `width="${Math.round(PLANE.w * scale)}" height="${Math.round(PLANE.h * scale)}">${svgLayer.innerHTML}</svg>`;
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  }).finally(() => setTimeout(() => URL.revokeObjectURL(url), 0));
}

function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(30, 10, 60, 0.5)");
  gradient.addColorStop(0.6, "rgba(30, 10, 60, 0.18)");
  gradient.addColorStop(1, "rgba(30, 10, 60, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

const MOOD_POSE = {
  idle: { ears: 0.02, tilt: 0, breathAmp: 0.018, breathHz: 0.35, idleEvery: [3.5, 7], actions: ["wave", "earTwitch", "hop", "lookAround", "stretch", "curious"] },
  happy: { ears: -0.06, tilt: 0, breathAmp: 0.02, breathHz: 0.45, idleEvery: [2.5, 5], actions: ["hop", "wave", "earTwitch", "giggle", "curious"] },
  sad: { ears: 0.38, tilt: 0.05, breathAmp: 0.012, breathHz: 0.22, idleEvery: [6, 10], actions: ["sigh", "earTwitch"] },
  wrong: { ears: 0.25, tilt: -0.04, breathAmp: 0.015, breathHz: 0.3, idleEvery: [5, 8], actions: ["sigh"] },
  sleep: { ears: 0.5, tilt: 0.09, breathAmp: 0.035, breathHz: 0.16, idleEvery: [8, 14], actions: ["earTwitch"] },
};

export class Pet3D {
  constructor(sprite) {
    this.sprite = sprite;
    this.img = sprite.querySelector("img");
    this.layers = {
      under: sprite.querySelector(".pet-layer--under"),
      over: sprite.querySelector(".pet-layer--over"),
    };

    this.canvas = document.createElement("canvas");
    this.canvas.className = "pet-canvas";
    Object.assign(this.canvas.style, {
      left: `${(VIEW.x / 200) * 100}%`,
      top: `${(VIEW.y / 314) * 100}%`,
      width: `${(VIEW.w / 200) * 100}%`,
      height: `${(VIEW.h / 314) * 100}%`,
    });
    sprite.appendChild(this.canvas);

    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.scene = new THREE.Scene();

    const viewHeight = VIEW.h * UNIT;
    const distance = viewHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.camera = new THREE.PerspectiveCamera(FOV, VIEW.w / VIEW.h, 0.1, 100);
    this.camera.position.set(0, (PLANE.y + PLANE.h - (VIEW.y + VIEW.h / 2)) * UNIT, distance);

    this.composeCanvas = document.createElement("canvas");
    this.texture = new THREE.CanvasTexture(this.composeCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texScale = 0;

    this.uniforms = {
      map: { value: this.texture },
      uPlane: { value: new THREE.Vector4(PLANE.x, PLANE.y, PLANE.w, PLANE.h) },
      uUnit: { value: UNIT },
      uTime: { value: 0 },
      uBreath: { value: 0 },
      uSquash: { value: 0 },
      uWobble: { value: 0 },
      uLean: { value: 0 },
      uHeadTilt: { value: 0 },
      uHeadShift: { value: new THREE.Vector2() },
      uEarL: { value: 0 },
      uEarR: { value: 0 },
      uArmL: { value: 0 },
      uArmR: { value: 0 },
      uBlink: { value: 0 },
      uEyes: { value: 0 },
      uLook: { value: new THREE.Vector2() },
      uLightDir: { value: new THREE.Vector3(-0.45, 0.7, 0.8).normalize() },
      uRimColor: { value: new THREE.Color(0xfff1fb) },
      uRim: { value: 0.32 },
      uShade: { value: 0.22 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      alphaToCoverage: true,
    });
    this.body = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, SEGMENTS.x, SEGMENTS.y), material);
    this.body.frustumCulled = false;

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.45),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
    );
    this.shadow.position.set(0, (PLANE.y + PLANE.h - 318) * UNIT, -0.3);

    this.rig = new THREE.Group();
    this.rig.add(this.body);
    this.scene.add(this.shadow, this.rig);

    this.springs = {
      earL: new Spring(85, 5.5),
      earR: new Spring(85, 5.5),
      armL: new Spring(70, 10),
      armR: new Spring(70, 10),
      headTilt: new Spring(45, 9),
      headX: new Spring(40, 9),
      headY: new Spring(60, 10),
      lean: new Spring(30, 7),
      squash: new Spring(220, 10),
      jump: new Spring(55, 7),
      turn: new Spring(18, 7),
      pitch: new Spring(18, 7),
      shake: new Spring(260, 16),
      lookX: new Spring(120, 18),
      lookY: new Spring(120, 18),
    };
    this.wobble = 0;
    this.blink = { value: 0, start: 0, next: performance.now() + rand(1500, 3500), double: false };
    this.pointer = { x: 0, y: 0, at: 0 };
    this.glance = { x: 0, y: 0, until: 0 };
    this.mode = null;
    this.action = null;
    this.nextIdle = performance.now() + rand(2000, 4000);
    this.expression = "idle";

    this.observeSources();
    this.compose();
  }

  observeSources() {
    this.img.addEventListener("load", () => this.compose());
    this.layerObserver = new MutationObserver(() => this.compose());
    for (const layer of Object.values(this.layers)) {
      this.layerObserver.observe(layer, { childList: true, subtree: true, attributes: true });
    }
  }

  desiredTexScale() {
    const height = this.sprite.getBoundingClientRect().height || 192;
    return THREE.MathUtils.clamp(Math.ceil(((height * this.pixelRatio) / 314) * 1.15 * 2) / 2, 2, 3);
  }

  async compose() {
    const token = (this.composeToken = (this.composeToken ?? 0) + 1);
    const scale = this.desiredTexScale();
    const [under, over] = await Promise.all([layerImage(this.layers.under, scale), layerImage(this.layers.over, scale)]);
    if (token !== this.composeToken || !this.img.complete || !this.img.naturalWidth) return;

    const canvas = this.composeCanvas;
    const width = Math.round(PLANE.w * scale);
    const height = Math.round(PLANE.h * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      this.texture.dispose();
    }
    this.texScale = scale;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    if (under) ctx.drawImage(under, 0, 0, width, height);

    const boxW = 200 * scale;
    const boxH = 314 * scale;
    const fit = Math.min(boxW / this.img.naturalWidth, boxH / this.img.naturalHeight);
    const drawW = this.img.naturalWidth * fit;
    const drawH = this.img.naturalHeight * fit;
    ctx.drawImage(this.img, -PLANE.x * scale + (boxW - drawW) / 2, -PLANE.y * scale + (boxH - drawH), drawW, drawH);

    if (over) {
      ctx.save();
      if (this.layers.over.classList.contains("pet-glow")) {
        ctx.shadowColor = "rgba(253, 224, 71, 0.9)";
        ctx.shadowBlur = 12 * scale;
      }
      ctx.drawImage(over, 0, 0, width, height);
      ctx.restore();
    }
    this.texture.needsUpdate = true;

    const expression = this.img.getAttribute("src")?.match(/\/(\w+)\.png$/)?.[1] ?? "idle";
    if (expression !== this.expression) this.onExpression(expression);
    this.expression = expression;
    this.uniforms.uEyes.value = EXPRESSIVE_EYES.has(expression) && !SHADED_EYES_SKINS.has(this.sprite.dataset.skin) ? 1 : 0;
  }

  onExpression(expression) {
    if (expression === "happy") this.play("pet-squish");
    else if (expression === "wrong") this.play("pet-shake", 700);
    else if (expression === "sad") this.springs.squash.kick(-0.6);
  }

  syncSize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return false;
    if (this.canvas.width !== Math.round(width * this.pixelRatio) || this.canvas.height !== Math.round(height * this.pixelRatio)) {
      this.renderer.setSize(width, height, false);
      if (this.desiredTexScale() !== this.texScale) this.compose();
    }
    return true;
  }

  setPointer(clientX, clientY) {
    const rect = this.sprite.getBoundingClientRect();
    if (!rect.width) return;
    const eyeY = rect.top + rect.height * (RIG.eyeL[1] / 314);
    this.pointer.x = THREE.MathUtils.clamp((clientX - (rect.left + rect.width / 2)) / 350, -1, 1);
    this.pointer.y = THREE.MathUtils.clamp((clientY - eyeY) / 350, -1, 1);
    this.pointer.at = performance.now();
  }

  play(reaction, durationMs = 1000) {
    const now = performance.now();
    const s = this.springs;
    const until = durationMs > 0 ? now + durationMs : Infinity;
    switch (reaction) {
      case "pet-squish":
        s.squash.kick(3.4);
        s.jump.kick(2.4);
        s.earL.kick(-4);
        s.earR.kick(4);
        this.wobble = Math.max(this.wobble, 0.6);
        break;
      case "pet-jump":
        s.squash.kick(2.6);
        s.jump.kick(7);
        setTimeout(() => s.jump.kick(6), 520);
        this.setMode("cheer", until);
        break;
      default:
        this.setMode(reaction.replace("pet-", ""), until, now);
        if (reaction === "pet-dizzy") s.lean.kick(2.5);
    }
  }

  setMode(mode, until, start = performance.now()) {
    this.mode = { name: mode, start, until };
    this.action = null;
  }

  stop() {
    this.mode = null;
  }

  startIdleAction(now, mood) {
    const name = pick(mood.actions);
    const durations = { wave: 1700, earTwitch: 500, hop: 700, lookAround: 2200, stretch: 1500, curious: 1600, giggle: 900, sigh: 1400 };
    this.action = { name, start: now, duration: durations[name], side: Math.random() < 0.5 ? -1 : 1 };
    const s = this.springs;
    if (name === "earTwitch") (this.action.side < 0 ? s.earL : s.earR).kick(this.action.side * 7);
    if (name === "hop") {
      s.squash.kick(2.2);
      s.jump.kick(4.5);
    }
  }

  applyPose(now, t, mood) {
    const s = this.springs;
    const pose = { earL: -mood.ears, earR: mood.ears, armL: 0, armR: 0, tilt: mood.tilt, headX: 0, headY: 0, lean: 0, squash: 0, shake: 0 };

    const mode = this.mode?.name;
    const modeT = this.mode ? (now - this.mode.start) / 1000 : 0;
    switch (mode) {
      case "cheer":
        pose.armL = 1.0 + Math.sin(t * 16) * 0.12;
        pose.armR = -1.0 - Math.sin(t * 16) * 0.12;
        pose.earL -= 0.1;
        pose.earR += 0.1;
        break;
      case "shake":
        pose.tilt += Math.sin(modeT * 28) * 0.12;
        pose.headX = Math.sin(modeT * 28) * 5;
        pose.earL += 0.25;
        pose.earR -= 0.25;
        pose.armL = 0.25;
        pose.armR = -0.25;
        break;
      case "dizzy":
        pose.tilt += Math.sin(t * 7) * 0.22;
        pose.headX = Math.cos(t * 7) * 7;
        pose.headY = Math.sin(t * 7) * 3;
        pose.lean = Math.sin(t * 3.5) * 0.12;
        pose.earL = 0.4 + Math.sin(t * 7) * 0.5;
        pose.earR = -0.4 + Math.cos(t * 7) * 0.5;
        break;
      case "chomp":
        pose.headY = Math.max(0, Math.sin(t * 15)) * 4;
        pose.squash = Math.max(0, Math.sin(t * 15)) * 0.05;
        pose.armL = 0.55 + Math.sin(t * 15) * 0.08;
        pose.armR = -0.55 - Math.sin(t * 15) * 0.08;
        pose.earL += Math.sin(t * 15) * 0.12;
        pose.earR -= Math.sin(t * 15) * 0.12;
        break;
      case "wash":
        pose.lean = Math.sin(t * 11) * 0.09;
        pose.armL = 0.7 + Math.sin(t * 11) * 0.45;
        pose.armR = -0.7 + Math.sin(t * 11) * 0.45;
        pose.earL = -0.3 + Math.sin(t * 11 + 1) * 0.35;
        pose.earR = 0.3 + Math.sin(t * 11) * 0.35;
        this.wobble = Math.max(this.wobble, 0.3);
        break;
      case "think":
        pose.tilt += 0.16 + Math.sin(t * 3) * 0.04;
        pose.armR = -0.7 + Math.sin(t * 5) * 0.06;
        pose.headX = 3;
        pose.earL -= 0.15;
        this.glance = { x: -0.6, y: -0.8, until: now + 200, forced: true };
        break;
    }

    if (!mode && this.action) {
      const a = this.action;
      const p = (now - a.start) / a.duration;
      if (p >= 1) {
        this.action = null;
      } else {
        const env = pulse(p);
        switch (a.name) {
          case "wave": {
            const raise = smooth(Math.min(1, p * 4)) * smooth(Math.min(1, (1 - p) * 4));
            const swing = Math.sin(t * 13) * 0.28 * raise;
            if (a.side < 0) pose.armL = 1.05 * raise + swing;
            else pose.armR = -1.05 * raise - swing;
            pose.tilt += a.side * -0.06 * raise;
            break;
          }
          case "lookAround":
            this.glance = { x: p < 0.5 ? -0.9 : 0.9, y: -0.1, until: now + 150, forced: true };
            pose.headX = (p < 0.5 ? -4 : 4) * env;
            break;
          case "stretch":
            pose.armL = 1.15 * env;
            pose.armR = -1.15 * env;
            pose.squash = -0.06 * env;
            pose.earL -= 0.15 * env;
            pose.earR += 0.15 * env;
            break;
          case "curious":
            pose.tilt += a.side * 0.18 * env;
            pose.earL += a.side * 0.2 * env;
            pose.earR += a.side * 0.2 * env;
            break;
          case "giggle":
            pose.squash = Math.abs(Math.sin(t * 22)) * 0.04 * env;
            pose.headY = Math.sin(t * 22) * 1.5 * env;
            break;
          case "sigh":
            pose.squash = 0.05 * env;
            pose.headY = 4 * env;
            pose.earL += 0.15 * env;
            pose.earR -= 0.15 * env;
            break;
        }
      }
    }

    const look = this.lookTarget(now);
    pose.headX += look.x * 4;
    pose.headY += look.y * 2;
    pose.tilt += look.x * 0.04;

    s.earL.target = pose.earL - s.headTilt.velocity * 0.12 + s.jump.velocity * 0.03;
    s.earR.target = pose.earR - s.headTilt.velocity * 0.12 - s.jump.velocity * 0.03;
    s.armL.target = pose.armL;
    s.armR.target = pose.armR;
    s.headTilt.target = pose.tilt;
    s.headX.target = pose.headX;
    s.headY.target = pose.headY;
    s.lean.target = pose.lean;
    s.squash.target = pose.squash;
    s.lookX.target = look.x;
    s.lookY.target = look.y;
    s.turn.target = this.pointerActive(now) ? this.pointer.x * 0.5 : Math.sin(t * 0.4) * 0.12;
    s.pitch.target = this.pointerActive(now) ? this.pointer.y * 0.12 : 0;
  }

  pointerActive(now) {
    return now - this.pointer.at < 2500;
  }

  lookTarget(now) {
    if (this.glance.forced && this.glance.until > now) return this.glance;
    if (this.pointerActive(now)) return { x: this.pointer.x, y: this.pointer.y };
    if (this.glance.until > now) return this.glance;
    if (now > this.glance.until + rand(1500, 3500)) {
      this.glance = { x: rand(-0.8, 0.8), y: rand(-0.4, 0.4), until: now + rand(700, 1600) };
      return this.glance;
    }
    return { x: 0, y: 0 };
  }

  updateBlink(now) {
    const b = this.blink;
    const canBlink = this.uniforms.uEyes.value > 0.5;
    if (canBlink && now >= b.next && !b.start) b.start = now;
    if (b.start) {
      const p = (now - b.start) / 210;
      b.value = p < 0.45 ? smooth(p / 0.45) : p < 1 ? 1 - smooth((p - 0.45) / 0.55) : 0;
      if (p >= 1) {
        b.start = 0;
        b.double = !b.double && Math.random() < 0.25;
        b.next = now + (b.double ? 140 : rand(2200, 5500));
      }
    }
    if (this.mode?.name === "dizzy") b.value = 0.55;
    this.uniforms.uBlink.value = b.value;
  }

  update(now, dt) {
    if (!this.syncSize()) return;
    if (this.mode && now > this.mode.until) this.mode = null;

    const mood = MOOD_POSE[this.expression] ?? MOOD_POSE.idle;
    const t = now / 1000;
    if (!this.mode && !this.action && now > this.nextIdle) {
      this.startIdleAction(now, mood);
      this.nextIdle = now + rand(mood.idleEvery[0], mood.idleEvery[1]) * 1000;
    }

    this.applyPose(now, t, mood);
    for (const spring of Object.values(this.springs)) spring.step(dt);
    this.wobble = Math.max(0, this.wobble - dt * 0.9);
    this.updateBlink(now);

    const s = this.springs;
    const u = this.uniforms;
    const lift = Math.max(0, s.jump.value);
    u.uTime.value = t;
    u.uBreath.value = mood.breathAmp * Math.sin(t * Math.PI * 2 * mood.breathHz);
    u.uSquash.value = THREE.MathUtils.clamp(s.squash.value, -0.2, 0.28);
    u.uWobble.value = this.wobble + Math.min(0.5, Math.abs(s.squash.velocity) * 0.04);
    u.uLean.value = s.lean.value;
    u.uHeadTilt.value = s.headTilt.value;
    u.uHeadShift.value.set(s.headX.value, s.headY.value);
    u.uEarL.value = s.earL.value;
    u.uEarR.value = s.earR.value;
    u.uArmL.value = s.armL.value;
    u.uArmR.value = s.armR.value;
    u.uLook.value.set(THREE.MathUtils.clamp(s.lookX.value, -1, 1), THREE.MathUtils.clamp(s.lookY.value, -1, 1));

    this.rig.position.set(s.shake.value, lift * 0.9, 0);
    this.rig.rotation.set(s.pitch.value, s.turn.value, 0);
    const shadowScale = 1 / (1 + lift * 1.6);
    this.shadow.scale.set(shadowScale * (1 - u.uBreath.value * 2), shadowScale, 1);
    this.shadow.material.opacity = shadowScale;
    this.shadow.position.x = s.shake.value + s.turn.value * 0.1;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.layerObserver.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

const pets = new Set();
let running = false;
let last = 0;

function isVisible(element) {
  if (!element.isConnected || element.offsetParent === null) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
}

function loop(time) {
  const dt = Math.min(0.033, (time - last) / 1000 || 0.016);
  last = time;
  if (!document.hidden) {
    for (const pet of pets) {
      if (isVisible(pet.sprite)) pet.update(time, dt);
    }
  }
  requestAnimationFrame(loop);
}

export function supports3D() {
  if (!motionEnabled()) return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function attachPet3D(sprite) {
  if (sprite._pet3d) return sprite._pet3d;
  const pet = new Pet3D(sprite);
  sprite._pet3d = pet;
  sprite.classList.add("is-3d");
  pets.add(pet);
  if (!running) {
    running = true;
    window.addEventListener("pointermove", (e) => {
      for (const p of pets) p.setPointer(e.clientX, e.clientY);
    });
    requestAnimationFrame(loop);
  }
  return pet;
}
