import { getLeaderboard } from "../services/leaderboard.service.js";

export function index(req, res) {
  res.set("Cache-Control", "no-store");
  res.json(getLeaderboard(req.user));
}
