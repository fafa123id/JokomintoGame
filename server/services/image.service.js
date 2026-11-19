import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import config, { paths } from "../config/index.js";
import { IMAGES, IMAGE_WORDS, IMAGE_REVEAL_TILES } from "../config/game.js";

const PIXABAY_API = "https://pixabay.com/api/";
const ALLOWED_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const SOURCES = { local: paths.gameImages, cache: paths.imageCache };

const searchCache = new Map();

function randomTiles(count, total = 9) {
  const tiles = new Set();
  while (tiles.size < count) tiles.add(crypto.randomInt(total));
  return [...tiles];
}

function isPixabayHost(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "pixabay.com" || hostname.endsWith(".pixabay.com"));
  } catch {
    return false;
  }
}

async function searchPixabay(word) {
  const cached = searchCache.get(word);
  if (cached && cached.expiresAt > Date.now()) return cached.hits;

  const url = new URL(PIXABAY_API);
  url.search = new URLSearchParams({
    key: config.pixabay.apiKey,
    q: word,
    lang: "en",
    image_type: "photo",
    safesearch: "true",
    per_page: "50",
  });

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Pixabay search failed (${res.status})`);
  const { hits = [] } = await res.json();

  // Keep only photos whose tags actually contain the word, so the label stays accurate.
  const relevant = hits
    .filter((h) => typeof h.tags === "string" && h.tags.split(",").some((t) => t.trim().toLowerCase() === word))
    .filter((h) => Number.isInteger(h.id) && isPixabayHost(h.webformatURL))
    .map((h) => ({ id: h.id, url: h.webformatURL }));

  searchCache.set(word, { hits: relevant, expiresAt: Date.now() + config.pixabay.searchCacheMs });
  return relevant;
}

async function pruneCache() {
  const files = await fs.readdir(paths.imageCache).catch(() => []);
  const excess = files.length - config.pixabay.maxCachedImages;
  if (excess <= 0) return;
  const stats = await Promise.all(
    files.map(async (f) => ({ f, mtime: (await fs.stat(path.join(paths.imageCache, f))).mtimeMs }))
  );
  stats.sort((a, b) => a.mtime - b.mtime);
  await Promise.all(stats.slice(0, excess).map(({ f }) => fs.rm(path.join(paths.imageCache, f), { force: true })));
}

async function download(hit) {
  await fs.mkdir(paths.imageCache, { recursive: true });
  for (const ext of Object.values(ALLOWED_TYPES)) {
    const name = `pixabay-${hit.id}${ext}`;
    if (await fs.stat(path.join(paths.imageCache, name)).catch(() => null)) return name;
  }

  const res = await fetch(hit.url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
  if (!res.ok || !isPixabayHost(res.url)) throw new Error("Image download failed");

  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  const ext = ALLOWED_TYPES[type];
  if (!ext) throw new Error(`Unexpected content type: ${type}`);

  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > config.pixabay.maxImageBytes) throw new Error("Image too large");
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > config.pixabay.maxImageBytes) throw new Error("Image too large");

  const name = `pixabay-${hit.id}${ext}`;
  const tmp = path.join(paths.imageCache, `${name}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmp, buffer);
  await fs.rename(tmp, path.join(paths.imageCache, name));
  pruneCache().catch(() => {});
  return name;
}

async function fromPixabay() {
  const word = IMAGE_WORDS[crypto.randomInt(IMAGE_WORDS.length)];
  const hits = await searchPixabay(word);
  if (hits.length === 0) throw new Error(`No Pixabay results for "${word}"`);
  const file = await download(hits[crypto.randomInt(hits.length)]);
  return { answer: word, imageFile: `cache/${file}`, revealed: randomTiles(IMAGE_REVEAL_TILES) };
}

function fromLocal() {
  const image = IMAGES[crypto.randomInt(IMAGES.length)];
  return { answer: image.answer, imageFile: `local/${image.file}`, revealed: [...image.revealPattern] };
}

export async function pickImagePuzzle() {
  if (!config.pixabay.apiKey) return fromLocal();
  try {
    return await fromPixabay();
  } catch (err) {
    if (!config.isTest) console.warn(`[image] falling back to local images: ${err.message}`);
    return fromLocal();
  }
}

export function resolveImageFile(imageFile) {
  const value = String(imageFile);
  if (!value.includes("/")) return path.join(paths.gameImages, path.basename(value));
  const [source, ...rest] = value.split("/");
  const dir = SOURCES[source];
  if (!dir || rest.length !== 1) return null;
  return path.join(dir, path.basename(rest[0]));
}

export function imageCredit(imageFile) {
  return String(imageFile).startsWith("cache/") ? { name: "Pixabay", url: "https://pixabay.com/" } : null;
}
