import { rules } from "./rules.js";
import { FOODS, SOAPS } from "../config/game.js";

export const feedSchema = {
  food: rules.keyOf(FOODS, "Food"),
};

export const batheSchema = {
  soap: rules.keyOf(SOAPS, "Soap"),
};

export const startGameSchema = {
  type: rules.oneOf(["word", "image", "tictactoe"], "Game"),
};

export const sessionSchema = {
  sessionId: rules.uuid(),
};

export const moveSchema = {
  sessionId: rules.uuid(),
  cell: rules.integer({ min: 0, max: 8, label: "Cell" }),
};

export const guessSchema = {
  sessionId: rules.uuid(),
  answer: rules.string({ max: 50, label: "Answer" }),
};
