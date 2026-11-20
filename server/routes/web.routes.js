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
router.get("/sw.js", sendCode("sw.js"));
router.get("/favicon.ico", (req, res) => res.sendFile(publicFile("asset", "icon.png")));
router.get("/healthz", (req, res) => res.json({ ok: true }));

export default router;
