import { Router } from "express";
import * as skins from "../controllers/skin.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { skinSchema } from "../validators/skin.validator.js";

const router = Router();

router.use(requireAuth);
router.get("/", skins.index);
router.post("/buy", validate(skinSchema), skins.buy);
router.post("/equip", validate(skinSchema), skins.equip);

export default router;
