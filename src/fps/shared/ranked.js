// Ranked ladder for Jokoman 5v5 (shared by server and client).
// Points (RP) climb through tiers split into levels; Joko Emperor is not a threshold but the top of
// the global ranking among Joko Masters. Higher tiers cost more to play (entry cost), like Apex.
export const TIERS = [
  { id: "unranked", name: "Unranked", icon: "❔", color: "#94a3b8", levels: 1, size: 300, cost: 0 },
  { id: "bronze", name: "Bronze", icon: "🥉", color: "#c2410c", levels: 3, size: 500, cost: 0 },
  { id: "silver", name: "Silver", icon: "🥈", color: "#cbd5e1", levels: 3, size: 500, cost: 15 },
  { id: "gold", name: "Gold", icon: "🥇", color: "#fbbf24", levels: 3, size: 500, cost: 30 },
  { id: "platinum", name: "Platinum", icon: "💠", color: "#5eead4", levels: 3, size: 750, cost: 45 },
  { id: "diamond", name: "Diamond", icon: "💎", color: "#60a5fa", levels: 3, size: 1000, cost: 60 },
  { id: "master", name: "Joko Master", icon: "🔮", color: "#c084fc", levels: 3, size: 1500, cost: 80 },
  { id: "emperor", name: "Joko Emperor", icon: "👑", color: "#f43f5e", levels: 1, size: 0, cost: 100 },
];

// How many Joko Masters (by RP) wear the Emperor crown.
export const EMPEROR_SLOTS = 10;
export const PARTY_MAX_RANKED = 3;
export const RANKED_MODES = ["bomb", "hostage"];
const ROMAN = ["I", "II", "III"];

// Where each tier starts.
const FLOORS = [];
{
  let at = 0;
  for (const t of TIERS) {
    FLOORS.push(at);
    at += t.levels * t.size;
  }
}
export const MASTER_FLOOR = FLOORS[TIERS.findIndex((t) => t.id === "master")];

// Tier, level and progress for an RP total. emperor: this player is in the Emperor slots.
export function rankOf(points, { emperor = false } = {}) {
  const rp = Math.max(0, Math.round(points));
  let index = 0;
  for (let i = 0; i < TIERS.length - 1; i++) if (rp >= FLOORS[i]) index = i;
  if (emperor && rp >= MASTER_FLOOR) index = TIERS.length - 1;
  const tier = TIERS[index];
  const floor = FLOORS[index];
  // Master keeps counting past its last level; Emperor has no levels.
  const into = rp - floor;
  const levelIndex = tier.levels > 1 ? Math.min(tier.levels - 1, Math.floor(into / tier.size)) : 0;
  const levelStart = floor + levelIndex * tier.size;
  const top = tier.id === "emperor" || (tier.id === "master" && into >= tier.levels * tier.size);
  return {
    points: rp,
    index,
    id: tier.id,
    name: tier.name,
    icon: tier.icon,
    color: tier.color,
    // Levels count down like in most shooters: III → II → I.
    level: tier.levels > 1 ? ROMAN[tier.levels - 1 - levelIndex] : null,
    label: tier.levels > 1 ? `${tier.name} ${ROMAN[tier.levels - 1 - levelIndex]}` : tier.name,
    floor,
    progress: top ? 1 : tier.size ? (rp - levelStart) / tier.size : 1,
    next: top ? null : levelStart + tier.size,
    cost: tier.cost,
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// RP for one match. A win is worth 200-500 depending on how you played and the margin; a loss
// ranges from -50 (or worse at high tiers, where entry costs bite) up to +50 for a great game.
// Leaving early always costs.
export function rpChange({ points, won, draw = false, kills = 0, deaths = 0, assists = 0, objectives = 0, margin = 0, left = false, emperor = false }) {
  const rank = rankOf(points, { emperor });
  const performance = kills * 25 + assists * 12 + objectives * 40 - deaths * 8;
  const parts = { kills: kills * 25, assists: assists * 12, objectives: objectives * 40, deaths: -deaths * 8, cost: -rank.cost };
  let delta;
  if (left) delta = -(150 + rank.cost);
  else if (draw) delta = clamp(Math.round(performance * 0.3) - rank.cost, -50, 100);
  else if (won) delta = clamp(250 + clamp(performance, 0, 200) + clamp(margin, 0, 10) * 5 - rank.cost, 200, 500);
  else delta = clamp(-50 + Math.round(clamp(performance, 0, 250) * 0.4) - rank.cost, -50 - rank.cost, 50);
  // Demotion protection: you never fall out of the tier you're in (Unranked can't go below 0).
  const after = Math.max(rank.index > 0 && rank.id !== "emperor" ? rank.floor : 0, rank.points + delta);
  return { before: rank.points, after, delta: after - rank.points, parts, won, left };
}
