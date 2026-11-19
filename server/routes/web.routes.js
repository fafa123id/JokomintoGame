import express, { Router } from "express";
import path from "node:path";
import config, { paths } from "../config/index.js";

const router = Router();
const staticOptions = { maxAge: config.isProd ? "1h" : 0, index: false, dotfiles: "deny" };
const publicFile = (...segments) => path.join(paths.publicRoot, ...segments);

router.use("/src", express.static(publicFile("src"), staticOptions));
router.use("/asset", express.static(publicFile("asset"), staticOptions));
router.get("/", (req, res) => res.sendFile(publicFile("index.html")));
router.get("/index.js", (req, res) => res.sendFile(publicFile("index.js")));
router.get("/favicon.ico", (req, res) => res.sendFile(publicFile("asset", "icon.png")));
router.get("/healthz", (req, res) => res.json({ ok: true }));

export default router;
