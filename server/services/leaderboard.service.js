import { PlayerStat } from "../models/playerStat.model.js";

const TOP_LIMIT = 20;
const EMPTY_STATS = { total_score: 0, games_won: 0, games_played: 0, best_score: 0 };

export function getLeaderboard(user) {
  const top = PlayerStat.topRegistered(TOP_LIMIT).map((row, i) => ({
    rank: i + 1,
    name: row.name,
    score: row.total_score,
    wins: row.games_won,
    isMe: !!user && row.user_id === user.id,
  }));

  let me = null;
  if (user) {
    const stats = PlayerStat.findByUser(user.id) ?? EMPTY_STATS;
    const isGuest = !!user.is_guest;
    me = {
      name: user.name,
      isGuest,
      score: stats.total_score,
      wins: stats.games_won,
      played: stats.games_played,
      best: stats.best_score,
      rank: PlayerStat.rankForScore(stats.total_score),
      onGlobal: !isGuest,
    };
  }

  return { top, me, totalPlayers: PlayerStat.countRegistered() };
}
