import { Router } from "express";
import * as push from "../controllers/push.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { subscribeSchema, unsubscribeSchema } from "../validators/push.validator.js";

const router = Router();

router.get("/key", push.key);
router.post("/subscribe", requireAuth, validate(subscribeSchema), push.subscribe);
router.post("/unsubscribe", requireAuth, validate(unsubscribeSchema), push.unsubscribe);

export default router;
