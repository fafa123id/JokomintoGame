import { test } from "node:test";
import assert from "node:assert/strict";
import { wordDifficulty, imageDifficulty, finalScore } from "../server/services/scoring.service.js";
import { tileDetailWeights } from "../server/services/imageAnalysis.service.js";
import { SCORE } from "../server/config/game.js";

const EVEN = Array(9).fill(1 / 9);

test("word base stays within bounds", () => {
  for (const word of ["a", "eeeee", "apple", "jazzy", "quizzical", "zzzzzzzzzzzzzz"]) {
    const { base } = wordDifficulty(word, []);
    assert.ok(base >= SCORE.minBase && base <= SCORE.maxBase, `${word}: ${base}`);
  }
});

test("rare hidden letters make a word harder", () => {
  const easy = wordDifficulty("eaten", [0]);
  const hard = wordDifficulty("jazzy", [0]);
  assert.ok(hard.base > easy.base, `${hard.base} > ${easy.base}`);
});

test("revealing letters lowers word difficulty", () => {
  const hidden = wordDifficulty("quick", [0]);
  const mostlyShown = wordDifficulty("quick", [0, 1, 2, 4]);
  assert.ok(mostlyShown.factors.rarity <= hidden.factors.rarity);
});

test("image base drops as more detail is revealed", () => {
  const weights = [0.02, 0.02, 0.02, 0.02, 0.84, 0.02, 0.02, 0.02, 0.02];
  const corner = imageDifficulty(weights, [0]);
  const center = imageDifficulty(weights, [4]);
  assert.ok(corner.base > center.base, `${corner.base} > ${center.base}`);
  assert.ok(imageDifficulty(EVEN, [0, 1, 2, 3, 4, 5, 6, 7, 8]).base === SCORE.minBase);
});

test("score decreases every time step, wrong guess and hint", () => {
  const base = 160;
  const fresh = finalScore(base, { elapsedSec: 0 }).score;
  assert.equal(fresh, base);
  assert.equal(finalScore(base, { elapsedSec: 4.9 }).score, base);
  assert.ok(finalScore(base, { elapsedSec: 5 }).score < fresh);
  assert.ok(finalScore(base, { elapsedSec: 0, wrongGuesses: 1 }).score < fresh);
  assert.ok(finalScore(base, { elapsedSec: 0, hintsUsed: 1 }).score < fresh);
});

test("penalties are percentages, rounded, and never hit zero", () => {
  const base = 137;
  const worst = finalScore(base, { elapsedSec: 999, wrongGuesses: 10, hintsUsed: 10 });
  assert.equal(worst.score, Math.round(base * SCORE.floorRatio));
  assert.ok(worst.score > 0);
  const mid = finalScore(base, { elapsedSec: 10, wrongGuesses: 1 });
  assert.equal(mid.score, Math.round(base * (1 - 2 * SCORE.timeStepPenalty) * (1 - SCORE.wrongPenalty)));
  assert.ok(Number.isInteger(mid.score));
});

test("tile detail weights sum to 1 and highlight busy regions", async () => {
  const weights = await tileDetailWeights("server/storage/images/moon.jpg");
  assert.equal(weights.length, 9);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 0.01);
  assert.ok(weights[4] > weights[0]);
});

test("unreadable images fall back to even weights", async () => {
  const weights = await tileDetailWeights("server/storage/images/does-not-exist.jpg");
  assert.deepEqual(weights, EVEN);
});
