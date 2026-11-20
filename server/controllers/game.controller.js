import * as gameService from "../services/game.service.js";
import { playMove } from "../services/tictactoe.service.js";
import { playChessMove } from "../services/chess.service.js";
import { flipCard } from "../services/memory.service.js";
import { pressMove } from "../services/simon.service.js";

export async function start(req, res) {
  res.json(await gameService.startGame(req.user.id, req.validated.type));
}

export function hint(req, res) {
  res.json(gameService.useHint(req.user.id, req.validated.sessionId));
}

export function guess(req, res) {
  const { sessionId, answer } = req.validated;
  res.json(gameService.submitGuess(req.user.id, sessionId, answer.toLowerCase()));
}

export function move(req, res) {
  res.json(playMove(req.user.id, req.validated.sessionId, req.validated.cell));
}

export function chessMove(req, res) {
  const { sessionId, ...move } = req.validated;
  res.json(playChessMove(req.user.id, sessionId, move));
}

export function memoryFlip(req, res) {
  res.json(flipCard(req.user.id, req.validated.sessionId, req.validated.index));
}

export function simonPress(req, res) {
  res.json(pressMove(req.user.id, req.validated.sessionId, req.validated.move));
}

export function end(req, res) {
  res.json(gameService.endGame(req.user.id, req.validated.sessionId));
}

export async function imageTile(req, res) {
  const tile = await gameService.gameImageTile(req.user.id, req.params.id, Number(req.params.index));
  res.set("Cache-Control", "private, max-age=3600");
  res.type("image/webp").send(tile);
}
