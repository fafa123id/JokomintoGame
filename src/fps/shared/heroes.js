// Ten heroes, two per role, each with a skill (Z) on a cooldown and an ultimate (X) that charges
// over time and from kills, assists and objectives. Every kit has a clear counter in another kit.
// gear: what the procedural model wears on its head; build scales the body slightly.
//
// deploy: placeable abilities first show a preview where you aim, then go out on a second press.
//   circle { r, range }   ground area     wall { length, range }   barrier across the aim
//   arc                   thrown grenade  map { count, r }         pick points on a map (laptop)
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
    ult: { id: "laser", name: "Zona Laser", icon: "🔴", desc: "Pick a zone on the laptop: after a loud 4.5 s warning, lasers shred enemies inside for 4 s.", deploy: { kind: "map", count: 1, r: 6 } },
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
    skill: { id: "wall", name: "Dinding Sementara", icon: "🧱", cooldown: 22, desc: "Raises a 6 m wall for 8 s. Explosions and gunfire break it.", deploy: { kind: "wall", length: 6, range: 10 } },
    ult: { id: "slowZone", name: "Zona Lambat", icon: "🐌", desc: "Enemies in the zone move at half speed for 8 s.", deploy: { kind: "circle", r: 7, range: 30 } },
    counter: "Petasan's grenades blow the wall apart",
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
    skill: { id: "grenade", name: "Granat Lempar", icon: "🧨", cooldown: 14, desc: "Throws a grenade that explodes after a short fuse. Shows where it will land.", deploy: { kind: "arc" } },
    ult: { id: "barrage", name: "Hujan Petasan", icon: "🎆", desc: "Rains firecrackers over an area for 3 s.", deploy: { kind: "circle", r: 6, range: 40 } },
    counter: "Tameng's shields absorb the blasts",
  },
  {
    id: "magnet",
    name: "Magnet",
    role: "assault",
    icon: "🧲",
    color: 0x6d4fc2,
    gear: "helmet",
    build: 1.08,
    skill: { id: "pull", name: "Tarik", icon: "🧲", cooldown: 16, desc: "Yanks the enemy you aim at a few meters toward you." },
    ult: { id: "vortex", name: "Tarikan Area", icon: "🌀", desc: "Drags every enemy in an area to its center and slows them.", deploy: { kind: "circle", r: 7, range: 30 } },
    counter: "A well-timed dash breaks the pull",
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
    ult: { id: "revive", name: "Bangkit Bersama", icon: "✨", desc: "Revives the last fallen teammate and shields the team." },
    counter: "Smoke hides who needs healing",
  },
  {
    id: "tameng",
    name: "Tameng",
    role: "support",
    icon: "🛡️",
    color: 0x2f8fb5,
    gear: "helmet",
    build: 1.06,
    skill: { id: "shield", name: "Perisai Depan", icon: "🛡️", cooldown: 18, desc: "A bulletproof barrier for 10 s.", deploy: { kind: "wall", length: 3, range: 8 } },
    ult: { id: "dome", name: "Kubah Listrik", icon: "⚡", desc: "An electric dome for 8 s: stops bullets from outside; enemies inside are stunned, staggered and burned for 20 damage a second.", deploy: { kind: "circle", r: 4.5, range: 10 } },
    counter: "Grenades tear through shields fast",
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
    skill: { id: "scouts", name: "Lebah Pengintai", icon: "🐝", cooldown: 18, desc: "Sends two scout drones ahead that reveal enemies they pass. They can be shot down." },
    ult: { id: "drone", name: "Drone Pemburu", icon: "🛸", desc: "A tougher drone hunts the nearest enemy and explodes. Can be shot down." },
    counter: "Shoot the drones; a quick dash outruns the hunter",
  },
];

export const HERO_IDS = HEROES.map((h) => h.id);
export const heroById = (id) => HEROES.find((h) => h.id === id) ?? null;
export const PICK_SECONDS = 20;

// Ultimate charge (percent): passive per second, plus events.
export const ULT = { perSecond: 0.9, kill: 18, assist: 9, plant: 12, defuse: 12, damage: 0.05 };
