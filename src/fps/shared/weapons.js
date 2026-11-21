// Weapon stats (server-authoritative; the client uses them for feel and HUD).
// Spread is in radians; it grows while moving, in the air and during a spray.
export const WEAPONS = {
  rifle: {
    id: "rifle",
    name: "Jokolt",
    slot: 1,
    gun: true,
    damage: 30,
    multipliers: { head: 2.6, body: 1, legs: 0.8 },
    interval: 0.1,
    magazine: 25,
    reserve: 75,
    reload: 2.2,
    spread: 0.003,
    moveSpread: 0.045,
    airSpread: 0.14,
    crouchFactor: 0.7,
    sprayStep: 0.009,
    sprayMax: 0.055,
    range: 90,
  },
  pistol: {
    id: "pistol",
    name: "Kecil",
    slot: 2,
    gun: true,
    damage: 26,
    multipliers: { head: 3, body: 1, legs: 0.8 },
    interval: 0.26,
    magazine: 12,
    reserve: 36,
    reload: 1.5,
    spread: 0.004,
    moveSpread: 0.02,
    airSpread: 0.09,
    crouchFactor: 0.75,
    sprayStep: 0.015,
    sprayMax: 0.05,
    range: 60,
  },
  knife: {
    id: "knife",
    name: "Pisau Joko",
    slot: 3,
    melee: true,
    damage: 50,
    backstab: 100,
    interval: 0.55,
    range: 2.2,
  },
  bomb: {
    id: "bomb",
    name: "Bom Joko",
    slot: 4,
    utility: true,
  },
};

export const WEAPON_ORDER = ["rifle", "pistol", "knife", "bomb"];
export const GUNS = WEAPON_ORDER.filter((id) => WEAPONS[id].gun);

// Spray recovers this fast after the trigger is released.
export const SPRAY_RECOVERY = 0.25;
