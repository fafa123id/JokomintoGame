import * as THREE from "/asset/vendor/three/three.module.min.js";

// Procedural PBR-ish surfaces drawn on canvas: a color map plus a height field that becomes a
// normal map. No image downloads; every map gets its own look from the theme colors.

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const shade = (hex, k, rand = 0) => {
  const [r, g, b] = rgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k + rand)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

function canvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

// Smooth tileable noise: random cells drawn small, then scaled up with smoothing.
function noiseLayer(ctx, size, cells, alpha, random, { light = 255, dark = 0 } = {}) {
  const small = canvas(cells);
  const s = small.getContext("2d");
  const img = s.createImageData(cells, cells);
  for (let i = 0; i < cells * cells; i++) {
    const v = random() < 0.5 ? dark : light;
    const k = random();
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = Math.round(k * 255);
  }
  s.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  // Draw 3x3 so the scaled edges wrap and the result tiles.
  const step = size;
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) ctx.drawImage(small, x * step, y * step, step, step);
  ctx.restore();
}

function speckle(ctx, size, count, color, random, max = 2) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const r = 0.5 + random() * max;
    ctx.globalAlpha = 0.15 + random() * 0.35;
    ctx.beginPath();
    ctx.arc(random() * size, random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Height canvas (grayscale) -> tangent-space normal map.
function normalFromHeight(height, strength) {
  const size = height.width;
  const src = height.getContext("2d").getImageData(0, 0, size, size).data;
  const out = canvas(size);
  const octx = out.getContext("2d");
  const img = octx.createImageData(size, size);
  const h = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127);
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function toTextures(color, height, { strength = 3, repeat = [1, 1] } = {}) {
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normalFromHeight(height, strength));
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.anisotropy = 4;
  }
  return { map, normalMap };
}

// ---------- surfaces ----------

function bricks(ctx, hctx, size, base, random, { rows = 16, cols = 8, mortar = 0xbdb5a6 } = {}) {
  ctx.fillStyle = shade(mortar, 1);
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = "#333";
  hctx.fillRect(0, 0, size, size);
  const bh = size / rows;
  const bw = size / cols;
  const gap = Math.max(2, size / 128);
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (bw / 2);
    for (let c = -1; c <= cols; c++) {
      const x = c * bw + offset;
      ctx.fillStyle = shade(base, 0.8 + random() * 0.4, (random() - 0.5) * 18);
      ctx.fillRect(x + gap / 2, r * bh + gap / 2, bw - gap, bh - gap);
      const v = Math.round(200 + random() * 40);
      hctx.fillStyle = `rgb(${v},${v},${v})`;
      hctx.fillRect(x + gap / 2, r * bh + gap / 2, bw - gap, bh - gap);
    }
  }
}

