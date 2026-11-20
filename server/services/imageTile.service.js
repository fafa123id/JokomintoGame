import sharp from "sharp";

export const GRID = 3;
export const TILE_COUNT = GRID * GRID;
const TILE_PX = 240;
const MAX_INPUT_PIXELS = 40_000_000;
const CACHE_LIMIT = 300;

const cache = new Map();

// Cuts one square cell from the center-cropped image, so the client never holds pixels it hasn't unlocked.
export async function renderTile(filePath, index) {
  const key = `${filePath}#${index}`;
  if (cache.has(key)) return cache.get(key);
  const size = TILE_PX * GRID;
  const buffer = await sharp(filePath, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(size, size, { fit: "cover" })
    .extract({ left: (index % GRID) * TILE_PX, top: Math.floor(index / GRID) * TILE_PX, width: TILE_PX, height: TILE_PX })
    .webp({ quality: 80 })
    .toBuffer();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, buffer);
  return buffer;
}
