import express, { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import config, { paths } from "../config/index.js";

const router = Router();
const publicFile = (...segments) => path.join(paths.publicRoot, ...segments);

// Code is served under /v/<build>/... so every deploy gets brand-new URLs: browsers and CDNs
// (Cloudflare rewrites cache headers on .js) can never mix modules from two releases.
// The build id is a hash of the shipped front-end files; in development it never caches.
const CODE_ROOTS = ["index.js", "src", "asset/vendor"];

function listFiles(target) {
  const full = publicFile(target);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [target];
  return fs
    .readdirSync(full, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.posix.join(target, entry.name)))
    .sort();
}

function computeBuild() {
  const hash = crypto.createHash("sha256");
  for (const file of [...CODE_ROOTS.flatMap(listFiles), "index.html"]) {
    hash.update(file);
    hash.update(fs.readFileSync(publicFile(file)));
  }
  return hash.digest("hex").slice(0, 12);
}

export const BUILD = config.isProd ? computeBuild() : "dev";

let cachedHtml = null;
function indexHtml() {
  if (cachedHtml && config.isProd) return cachedHtml;
  cachedHtml = fs.readFileSync(publicFile("index.html"), "utf8").replaceAll("__BUILD__", BUILD);
  return cachedHtml;
}

// Unversioned paths stay available (no-cache) for pages and workers from older releases.
const CODE_FILE = /\.(js|mjs|css|html|json|webmanifest)$/i;

function setCacheHeaders(res, filePath) {
  if (CODE_FILE.test(filePath)) res.setHeader("Cache-Control", "no-cache");
  else res.setHeader("Cache-Control", config.isProd ? "public, max-age=86400" : "no-cache");
}

const staticOptions = { index: false, dotfiles: "deny", etag: true, lastModified: true, setHeaders: setCacheHeaders };
const sendCode = (file) => (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(publicFile(file));
};

const VERSIONED = /^\/v\/([a-z0-9]{1,32})\/((?:index\.js)|(?:src|asset\/vendor)\/[\w./-]+)$/i;

router.get(VERSIONED, (req, res, next) => {
  const [, build, file] = req.path.match(VERSIONED);
  if (file.split("/").includes("..")) return next();
  // Only the current build is immutable; an old build id gets today's file, revalidated every time.
  const current = build === BUILD && config.isProd;
  res.setHeader("Cache-Control", current ? "public, max-age=31536000, immutable" : "no-cache");
  res.sendFile(file, { root: paths.publicRoot, dotfiles: "deny" }, (err) => err && next());
});

router.use("/src", express.static(publicFile("src"), staticOptions));
router.use("/asset", express.static(publicFile("asset"), staticOptions));
router.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(indexHtml());
});
router.get("/index.js", sendCode("index.js"));
// The worker's own requests follow this policy: it may only refresh the app and its font CDN.
const SW_CSP = "default-src 'none'; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com";
router.get("/sw.js", (req, res, next) => {
  res.setHeader("Content-Security-Policy", SW_CSP);
  sendCode("sw.js")(req, res, next);
});
router.get("/favicon.ico", (req, res) => res.sendFile(publicFile("asset", "icon.png")));
router.get("/healthz", (req, res) => res.json({ ok: true, build: BUILD }));

export default router;
