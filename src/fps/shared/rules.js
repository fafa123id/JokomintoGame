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

// Hostage: two hostages wait on the defenders' sites; attackers win a round by bringing one back
// to their own spawn. Shooting a hostage costs the shooter credits.
export const HOSTAGE = {
  count: 2,
  hp: 100,
  // Two hostages to bring out takes longer than a bomb plant.
  roundSec: 130,
  grabSec: 2,
  grabRange: 1.8,
  // Carrying one slows you down.
  carrySpeed: 0.85,
  follow: 1.3,
  rescueReward: 300,
  // Hurting a hostage costs the shooter credits per point of damage; a kill costs much more.
  hurtPenaltyPerHp: 10,
  killPenalty: 1000,
};

export const MODES = ["bomb", "tdm", "hostage"];

export const TEAMS = ["red", "blue"];
export const SIDES = { ATTACK: "attack", DEFEND: "defend" };
