import { rules } from "./rules.js";
import { UID_PATTERN } from "../utils/uid.js";

const uid = (value) => {
  const clean = typeof value === "string" ? value.trim().toUpperCase().replace(/[\s-]/g, "") : "";
  return UID_PATTERN.test(clean) ? [clean, null] : [undefined, "Player ID must be 8 characters"];
};
const optional = (rule) => (value) => (value === undefined || value === null || value === "" ? [undefined, null] : rule(value));
const bool = (label) => (value) => (typeof value === "boolean" ? [value, null] : [undefined, `${label} isn't valid`]);
const userId = rules.integer({ min: 1, max: Number.MAX_SAFE_INTEGER, label: "Player" });
const gameType = rules.oneOf(["tictactoe", "chess"], "Game");

export const friendRequestSchema = { uid: optional(uid), userId: optional(userId) };
export const friendRespondSchema = { userId, accept: bool("Answer") };
export const friendRemoveSchema = { userId };

export const inviteSchema = { type: gameType, friendId: optional(userId), uid: optional(uid) };
export const inviteRespondSchema = { inviteId: rules.uuid("Invite"), accept: bool("Answer") };
export const inviteCancelSchema = { inviteId: rules.uuid("Invite") };
export const queueSchema = { type: gameType };

const square = (label) => (value) =>
  typeof value === "string" && /^[a-h][1-8]$/.test(value) ? [value, null] : [undefined, `${label} isn't valid`];
export const matchMoveSchema = {
  cell: optional(rules.integer({ min: 0, max: 8, label: "Cell" })),
  from: optional(square("From")),
  to: optional(square("To")),
  promotion: (value) =>
    value === undefined || ["q", "r", "b", "n"].includes(value) ? [value, null] : [undefined, "Promotion isn't valid"],
};