function planks(ctx, hctx, size, base, random, { count = 6, vertical = true } = {}) {
  const w = size / count;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = shade(base, 0.8 + random() * 0.35);
    hctx.fillStyle = "#c8c8c8";
    if (vertical) {
      ctx.fillRect(i * w, 0, w, size);
      hctx.fillRect(i * w, 0, w, size);
    } else {
      ctx.fillRect(0, i * w, size, w);
      hctx.fillRect(0, i * w, size, w);
    }
    // Grain lines.
    ctx.strokeStyle = shade(base, 0.6);
    ctx.globalAlpha = 0.25;
    for (let g = 0; g < 7; g++) {
      ctx.beginPath();
      const p = i * w + random() * w;
      if (vertical) {
        ctx.moveTo(p, 0);
        ctx.bezierCurveTo(p + random() * 6 - 3, size / 3, p + random() * 6 - 3, (size * 2) / 3, p, size);
      } else {
        ctx.moveTo(0, p);
        ctx.bezierCurveTo(size / 3, p + random() * 6 - 3, (size * 2) / 3, p + random() * 6 - 3, size, p);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Seams.
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    hctx.fillStyle = "#222";
    if (vertical) {
      ctx.fillRect(i * w, 0, 2, size);
      hctx.fillRect(i * w, 0, 3, size);
    } else {
      ctx.fillRect(0, i * w, size, 2);
      hctx.fillRect(0, i * w, size, 3);
    }
  }
}

function grime(ctx, size, random, strength = 0.35) {
  noiseLayer(ctx, size, 8, strength * 0.6, random, { light: 255, dark: 0 });
  noiseLayer(ctx, size, 32, strength * 0.35, random, { light: 230, dark: 20 });
  speckle(ctx, size, size * 1.5, "rgba(0,0,0,1)", random, 1.2);
}

// Wall panel: 3 m wide by 4 m tall, with a concrete baseboard and dirt near the floor.
export function wallTexture(style, color, size, seed = 1) {
  const random = rng(seed);
  const c = canvas(size);
  const h = canvas(size);
  const ctx = c.getContext("2d");
  const hctx = h.getContext("2d");
  if (style === "brick") bricks(ctx, hctx, size, color, random, { rows: 20, cols: 6 });
  else if (style === "planks") planks(ctx, hctx, size, color, random, { count: 7 });
  else {
    // Plaster or concrete: flat paint with panels and chips.
    ctx.fillStyle = shade(color, 1);
    ctx.fillRect(0, 0, size, size);
    hctx.fillStyle = "#999";
    hctx.fillRect(0, 0, size, size);
    noiseLayer(hctx, size, 64, 0.25, random);
    if (style === "concrete") {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      hctx.strokeStyle = "#444";
      ctx.lineWidth = hctx.lineWidth = 3;
      for (const k of [0.5]) {
        ctx.beginPath();
        ctx.moveTo(size * k, 0);
        ctx.lineTo(size * k, size);
        ctx.stroke();
        hctx.beginPath();
        hctx.moveTo(size * k, 0);
        hctx.lineTo(size * k, size);
        hctx.stroke();
      }
      // Form-tie holes.
      for (let y = 0.2; y < 0.9; y += 0.3) {
        for (const x of [0.25, 0.75]) {
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.beginPath();
          ctx.arc(size * x, size * y, size / 90, 0, Math.PI * 2);
          ctx.fill();
          hctx.fillStyle = "#222";
          hctx.beginPath();
          hctx.arc(size * x, size * y, size / 80, 0, Math.PI * 2);
          hctx.fill();
        }
      }
    } else {
      // Chipped plaster showing brick underneath.
      for (let i = 0; i < 5; i++) {
        const x = random() * size;
        const y = random() * size * 0.8;
        const w = size * (0.05 + random() * 0.1);
        ctx.fillStyle = shade(0xa0522d, 0.8 + random() * 0.2);
        ctx.beginPath();
        ctx.ellipse(x, y, w, w * 0.6, random() * 3, 0, Math.PI * 2);
        ctx.fill();
        hctx.fillStyle = "#555";
        hctx.beginPath();
        hctx.ellipse(x, y, w, w * 0.6, 0, 0, Math.PI * 2);
        hctx.fill();
      }
    }
  }
  grime(ctx, size, random, 0.3);
  // Dirt rising from the floor and a baseboard (bottom of the texture is the floor side).
  const dirt = ctx.createLinearGradient(0, size, 0, size * 0.55);
  dirt.addColorStop(0, "rgba(40,30,20,0.55)");
  dirt.addColorStop(1, "rgba(40,30,20,0)");
  ctx.fillStyle = dirt;
  ctx.fillRect(0, 0, size, size);
  const board = size * 0.07;
  ctx.fillStyle = "#5b5650";
  ctx.fillRect(0, size - board, size, board);
  noiseLayer(ctx, size, 48, 0.2, random);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, size - board, size, 3);
  hctx.fillStyle = "#e0e0e0";
  hctx.fillRect(0, size - board, size, board);
  // Top trim.
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 0, size, size * 0.02);
  return toTextures(c, h, { strength: 4 });
}

export function floorTexture(style, color, size, seed = 2) {
  const random = rng(seed);
  const c = canvas(size);
  const h = canvas(size);
  const ctx = c.getContext("2d");
  const hctx = h.getContext("2d");
  ctx.fillStyle = shade(color, 1);
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = "#888";
  hctx.fillRect(0, 0, size, size);
  if (style === "tiles" || style === "pavers") {
    const n = style === "tiles" ? 4 : 6;
    const t = size / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const off = style === "pavers" && y % 2 ? t / 2 : 0;
        ctx.fillStyle = shade(color, 0.85 + random() * 0.25);
        hctx.fillStyle = "#bbb";
        for (const dx of [0, size]) {
          ctx.fillRect(x * t + off + 2 - dx, y * t + 2, t - 4, t - 4);
          hctx.fillRect(x * t + off + 2 - dx, y * t + 2, t - 4, t - 4);
        }
      }
    }
  } else if (style === "concrete") {
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 3;
    hctx.strokeStyle = "#333";
    hctx.lineWidth = 3;
    for (const k of [0, 0.5]) {
      for (const g of [ctx, hctx]) {
        g.beginPath();
        g.moveTo(size * k, 0);
        g.lineTo(size * k, size);
        g.moveTo(0, size * k);
        g.lineTo(size, size * k);
        g.stroke();
      }
    }
  }
  noiseLayer(hctx, size, style === "sand" ? 128 : 48, style === "sand" ? 0.5 : 0.2, random);
  grime(ctx, size, random, style === "sand" || style === "dirt" ? 0.5 : 0.3);
  if (style === "sand" || style === "dirt") speckle(ctx, size, size * 6, style === "sand" ? "rgba(255,255,240,1)" : "rgba(60,40,20,1)", random, 1);
  return toTextures(c, h, { strength: style === "sand" ? 2 : 3 });
}

