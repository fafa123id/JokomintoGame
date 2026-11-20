import { Router } from "express";
import * as game from "../controllers/game.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { startGameSchema, sessionSchema, guessSchema, moveSchema, chessMoveSchema, memoryFlipSchema, simonPressSchema } from "../validators/game.validator.js";

const router = Router();

router.use(requireAuth);
router.post("/start", validate(startGameSchema), game.start);
router.post("/hint", validate(sessionSchema), game.hint);
router.post("/guess", validate(guessSchema), game.guess);
router.post("/move", validate(moveSchema), game.move);
router.post("/chess/move", validate(chessMoveSchema), game.chessMove);
router.post("/memory/flip", validate(memoryFlipSchema), game.memoryFlip);
router.post("/simon/press", validate(simonPressSchema), game.simonPress);
router.post("/end", validate(sessionSchema), game.end);
router.get("/image/:id/tile/:index", game.imageTile);

export default router;
