import * as gameService from "../services/game.service.js";
import { playMove } from "../services/tictactoe.service.js";

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

export function end(req, res) {
  res.json(gameService.endGame(req.user.id, req.validated.sessionId));
}

export function image(req, res, next) {
  const file = gameService.gameImagePath(req.user.id, req.params.id);
  res.set("Cache-Control", "private, no-store");
  res.sendFile(file, (err) => err && next(err));
}