// Cover blocks: wooden crates, metal containers or sandbag walls.
export function coverTexture(style, color, size, seed = 3) {
  const random = rng(seed);
  const c = canvas(size);
  const h = canvas(size);
  const ctx = c.getContext("2d");
  const hctx = h.getContext("2d");
  if (style === "metal") {
    const ribs = 12;
    for (let i = 0; i < ribs; i++) {
      const x = (i / ribs) * size;
      const grad = ctx.createLinearGradient(x, 0, x + size / ribs, 0);
      grad.addColorStop(0, shade(color, 0.7));
      grad.addColorStop(0.5, shade(color, 1.1));
      grad.addColorStop(1, shade(color, 0.7));
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, size / ribs, size);
      const hg = hctx.createLinearGradient(x, 0, x + size / ribs, 0);
      hg.addColorStop(0, "#444");
      hg.addColorStop(0.5, "#ddd");
      hg.addColorStop(1, "#444");
      hctx.fillStyle = hg;
      hctx.fillRect(x, 0, size / ribs, size);
    }
    // Rust and scratches.
    noiseLayer(ctx, size, 16, 0.25, random, { light: 160, dark: 90 });
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    for (let i = 0; i < 30; i++) {
      ctx.beginPath();
      const x = random() * size;
      const y = random() * size;
      ctx.moveTo(x, y);
      ctx.lineTo(x + random() * 40 - 20, y + random() * 10);
      ctx.stroke();
    }
  } else {
    planks(ctx, hctx, size, color, random, { count: 5, vertical: false });
    // Crate frame and diagonal brace.
    const f = size * 0.09;
    ctx.fillStyle = shade(color, 0.75);
    hctx.fillStyle = "#fff";
    for (const [x, y, w, hh] of [[0, 0, size, f], [0, size - f, size, f], [0, 0, f, size], [size - f, 0, f, size]]) {
      ctx.fillRect(x, y, w, hh);
      hctx.fillRect(x, y, w, hh);
    }
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-size * 0.7, -f / 2, size * 1.4, f);
    hctx.save();
    hctx.translate(size / 2, size / 2);
    hctx.rotate(Math.PI / 4);
    hctx.fillRect(-size * 0.7, -f / 2, size * 1.4, f);
    hctx.restore();
    ctx.restore();
    // Nails.
    ctx.fillStyle = "#3f3f46";
    for (const [x, y] of [[f / 2, f / 2], [size - f / 2, f / 2], [f / 2, size - f / 2], [size - f / 2, size - f / 2]]) {
      ctx.beginPath();
      ctx.arc(x, y, size / 120, 0, Math.PI * 2);
      ctx.fill();
    }
    // Stencil.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#111";
    ctx.font = `bold ${Math.round(size / 9)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("JKM-05", size / 2, size * 0.56);
    ctx.globalAlpha = 1;
  }
  grime(ctx, size, random, 0.3);
  return toTextures(c, h, { strength: 3 });
}

// Painted site letter and border for the floor.
export function siteDecal(letter, color) {
  const c = canvas(256);
  const ctx = c.getContext("2d");
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 14;
  ctx.strokeRect(12, 12, 232, 232);
  ctx.font = "bold 190px Impact, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(letter, 128, 140);
  // Worn paint.
  ctx.globalCompositeOperation = "destination-out";
  const random = rng(letter.charCodeAt(0));
  for (let i = 0; i < 400; i++) {
    ctx.globalAlpha = random() * 0.6;
    ctx.fillRect(random() * 256, random() * 256, 2 + random() * 6, 2 + random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft darkening where the floor meets walls (fake ambient occlusion), one pixel group per cell.
export function floorOcclusion(map, solid) {
  const px = 16;
  const c = canvas(map.width * px);
  c.height = map.height * px;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.filter = `blur(${px * 0.45}px)`;
  ctx.fillStyle = "#3a3a3a";
  for (let z = 0; z < map.height; z++) for (let x = 0; x < map.width; x++) if (solid(x, z)) ctx.fillRect(x * px - 3, z * px - 3, px + 6, px + 6);
  ctx.filter = "none";
  const t = new THREE.CanvasTexture(c);

  return t;
}

// Bullet hole: dark center, cracked rim.
export function bulletHoleTexture() {
  const c = canvas(64);
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, "rgba(0,0,0,0.95)");
  g.addColorStop(0.25, "rgba(20,18,15,0.9)");
  g.addColorStop(0.5, "rgba(60,55,50,0.45)");
  g.addColorStop(1, "rgba(60,55,50,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.random();
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    ctx.lineTo(32 + Math.cos(a) * (14 + Math.random() * 10), 32 + Math.sin(a) * (14 + Math.random() * 10));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
