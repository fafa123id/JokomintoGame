// Bomb mode rules shared by server, bots and HUD.
export const RULES = {
  teamSize: 5,
  roundsToWin: 10,
  // Sides swap every swapAfter rounds.
  swapAfter: 5,
  tickRate: 20,
  buySec: 6,
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

export const TEAMS = ["red", "blue"];
export const SIDES = { ATTACK: "attack", DEFEND: "defend" };
