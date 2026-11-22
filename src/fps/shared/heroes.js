// Ten heroes, two per role, each with a skill (Z) on a cooldown and an ultimate (X) that charges
// over time and from kills, assists and objectives. Every kit has a clear counter in another kit.
// gear: what the procedural model wears on its head; build scales the body slightly.
//
// deploy: placeable abilities first show a preview where you aim, then go out on a second press.
//   circle { r, range }   ground area     wall { length, range }   barrier across the aim
//   arc                   thrown grenade  map { count, r }         pick points on a map (laptop)
//   ally { range }        a living teammate under the crosshair
//   corpse { range }      a fallen teammate's body under the crosshair
export const ROLES = {
  controller: { name: "Controller", icon: "🚧", hint: "Blocks sight lines and splits sites" },
  skirmisher: { name: "Skirmisher", icon: "⚡", hint: "Fast entries and flanks" },
  assault: { name: "Assault", icon: "💥", hint: "Takes space and breaks defenses" },
  recon: { name: "Recon", icon: "📡", hint: "Finds enemies before the fight" },
  support: { name: "Support", icon: "🌿", hint: "Keeps the team alive" },
};

export const HEROES = [
  {
    id: "kabut",
    name: "Kabut",
    role: "controller",
    icon: "☁️",
    color: 0x8b95a5,
    gear: "hood",
    build: 1.0,
    skill: { id: "smoke", name: "Laptop Asap", icon: "💻", cooldown: 26, desc: "Open the laptop and pick up to 2 spots to smoke for 12 s. One spot = half the cooldown.", deploy: { kind: "map", count: 2, r: 4.2 } },
    ult: { id: "laser", name: "Zona Laser", icon: "🔴", desc: "Pick a zone on the laptop: after a loud 4.5 s warning, lasers bog enemies down (60% slower) and burn them for 4 s.", deploy: { kind: "map", count: 1, r: 6 } },
    counter: "Radar sees through smoke; the laser's warning gives time to run",
  },
  {
    id: "pagar",
    name: "Pagar",
    role: "controller",
    icon: "🧱",
    color: 0x9c7a4c,
    gear: "helmet",
    build: 1.04,
    skill: { id: "wall", name: "Dinding", icon: "🧱", cooldown: 22, desc: "Raises a 6 m wall that stands until enemies break it (teammates can't). A new wall replaces your old one.", deploy: { kind: "wall", length: 6, range: 10 } },
    ult: { id: "dome", name: "Kubah Listrik", icon: "⚡", desc: "An electric dome for 8 s: bullets and grenades from outside stop at the shell; enemies inside are stunned, staggered and burned for 20 damage a second.", deploy: { kind: "circle", r: 4.5, range: 10 } },
    counter: "Petasan's grenades blow the wall apart; Magnet's vortex drags people out of the dome",
  },
  {
    id: "dash",
    name: "Dash",
    role: "skirmisher",
    icon: "⚡",
    color: 0xf2c230,
    gear: "cap",
    build: 0.95,
    skill: { id: "dash", name: "Dash", icon: "💨", cooldown: 4, desc: "A quick burst in the direction you're moving." },
    ult: { id: "stealth", name: "Sprint Siluman", icon: "👻", desc: "Nearly invisible and faster for 6 s; footsteps go quiet. A timer shows when you reappear." },
    counter: "Lebah's scout drones and Radar's scans",
  },
  {
    id: "kopi",
    name: "Kopi",
    role: "skirmisher",
    icon: "☕",
    color: 0x8b5a2b,
    gear: "headset",
    build: 0.97,
    skill: { id: "boost", name: "Zona Kafein", icon: "☕", cooldown: 16, desc: "A circle that gives teammates a 2 s speed boost when they step in. Lasts 8 s.", deploy: { kind: "circle", r: 2.5, range: 12 } },
    ult: { id: "rush", name: "Kafein Rush", icon: "⚡", desc: "The whole team gets Kafein for 3 s: faster, steadier aim, less recoil." },
    counter: "Pagar's slow zone and Tameng's dome stop the rush",
  },
  {
    id: "petasan",
    name: "Petasan",
    role: "assault",
    icon: "🧨",
    color: 0xd9452b,
    gear: "beanie",
    build: 1.04,
    skill: { id: "grenade", name: "Granat Lempar", icon: "🧨", cooldown: 14, desc: "Throws a grenade (up to 110 damage) that goes off after 1 s. Shows where it will land.", deploy: { kind: "arc" } },
    ult: { id: "barrage", name: "Hujan Petasan", icon: "🎆", desc: "Ten firecrackers (up to 65 each) rain on an area within 2 s.", deploy: { kind: "circle", r: 6, range: 40 } },
    counter: "Tameng's shield and Pagar's dome absorb the blasts",
  },
  {
    id: "magnet",
    name: "Magnet",
    role: "assault",
    icon: "🧲",
    color: 0x6d4fc2,
    gear: "helmet",
    build: 1.08,
    skill: { id: "stun", name: "Kejut Magnet", icon: "🧲", cooldown: 16, desc: "Throws an electric baton straight where you aim: the first enemy it hits is stunned for 1.5 s (no moving, no shooting). Walls and shields stop it." },
    ult: { id: "vortex", name: "Tarikan Area", icon: "🌀", desc: "Drags every enemy in an area to its center for 2 s; they stay a little slower for 2 s after.", deploy: { kind: "circle", r: 7, range: 30 } },
    counter: "Strafe to dodge the baton; a dash escapes the vortex",
  },
  {
    id: "jamu",
    name: "Jamu",
    role: "support",
    icon: "🌿",
    color: 0x6aa84f,
    gear: "beanie",
    build: 0.99,
    skill: { id: "heal", name: "Ramuan Penyembuh", icon: "🌿", cooldown: 20, desc: "A healing patch for teammates for 6 s.", deploy: { kind: "circle", r: 4, range: 10 } },
    ult: { id: "revive", name: "Bangkit Bersama", icon: "✨", desc: "Aim at a fallen teammate's body: they get back up right there with 60 HP, and the team gets a 40 shield.", deploy: { kind: "corpse", range: 40 } },
    counter: "Smoke hides the bodies; kill Jamu before the revive",
  },
  {
    id: "tameng",
    name: "Tameng",
    role: "support",
    icon: "🛡️",
    color: 0x2f8fb5,
    gear: "helmet",
    build: 1.06,
    skill: { id: "shield", name: "Perisai Gerak", icon: "🛡️", cooldown: 14, desc: "A bulletproof shield for 4 s. Press the skill again to send it where you aim (forward, back, sideways, turned).", deploy: { kind: "wall", length: 3, range: 8 } },
    ult: { id: "leap", name: "Lompat Pagar", icon: "🦘", desc: "Leap to the teammate you aim at and raise a tough electric fence ahead of them: enemies can't pass and get shocked; allies walk through.", deploy: { kind: "ally", range: 35 } },
    counter: "Grenades tear through shields; the fence can be shot down",
  },
  {
    id: "radar",
    name: "Radar",
    role: "recon",
    icon: "📡",
    color: 0x2fb56a,
    gear: "headset",
    build: 0.98,
    skill: { id: "scan", name: "Scan Arah", icon: "📡", cooldown: 20, desc: "Reveals enemies in a cone ahead for 3 s, through walls." },
    ult: { id: "reveal", name: "Tandai Semua", icon: "🛰️", desc: "Reveals every enemy on the map for 3 s." },
    counter: "Smoke and stealth hide you from scans",
  },
  {
    id: "lebah",
    name: "Lebah",
    role: "recon",
    icon: "🐝",
    color: 0xd9a52f,
    gear: "mask",
    build: 0.96,
    skill: { id: "scouts", name: "Lebah Pengintai", icon: "🐝", cooldown: 18, desc: "A scout drone climbs high and flies ahead; once it spots an enemy it follows them, keeping them revealed. Can be shot down." },
    ult: { id: "drone", name: "Drone Pemburu", icon: "🛸", desc: "A tougher drone hunts the nearest enemy and explodes. Can be shot down." },
    counter: "Shoot the drones; a quick dash outruns the hunter",
  },
];

export const HERO_IDS = HEROES.map((h) => h.id);
export const heroById = (id) => HEROES.find((h) => h.id === id) ?? null;
export const PICK_SECONDS = 20;

// Ultimate charge (percent): passive per second, plus events.
export const ULT = { perSecond: 0.9, kill: 18, assist: 9, plant: 12, defuse: 12, damage: 0.05 };
