import { SCORE, COIN, LETTER_FREQUENCY } from "../config/game.js";

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round2 = (value) => Math.round(value * 100) / 100;

const FREQ_MAX = Math.max(...Object.values(LETTER_FREQUENCY));
const FREQ_MIN = Math.min(...Object.values(LETTER_FREQUENCY));

function letterRarity(letter) {
  const freq = LETTER_FREQUENCY[letter] ?? FREQ_MIN;
  return clamp01(Math.log2(FREQ_MAX / freq) / Math.log2(FREQ_MAX / FREQ_MIN));
}

const differences = (values) => values.slice(1).map((v, i) => Math.abs(v - values[i]));

// Level 1: alphabetical distance between neighbours. Level 2: distance between those distances.
function letterDistance(word) {
  const positions = [...word].map((c) => c.charCodeAt(0) - 97);
  const level1 = differences(positions);
  const level2 = differences(level1);
  return clamp01(0.7 * (mean(level1) / 25) + 0.3 * (mean(level2) / 25));
}

export function baseFromDifficulty(difficulty) {
  return Math.round(SCORE.minBase + (SCORE.maxBase - SCORE.minBase) * clamp01(difficulty));
}

export function wordDifficulty(word, revealed) {
  const hidden = [...word].filter((_, i) => !revealed.includes(i));
  const factors = {
    rarity: round2(mean(hidden.map(letterRarity))),
    distance: round2(letterDistance(word)),
    length: round2(clamp01((word.length - 3) / 7)),
  };
  const { rarity, distance, length, calibration } = SCORE.word;
  const raw = rarity * factors.rarity + distance * factors.distance + length * factors.length;
  const difficulty = clamp01((raw - calibration.low) / (calibration.high - calibration.low));
  return { difficulty: round2(difficulty), base: baseFromDifficulty(difficulty), factors };
}

// tileWeights: share of the image's visual detail per tile (sums to 1).
export function imageVisibility(tileWeights, revealed) {
  const tiles = tileWeights.length;
  const detail = revealed.reduce((sum, i) => sum + (tileWeights[i] ?? 0), 0);
  const area = revealed.length / tiles;
  const { detailWeight, areaWeight } = SCORE.image;
  return round2(clamp01(detailWeight * detail + areaWeight * area));
}

export function imageDifficulty(tileWeights, revealed) {
  const visibility = imageVisibility(tileWeights, revealed);
  return { visibility, difficulty: round2(1 - visibility), base: baseFromDifficulty(1 - visibility) };
}

export function scoreMultiplier({ elapsedSec, wrongGuesses = 0, hintsUsed = 0 }) {
  const timeSteps = Math.floor(Math.max(0, elapsedSec) / SCORE.timeStepSec);
  const time = Math.max(0, 1 - SCORE.timeStepPenalty * timeSteps);
  const wrong = (1 - SCORE.wrongPenalty) ** wrongGuesses;
  const hints = (1 - SCORE.hintPenalty) ** hintsUsed;
  return { time, wrong, hints, total: Math.max(SCORE.floorRatio, time * wrong * hints) };
}

export function finalScore(base, penalties) {
  const multiplier = scoreMultiplier(penalties);
  return {
    score: Math.round(base * multiplier.total),
    base,
    multiplier: round2(multiplier.total),
    breakdown: {
      time: round2(multiplier.time),
      wrong: round2(multiplier.wrong),
      hints: round2(multiplier.hints),
    },
  };
}

export function coinFactors({ difficulty, recentWins, balance }) {
  const bonus = COIN.bonusMin + (COIN.bonusMax - COIN.bonusMin) * clamp01(difficulty);
  const fatigue = Math.max(COIN.fatigueFloor, (1 - COIN.fatigueRate) ** recentWins);
  const excess = Math.max(0, balance - COIN.wealthThreshold);
  const wealth = Math.max(COIN.wealthFloor, 1 - excess / COIN.wealthRange);
  return { base: COIN.base, bonus, fatigue, wealth, effectiveBonus: bonus * fatigue * wealth };
}

export function coinReward(context, performance) {
  const factors = coinFactors(context);
  const bonus = Math.round(factors.effectiveBonus * performance);
  return {
    coin: COIN.base + bonus,
    breakdown: {
      base: COIN.base,
      bonus,
      performance: round2(performance),
      fatigue: round2(factors.fatigue),
      wealth: round2(factors.wealth),
    },
  };
}

export function scoringRules() {
  return {
    timeStepSec: SCORE.timeStepSec,
    timeStepPenalty: SCORE.timeStepPenalty,
    floorRatio: SCORE.floorRatio,
    coinFixed: COIN.base,
  };
}
