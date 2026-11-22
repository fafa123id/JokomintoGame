// Weapon stats (server-authoritative; the client uses them for feel, models and the shop).
// slot: primary | secondary | melee | utility. family picks the model and sound.
// speed scales run speed (weight): heavy guns < 1, knife fastest. velocity is bullet speed in m/s.
// Spread is in radians; it grows while moving, in the air and during a spray.
// auto: hold to fire; otherwise one shot per click. pellets: shotgun pellets per shot.
// burst: rounds fired per click, burstGap seconds apart; interval is the pause after a burst.
// scope: zoom per scope level; right mouse steps through them and back out. scopedSpread replaces
// spread while scoped. bolt: one round per magazine, reloaded automatically after every shot.
const gun = (o) => ({ gun: true, auto: true, crouchFactor: 0.75, multipliers: { head: 2.6, body: 1, legs: 0.8 }, ...o });

export const WEAPONS = {
  // ---------- sidearms ----------
  pistol: gun({ id: "pistol", name: "Kecil", slot: "secondary", category: "Sidearm", family: "pistol", price: 0, auto: false, damage: 26, multipliers: { head: 3, body: 1, legs: 0.8 }, interval: 0.26, magazine: 12, reserve: 36, reload: 1.5, spread: 0.004, moveSpread: 0.02, airSpread: 0.09, sprayStep: 0.015, sprayMax: 0.05, range: 60, velocity: 240, speed: 1.1 }),
  rentet: gun({ id: "rentet", name: "Rentet", slot: "secondary", category: "Sidearm", family: "pistol", price: 450, damage: 21, multipliers: { head: 2.6, body: 1, legs: 0.8 }, interval: 0.075, magazine: 13, reserve: 39, reload: 1.6, spread: 0.012, moveSpread: 0.02, airSpread: 0.1, sprayStep: 0.012, sprayMax: 0.07, range: 40, velocity: 230, speed: 1.08 }),
  sabit: gun({ id: "sabit", name: "Sabit", slot: "secondary", category: "Sidearm", family: "revolver", price: 800, auto: false, damage: 55, multipliers: { head: 2.9, body: 1, legs: 0.85 }, interval: 0.42, magazine: 6, reserve: 24, reload: 2.2, spread: 0.003, moveSpread: 0.035, airSpread: 0.12, sprayStep: 0.03, sprayMax: 0.06, range: 70, velocity: 280, speed: 1.05 }),
  // ---------- primaries ----------
  tawon: gun({ id: "tawon", name: "Tawon", slot: "primary", category: "SMG", family: "smg", price: 1600, damage: 24, multipliers: { head: 2.5, body: 1, legs: 0.8 }, interval: 0.075, magazine: 30, reserve: 90, reload: 2.0, spread: 0.008, moveSpread: 0.015, airSpread: 0.1, sprayStep: 0.008, sprayMax: 0.06, range: 50, velocity: 260, speed: 1.05 }),
  gledek: gun({ id: "gledek", name: "Gledek", slot: "primary", category: "Shotgun", family: "shotgun", price: 1850, auto: false, pellets: 12, damage: 17, multipliers: { head: 2, body: 1, legs: 0.8 }, interval: 0.9, magazine: 5, reserve: 20, reload: 2.6, spread: 0.075, moveSpread: 0.01, airSpread: 0.02, sprayStep: 0, sprayMax: 0, range: 25, velocity: 200, speed: 1.0 }),
  tombak: gun({ id: "tombak", name: "Tombak", slot: "primary", category: "Rifle", family: "rifle", price: 2250, auto: false, burst: 3, burstGap: 0.05, damage: 30, multipliers: { head: 2.5, body: 1, legs: 0.85 }, interval: 0.32, magazine: 24, reserve: 72, reload: 2.1, spread: 0.002, moveSpread: 0.05, airSpread: 0.14, sprayStep: 0.006, sprayMax: 0.03, range: 90, velocity: 330, speed: 1.0 }),
  rifle: gun({ id: "rifle", name: "Jokolt", slot: "primary", category: "Rifle", family: "rifle", price: 2900, damage: 30, interval: 0.1, magazine: 25, reserve: 75, reload: 2.2, spread: 0.003, moveSpread: 0.045, airSpread: 0.14, crouchFactor: 0.7, sprayStep: 0.009, sprayMax: 0.055, range: 90, velocity: 320, speed: 1.0 }),
  gerinda: gun({ id: "gerinda", name: "Gerinda", slot: "primary", category: "Heavy", family: "lmg", price: 3200, damage: 28, multipliers: { head: 2.3, body: 1, legs: 0.8 }, interval: 0.065, magazine: 60, reserve: 120, reload: 3.4, spread: 0.009, moveSpread: 0.06, airSpread: 0.16, sprayStep: 0.004, sprayMax: 0.05, range: 80, velocity: 310, speed: 0.85 }),
  elang: gun({ id: "elang", name: "Elang", slot: "primary", category: "Sniper", family: "sniper", price: 4700, auto: false, damage: 150, multipliers: { head: 1.6, body: 1, legs: 0.85 }, interval: 0.3, magazine: 1, reserve: 15, reload: 1.5, bolt: true, spread: 0.06, scopedSpread: 0.0005, moveSpread: 0.08, airSpread: 0.2, sprayStep: 0, sprayMax: 0, range: 120, velocity: 520, speed: 0.85, scope: [2.5, 5] }),
  // ---------- melee and utility ----------
  knife: { id: "knife", name: "Pisau Joko", slot: "melee", family: "knife", melee: true, damage: 50, backstab: 100, interval: 0.55, range: 2.2, speed: 1.25 },
  bomb: { id: "bomb", name: "Bom Joko", slot: "utility", family: "bomb", utility: true, speed: 1 },
};

// Fixed order: indexes into this list travel over the network.
export const WEAPON_IDS = ["rifle", "pistol", "knife", "bomb", "rentet", "sabit", "tawon", "gledek", "tombak", "gerinda", "elang"];
export const GUNS = WEAPON_IDS.filter((id) => WEAPONS[id].gun);
export const DEFAULT_SECONDARY = "pistol";
// Shop sections in display order.
export const SHOP = [
  { name: "Sidearms", items: ["pistol", "rentet", "sabit"] },
  { name: "SMG & Shotgun", items: ["tawon", "gledek"] },
  { name: "Rifles", items: ["tombak", "rifle"] },
  { name: "Heavy & Sniper", items: ["gerinda", "elang"] },
];
// Body armor bought in the shop; it soaks two thirds of each hit until it runs out.
export const ARMOR = {
  light: { id: "light", name: "Rompi Ringan", price: 400, points: 25 },
  heavy: { id: "heavy", name: "Rompi Berat", price: 1000, points: 50 },
};
export const ARMOR_SOAK = 0.66;

// Spray recovers this fast after the trigger is released.
export const SPRAY_RECOVERY = 0.25;
