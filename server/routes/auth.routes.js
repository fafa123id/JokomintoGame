import { Router } from "express";
import * as auth from "../controllers/auth.controller.js";
import { optionalAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { authLimiter, guestLimiter } from "../middlewares/security.js";
import { guestSchema, registerSchema, loginSchema, googleLoginSchema } from "../validators/auth.validator.js";

const router = Router();

router.get("/config", auth.getConfig);
router.get("/me", optionalAuth, auth.me);
router.post("/guest", guestLimiter, optionalAuth, validate(guestSchema), auth.guest);
router.post("/register", authLimiter, optionalAuth, validate(registerSchema), auth.register);
router.post("/login", authLimiter, optionalAuth, validate(loginSchema), auth.login);
router.post("/google", authLimiter, optionalAuth, validate(googleLoginSchema), auth.google);
router.post("/logout", optionalAuth, auth.logout);

export default router;
