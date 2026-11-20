import crypto from "node:crypto";
import { transaction } from "../database/connection.js";
import { GameSession } from "../models/gameSession.model.js";
import { PlayerStat } from "../models/playerStat.model.js";
import { Pet } from "../models/pet.model.js";
import { HttpError } from "../utils/httpError.js";
import { getCurrentPet, mutatePet } from "./pet.service.js";
import { baseFromDifficulty, coinReward, coinFactors } from "./scoring.service.js";
import { SIMON, GAME, COIN } from "../config/game.js";

const randomMove = () => crypto.randomInt(SIMON.moves);

export function initialState() {
  return { sequence: Array.from({ length: SIMON.startLength }, randomMove), progress: 0 };
}

const completedRounds = (state) => state.sequence.length - SIMON.startLength;

function coinContext(userId) {
  return {
    difficulty: SIMON.difficulty,
    recentWins: GameSession.countWinsSince(userId, Date.now() - COIN.fatigueWindowMs),
    balance: getCurrentPet(userId).coin,
  };
}

export function previewRewards(userId) {
  return {
    maxScore: baseFromDifficulty(SIMON.difficulty),
    maxCoin: COIN.base + Math.round(coinFactors(coinContext(userId)).effectiveBonus),
    winRounds: SIMON.winRounds,
    fullScoreRounds: SIMON.fullScoreRounds,
  };
}

export function simonView(session) {
  return {
    sequence: session.state.sequence,
    round: completedRounds(session.state) + 1,
    rewards: previewRewards(session.user_id),
  };
}

// Reaching winRounds is a win; every round past it raises the score up to fullScoreRounds.
export function outcomeOf(rounds) {
  const base = baseFromDifficulty(SIMON.difficulty);
  if (rounds >= SIMON.winRounds) {
    const performance = Math.min(1, rounds / SIMON.fullScoreRounds);
    return { outcome: "win", performance, score: Math.round(base * performance) };
  }
  const performance = rounds / SIMON.winRounds;
  return { outcome: "lose", performance, score: Math.round(base * SIMON.loseScoreRatio * performance) };
}

function settle(userId, session, rounds) {
  const { outcome, performance, score } = outcomeOf(rounds);
  const coin = outcome === "win" ? coinReward(coinContext(userId), performance).coin : 0;
  if (!GameSession.finish(session.id, score)) throw HttpError.badRequest("Game session is not active");
  const mood = GAME.mood.simon[outcome];
  const pet = mutatePet(userId, (p) => {
    p.coin += coin;
    p.mood += mood;
  });
  if (outcome === "win") PlayerStat.recordWin(userId, score);
  else if (score > 0) PlayerStat.addScore(userId, score);
  return { outcome, reward: { coin, mood, score, rounds }, pet: Pet.toPublic(pet) };
}

export function pressMove(userId, sessionId, move) {
  return transaction(() => {
    const session = GameSession.find(sessionId, userId);
    if (!session || session.type !== "simon" || session.finished) throw HttpError.badRequest("Game session is not active");

    const state = { ...session.state, sequence: [...session.state.sequence] };
    const rounds = completedRounds(state);
    if (Date.now() > session.expires_at) {
      const { outcome, reward, pet } = settle(userId, session, rounds);
      return { status: "timeout", outcome, reward, pet };
    }

    const expected = state.sequence[state.progress];
    if (move !== expected) {
      const { outcome, reward, pet } = settle(userId, session, rounds);
      return { status: "over", outcome, expected, reward, pet };
    }

    state.progress += 1;
    if (state.progress < state.sequence.length) {
      GameSession.setState(session.id, state);
      return { status: "ok", progress: state.progress };
    }

    state.sequence.push(randomMove());
    state.progress = 0;
    GameSession.setState(session.id, state);
    return { status: "round", sequence: state.sequence, round: completedRounds(state) + 1 };
  });
}

// Cash out a winning run; only allowed once winRounds are done.
export function finishSimon(userId, sessionId) {
  return transaction(() => {
    const session = GameSession.find(sessionId, userId);
    if (!session || session.type !== "simon" || session.finished) throw HttpError.badRequest("Game session is not active");
    const rounds = completedRounds(session.state);
    if (Date.now() > session.expires_at) {
      const { outcome, reward, pet } = settle(userId, session, rounds);
      return { status: "timeout", outcome, reward, pet };
    }
    if (rounds < SIMON.winRounds) throw HttpError.badRequest(`Finish at least ${SIMON.winRounds} rounds first`);
    const { outcome, reward, pet } = settle(userId, session, rounds);
    return { status: "finished", outcome, reward, pet };
  });
}

