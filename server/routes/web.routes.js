import express, { Router } from "express";
import path from "node:path";
import config, { paths } from "../config/index.js";

const router = Router();
const publicFile = (...segments) => path.join(paths.publicRoot, ...segments);

// Code must always be revalidated: a cached old module mixed with new ones breaks the app after a deploy.
// ETags keep revalidation cheap (304). Media rarely changes and can be cached longer.
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

router.use("/src", express.static(publicFile("src"), staticOptions));
router.use("/asset", express.static(publicFile("asset"), staticOptions));
router.get("/", sendCode("index.html"));
router.get("/index.js", sendCode("index.js"));
// The worker's own requests follow this policy: it may only refresh the app and its style/font CDNs.
const SW_CSP = "default-src 'none'; connect-src 'self' https://cdn.tailwindcss.com https://fonts.googleapis.com https://fonts.gstatic.com";
router.get("/sw.js", (req, res, next) => {
  res.setHeader("Content-Security-Policy", SW_CSP);
  sendCode("sw.js")(req, res, next);
});
router.get("/favicon.ico", (req, res) => res.sendFile(publicFile("asset", "icon.png")));
router.get("/healthz", (req, res) => res.json({ ok: true }));

export default router;
