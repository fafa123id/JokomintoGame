import crypto from "node:crypto";
import { transaction } from "../database/connection.js";
import { GameSession } from "../models/gameSession.model.js";
import { PlayerStat } from "../models/playerStat.model.js";
import { Pet } from "../models/pet.model.js";
import { HttpError } from "../utils/httpError.js";
import { getCurrentPet, mutatePet } from "./pet.service.js";
import { baseFromDifficulty, coinReward, coinFactors } from "./scoring.service.js";
import { MEMORY, GAME, COIN } from "../config/game.js";

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The deck stays on the server; the client only learns a face when it is flipped.
export function initialState(now = Date.now()) {
  return {
    deck: shuffle([...MEMORY.faces, ...MEMORY.faces]),
    matched: [],
    open: null,
    moves: 0,
    previewUntil: now + MEMORY.previewSec * 1000,
  };
}

const previewLeftMs = (state) => Math.max(0, (state.previewUntil ?? 0) - Date.now());

function coinContext(userId) {
  return {
    difficulty: MEMORY.difficulty,
    recentWins: GameSession.countWinsSince(userId, Date.now() - COIN.fatigueWindowMs),
    balance: getCurrentPet(userId).coin,
  };
}

export function previewRewards(userId) {
  return {
    maxScore: baseFromDifficulty(MEMORY.difficulty),
    maxCoin: COIN.base + Math.round(coinFactors(coinContext(userId)).effectiveBonus),
  };
}

// Fewer moves than par and a quick finish keep the full score.
export function performanceOf(moves, elapsedSec) {
  const extraMoves = Math.max(0, moves - MEMORY.parMoves);
  const extraTime = Math.max(0, elapsedSec - MEMORY.parSec);
  const value = 1 - MEMORY.perExtraMovePenalty * extraMoves - MEMORY.perExtraSecPenalty * extraTime;
  return Math.max(MEMORY.minPerformance, Math.min(1, value));
}

export function memoryView(session) {
  const { deck, matched, open, moves } = session.state;
  const previewMs = previewLeftMs(session.state);
  return {
    cards: deck.length,
    ...(previewMs > 0 && { preview: deck, previewMs }),
    matched: matched.map((i) => ({ index: i, face: deck[i] })),
    open: open === null ? null : { index: open, face: deck[open] },
    moves,
    rewards: previewRewards(session.user_id),
  };
}

function settleWin(userId, session, state) {
  const elapsedSec = (Date.now() - (state.previewUntil ?? session.started_at)) / 1000;
  const performance = performanceOf(state.moves, elapsedSec);
  const score = Math.round(baseFromDifficulty(MEMORY.difficulty) * performance);
  const coin = coinReward(coinContext(userId), performance).coin;
  if (!GameSession.finish(session.id, score)) throw HttpError.badRequest("Game session is not active");
  const mood = GAME.mood.memory.win;
  const pet = mutatePet(userId, (p) => {
    p.coin += coin;
    p.mood += mood;
  });
  PlayerStat.recordWin(userId, score);
  return { pet, reward: { coin, mood, score, performance } };
}

function settleTimeout(userId, session) {
  GameSession.finish(session.id);
  const mood = GAME.mood.memory.lose;
  const pet = mutatePet(userId, (p) => {
    p.mood += mood;
  });
  return { status: "timeout", reward: { mood }, pet: Pet.toPublic(pet) };
}

export function flipCard(userId, sessionId, index) {
  return transaction(() => {
    const session = GameSession.find(sessionId, userId);
    if (!session || session.type !== "memory" || session.finished) throw HttpError.badRequest("Game session is not active");
    if (Date.now() > session.expires_at) return settleTimeout(userId, session);
    if (previewLeftMs(session.state) > 0) throw HttpError.badRequest("Memorize the cards first");

    const state = { ...session.state, matched: [...session.state.matched] };
    if (index >= state.deck.length) throw HttpError.badRequest("Card doesn't exist");
    if (state.matched.includes(index) || state.open === index) throw HttpError.badRequest("Card is already open");

    const face = state.deck[index];
    if (state.open === null) {
      state.open = index;
      GameSession.setState(session.id, state);
      return { status: "open", index, face, moves: state.moves };
    }

    const first = state.open;
    const match = state.deck[first] === face;
    state.open = null;
    state.moves += 1;
    if (match) state.matched.push(first, index);
    GameSession.setState(session.id, state);

    const result = { status: "playing", index, face, pair: [first, index], match, moves: state.moves };
    if (state.matched.length < state.deck.length) return result;

    const { pet, reward } = settleWin(userId, session, state);
    return { ...result, status: "win", reward, pet: Pet.toPublic(pet) };
  });
}
