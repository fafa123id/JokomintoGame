import sharp from "sharp";

const GRID = 3;
const SIZE = 96;
const TILE = SIZE / GRID;
const MAX_INPUT_PIXELS = 40_000_000;
// Keeps flat tiles (sky, walls) from counting as zero information.
const BASELINE = 0.02;

const CACHE_LIMIT = 500;
const cache = new Map();

const evenWeights = () => Array(GRID * GRID).fill(1 / (GRID * GRID));

// Share of visual detail (Sobel edge energy) per tile of a 3x3 grid, matching the
// square, center-cropped view the player sees. Returns 9 weights summing to 1.
export async function tileDetailWeights(filePath) {
  if (cache.has(filePath)) return cache.get(filePath);
  const weights = await computeWeights(filePath);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(filePath, weights);
  return weights;
}

async function computeWeights(filePath) {
  try {
    const { data } = await sharp(filePath, { limitInputPixels: MAX_INPUT_PIXELS })
      .resize(SIZE, SIZE, { fit: "cover" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const px = (x, y) => data[y * SIZE + x];
    const energy = Array(GRID * GRID).fill(0);

    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        const gx =
          -px(x - 1, y - 1) - 2 * px(x - 1, y) - px(x - 1, y + 1) +
          px(x + 1, y - 1) + 2 * px(x + 1, y) + px(x + 1, y + 1);
        const gy =
          -px(x - 1, y - 1) - 2 * px(x, y - 1) - px(x + 1, y - 1) +
          px(x - 1, y + 1) + 2 * px(x, y + 1) + px(x + 1, y + 1);
        const tile = Math.floor(y / TILE) * GRID + Math.floor(x / TILE);
        energy[tile] += Math.hypot(gx, gy);
      }
    }

    const total = energy.reduce((a, b) => a + b, 0);
    if (total === 0) return evenWeights();
    const smoothed = energy.map((e) => e / total + BASELINE);
    const sum = smoothed.reduce((a, b) => a + b, 0);
    return smoothed.map((w) => Math.round((w / sum) * 10_000) / 10_000);
  } catch {
    return evenWeights();
  }
}
