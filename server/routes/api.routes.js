import { Router } from "express";
import { apiLimiter, csrfGuard } from "../middlewares/security.js";
import { notFound } from "../middlewares/errorHandler.js";
import authRoutes from "./auth.routes.js";
import petRoutes from "./pet.routes.js";
import gameRoutes from "./game.routes.js";
import leaderboardRoutes from "./leaderboard.routes.js";
import skinRoutes from "./skin.routes.js";

const router = Router();

router.use(apiLimiter, csrfGuard);
router.use("/auth", authRoutes);
router.use("/pet", petRoutes);
router.use("/game", gameRoutes);
router.use("/leaderboard", leaderboardRoutes);
router.use("/skins", skinRoutes);
router.use(notFound);

export default router;
