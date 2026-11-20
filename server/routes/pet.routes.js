import { Router } from "express";
import * as pet from "../controllers/pet.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { feedSchema, batheSchema } from "../validators/game.validator.js";

const router = Router();

router.use(requireAuth);
router.get("/", pet.show);
router.post("/feed", validate(feedSchema), pet.feed);
router.post("/bathe", validate(batheSchema), pet.bathe);
router.post("/stroke", pet.stroke);

export default router;
