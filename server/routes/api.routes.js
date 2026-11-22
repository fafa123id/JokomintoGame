import { Router } from "express";
import { apiLimiter, gameLimiter, csrfGuard } from "../middlewares/security.js";
import { notFound } from "../middlewares/errorHandler.js";
import authRoutes from "./auth.routes.js";
import petRoutes from "./pet.routes.js";
import gameRoutes from "./game.routes.js";
import leaderboardRoutes from "./leaderboard.routes.js";
import skinRoutes from "./skin.routes.js";
import pushRoutes from "./push.routes.js";
import { eventRoutes, friendRoutes, matchRoutes, fpsRoutes } from "./social.routes.js";

const router = Router();

const isGameplay = (path) => path.startsWith("/game/") || path.startsWith("/match/");
router.use((req, res, next) => (isGameplay(req.path) ? gameLimiter : apiLimiter)(req, res, next));
router.use(csrfGuard);
router.use("/auth", authRoutes);
router.use("/pet", petRoutes);
router.use("/game", gameRoutes);
router.use("/leaderboard", leaderboardRoutes);
router.use("/skins", skinRoutes);
router.use("/push", pushRoutes);
router.use("/events", eventRoutes);
router.use("/friends", friendRoutes);
router.use("/match", matchRoutes);
router.use("/fps", fpsRoutes);
router.use(notFound);

export default router;
