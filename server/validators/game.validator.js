import { rules } from "./rules.js";
import { FOODS, SOAPS } from "../config/game.js";

export const feedSchema = {
  food: rules.keyOf(FOODS, "Food"),
};

export const batheSchema = {
  soap: rules.keyOf(SOAPS, "Soap"),
};

export const startGameSchema = {
  type: rules.oneOf(["word", "image", "tictactoe", "chess", "memory", "simon"], "Game"),
};

export const sessionSchema = {
  sessionId: rules.uuid(),
};

export const moveSchema = {
  sessionId: rules.uuid(),
  cell: rules.integer({ min: 0, max: 8, label: "Cell" }),
};

const square = (label) => (value) =>
  typeof value === "string" && /^[a-h][1-8]$/.test(value) ? [value, null] : [undefined, `${label} isn't valid`];

export const chessMoveSchema = {
  sessionId: rules.uuid(),
  from: square("From"),
  to: square("To"),
  promotion: (value) =>
    value === undefined || ["q", "r", "b", "n"].includes(value) ? [value, null] : [undefined, "Promotion isn't valid"],
};

export const memoryFlipSchema = {
  sessionId: rules.uuid(),
  index: rules.integer({ min: 0, max: 15, label: "Card" }),
};

export const simonPressSchema = {
  sessionId: rules.uuid(),
  move: rules.integer({ min: 0, max: 3, label: "Move" }),
};

export const guessSchema = {
  sessionId: rules.uuid(),
  answer: rules.string({ max: 50, label: "Answer" }),
};
