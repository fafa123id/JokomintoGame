// Bomb mode rules shared by server, bots and HUD.
export const RULES = {
  teamSize: 5,
  roundsToWin: 10,
  // Sides swap every swapAfter rounds.
  swapAfter: 5,
  tickRate: 20,
  // Buy phase: shop open, players frozen in spawn.
  buySec: 10,
  roundSec: 100,
  endSec: 5,
  plantSec: 3.5,
  defuseSec: 6,
  fuseSec: 40,
  plantRadius: 0,
  defuseRange: 1.8,
  pickupRange: 1.4,
  interpMs: 100,
  // Team vision for the minimap: an enemy shows up while a living teammate can see them
  // within this range and field of view, with nothing solid in between.
  visionRange: 30,
  visionFovDeg: 110,
  maxRewindMs: 300,
  // Chance a human attacker (rather than a bot) starts with the bomb.
  humanCarrierChance: 0.6,
  groundMax: 16,
};

// Valorant-style economy for Bomb mode.
export const ECONOMY = {
  start: 800,
  max: 9000,
  win: 3000,
  // Losing pays more the longer the losing streak.
  loss: [1900, 2400, 2900],
  kill: 200,
  // Every attacker earns this when the bomb goes down, win or lose.
  plant: 300,
};

// Team Deathmatch: respawns, first team to the kill target wins (or most kills at the time limit).
export const TDM = {
  killTarget: 40,
  matchSec: 480,
  respawnMs: 3000,
  spawnProtectMs: 1500,
  warmupSec: 6,
};

export const MODES = ["bomb", "tdm"];

export const TEAMS = ["red", "blue"];
export const SIDES = { ATTACK: "attack", DEFEND: "defend" };
