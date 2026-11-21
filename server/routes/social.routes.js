import { Router } from "express";
import * as social from "../controllers/social.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import {
  friendRequestSchema,
  friendRespondSchema,
  friendRemoveSchema,
  inviteSchema,
  inviteRespondSchema,
  inviteCancelSchema,
  queueSchema,
  matchMoveSchema,
  presencePingSchema,
} from "../validators/social.validator.js";

const MATCH_ID = /^[0-9a-f-]{36}$/i;

export const eventRoutes = Router()
  .get("/", requireAuth, social.events)
  .post("/ping", requireAuth, validate(presencePingSchema), social.presencePing);

export const friendRoutes = Router()
  .use(requireAuth)
  .get("/", social.listFriends)
  .post("/request", validate(friendRequestSchema), social.requestFriend)
  .post("/respond", validate(friendRespondSchema), social.respondFriend)
  .post("/remove", validate(friendRemoveSchema), social.removeFriend);

const matchRoutes = Router();
matchRoutes.use(requireAuth);
matchRoutes.param("id", (req, res, next, id) => (MATCH_ID.test(id) ? next() : next("route")));
matchRoutes.get("/current", social.current);
matchRoutes.post("/invite", validate(inviteSchema), social.invite);
matchRoutes.post("/invite/respond", validate(inviteRespondSchema), social.respondInvite);
matchRoutes.post("/invite/cancel", validate(inviteCancelSchema), social.cancelInvite);
matchRoutes.post("/queue", validate(queueSchema), social.joinQueue);
matchRoutes.post("/queue/leave", social.leaveQueue);
matchRoutes.get("/:id", social.show);
matchRoutes.post("/:id/move", validate(matchMoveSchema), social.move);
matchRoutes.post("/:id/resign", social.resign);

export { matchRoutes };
