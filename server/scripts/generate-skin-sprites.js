// Usage: node server/scripts/generate-skin-sprites.js
// Recolors only the purple fur of each character sprite, keeping face and ears intact.
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config/index.js";

const EXPRESSIONS = ["idle", "happy", "sad", "sleep", "wrong"];
const FUR_HUE = [225, 310];
const FUR_MIN_SATURATION = 0.08;

const TINTS = {
  sweet: { hue: 340, saturation: 1.15 },
  party: { hue: 190, saturation: 1.1 },
  dj: { hue: 145, saturation: 1.0 },
  ninja: { setSaturation: 0.06, lightness: 0.45 },
  wizard: { hue: 275, saturation: 1.6, lightness: 0.65 },
  royal: { hue: 45, setSaturation: 0.8, lightness: 0.95 },
  angel: { setSaturation: 0.05, lightness: 1.15 },
};

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

async function recolor(source, target, tint) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    if (h < FUR_HUE[0] || h > FUR_HUE[1] || s < FUR_MIN_SATURATION) continue;
    const nh = tint.hue ?? h;
    const ns = clamp01(tint.setSaturation ?? s * (tint.saturation ?? 1));
    const nl = clamp01(l * (tint.lightness ?? 1));
    const [r, g, b] = hslToRgb(nh, ns, nl);
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
  await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(target);
}

const assetDir = path.join(paths.publicRoot, "asset");

for (const [skin, tint] of Object.entries(TINTS)) {
  const dir = path.join(assetDir, "skins", skin);
  await fs.mkdir(dir, { recursive: true });
  for (const expression of EXPRESSIONS) {
    await recolor(path.join(assetDir, "char", `${expression}.png`), path.join(dir, `${expression}.png`), tint);
  }
  console.log(`generated ${skin}`);
}
