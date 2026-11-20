import { test } from "node:test";
import assert from "node:assert/strict";
import { coinReward as coinRewardFor, scoreMultiplier } from "../server/services/scoring.service.js";
import { COIN } from "../server/config/game.js";

const fresh = { elapsedSec: 0 };
const coinReward = (context, penalties) => coinRewardFor(context, scoreMultiplier(penalties).total);

test("every win pays the fixed base plus a bonus", () => {
  assert.equal(coinReward({ difficulty: 0, recentWins: 0, balance: 0 }, fresh).coin, COIN.base + COIN.bonusMin);
  assert.equal(coinReward({ difficulty: 1, recentWins: 0, balance: 0 }, fresh).coin, COIN.base + COIN.bonusMax);
});

test("repeated wins shrink only the bonus", () => {
  const rewards = [0, 1, 3, 10, 50].map((recentWins) => coinReward({ difficulty: 1, recentWins, balance: 0 }, fresh).coin);
  for (let i = 1; i < rewards.length; i++) assert.ok(rewards[i] <= rewards[i - 1], rewards.join(","));
  assert.equal(rewards.at(-1), COIN.base + Math.round(COIN.bonusMax * COIN.fatigueFloor));
});

test("rich players get a smaller bonus but never less than the base", () => {
  const poor = coinReward({ difficulty: 1, recentWins: 0, balance: 100 }, fresh).coin;
  const rich = coinReward({ difficulty: 1, recentWins: 0, balance: 1000 }, fresh).coin;
  const richest = coinReward({ difficulty: 1, recentWins: 0, balance: 100_000 }, fresh).coin;
  assert.ok(rich < poor);
  assert.equal(richest, COIN.base + Math.round(COIN.bonusMax * COIN.wealthFloor));
});

test("performance affects the bonus and the worst case still pays the base", () => {
  const slow = coinReward({ difficulty: 0.5, recentWins: 0, balance: 0 }, { elapsedSec: 15, wrongGuesses: 1 }).coin;
  const quick = coinReward({ difficulty: 0.5, recentWins: 0, balance: 0 }, fresh).coin;
  assert.ok(slow < quick);
  const worst = coinReward({ difficulty: 0, recentWins: 99, balance: 99_999 }, { elapsedSec: 999, wrongGuesses: 9 });
  assert.equal(worst.coin, COIN.base);
  assert.ok(Number.isInteger(worst.coin));
});
