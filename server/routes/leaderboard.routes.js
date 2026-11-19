import { Router } from "express";
import * as leaderboard from "../controllers/leaderboard.controller.js";
import { optionalAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/", optionalAuth, leaderboard.index);

export default router;
