import { CELL, PLAYER, lineOfSight } from "./physics.js";

// Maps are carved from solid rock: rooms and corridors become floor, then cover and pillars are placed.
// Cells: "#" wall, "=" low cover, "." floor, "A"/"B" bomb sites, "T" attacker spawn, "D" defender spawn.
function build({ id, name, theme, width = 26, height = 26, ops }) {
  const grid = Array.from({ length: height }, () => Array(width).fill("#"));
  const fill = (x, y, w, h, ch) => {
    for (let z = y; z < y + h; z++) for (let c = x; c < x + w; c++) if (z > 0 && c > 0 && z < height - 1 && c < width - 1) grid[z][c] = ch;
  };
  for (const [op, ...args] of ops) {
    if (op === "floor") fill(...args, ".");
    else if (op === "site") fill(...args.slice(1), args[0]);
    else if (op === "spawn") fill(...args.slice(1), args[0]);
    else if (op === "cover") for (const [x, y] of args) grid[y][x] = "=";
    else if (op === "pillar") for (const [x, y] of args) grid[y][x] = "#";
  }
  const cells = (ch) => grid.flatMap((row, z) => row.flatMap((c, x) => (c === ch ? [{ x, z }] : [])));
  const map = { id, name, theme, width, height, grid: grid.map((row) => row.join("")), blocks: [] };
  map.zones = { attack: cells("T"), defend: cells("D") };
  map.spawns = { attack: safeSpawns(map, "attack"), defend: safeSpawns(map, "defend") };
  map.sites = { A: cells("A"), B: cells("B") };
  delete map.blocks;
  return map;
}

const WALK = new Set([".", "A", "B", "T", "D"]);
const cellCenter = ({ x, z }) => ({ x: (x + 0.5) * CELL, z: (z + 0.5) * CELL });

// Walking distance (in cells) from a set of cells to every floor cell.
function distances(map, from) {
  const dist = new Map(from.map((c) => [c.z * map.width + c.x, 0]));
  const queue = [...from];
  while (queue.length) {
    const c = queue.shift();
    const d = dist.get(c.z * map.width + c.x);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx;
      const z = c.z + dz;
      const k = z * map.width + x;
      if (dist.has(k) || !WALK.has(map.grid[z]?.[x])) continue;
      dist.set(k, d + 1);
      queue.push({ x, z });
    }
  }
  return dist;
}

// Spawn spots out of the enemy's sight: a spot is exposed for every cell on the enemy's half of
// the map it can see at eye height (long open lanes between the two spawns). The safest spots win,
// with spots tucked against a wall preferred; at least six are kept so a team never stacks up.
function safeSpawns(map, side) {
  const own = map.zones[side];
  const enemy = map.zones[side === "attack" ? "defend" : "attack"];
  const fromOwn = distances(map, own);
  const fromEnemy = distances(map, enemy);
  const enemyHalf = [];
  for (const [k, d] of fromEnemy) if (d < (fromOwn.get(k) ?? Infinity)) enemyHalf.push(cellCenter({ x: k % map.width, z: Math.floor(k / map.width) }));
  const eye = (p) => ({ x: p.x, y: PLAYER.eye, z: p.z });
  const scored = own.map((c) => {
    const at = eye(cellCenter(c));
    // Seeing straight into the enemy spawn is the worst case of all.
    const exposure = enemyHalf.filter((q) => lineOfSight(map, at, eye(q))).length + (enemy.some((e) => lineOfSight(map, at, eye(cellCenter(e)))) ? 1000 : 0);
    const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !WALK.has(map.grid[c.z + dz]?.[c.x + dx])).length;
    return { c, exposure, walls };
  });
  scored.sort((a, b) => a.exposure - b.exposure || b.walls - a.walls);
  const safe = scored.filter((s) => s.exposure === 0);
  const keep = safe.length >= 6 ? safe : scored.slice(0, Math.min(scored.length, 6));
  return keep.map((s) => cellCenter(s.c));
}

const RAW = [
  {
    id: "pasar",
    name: "Pasar Joko",
    theme: { sky: 0x9ad7ff, floor: 0xd9c7a3, wall: 0xb5835a, cover: 0x7a9a5b, fog: 0xbfe3ff },
    ops: [
      ["spawn", "D", 10, 1, 6, 3],
      ["spawn", "T", 10, 22, 6, 3],
      ["site", "A", 2, 3, 7, 6],
      ["site", "B", 17, 3, 7, 6],
      ["floor", 3, 9, 3, 13],
      ["floor", 3, 21, 7, 2],
      ["floor", 20, 9, 3, 13],
      ["floor", 16, 21, 7, 2],
      ["floor", 11, 9, 4, 13],
      ["floor", 6, 10, 14, 2],
      ["floor", 9, 2, 1, 2],
      ["floor", 16, 2, 1, 2],
      ["floor", 9, 5, 2, 5],
      ["floor", 15, 5, 2, 5],
      ["cover", [4, 5], [6, 7], [19, 5], [21, 7], [12, 14], [13, 17], [4, 15], [21, 15], [8, 10], [17, 11]],
    ],
  },
  {
    id: "pabrik",
    name: "Pabrik Tahu",
    theme: { sky: 0xc9d6e3, floor: 0xa9a9a2, wall: 0x6b7280, cover: 0xd9b45a, fog: 0xd5dde6 },
    ops: [
      ["spawn", "D", 10, 1, 6, 3],
      ["spawn", "T", 10, 22, 6, 3],
      ["site", "A", 2, 9, 6, 7],
      ["site", "B", 18, 9, 6, 7],
      ["floor", 2, 16, 3, 7],
      ["floor", 2, 22, 8, 2],
      ["floor", 21, 16, 3, 7],
      ["floor", 16, 22, 8, 2],
      ["floor", 11, 5, 4, 17],
      ["floor", 4, 4, 18, 2],
      ["floor", 4, 6, 2, 3],
      ["floor", 20, 6, 2, 3],
      ["floor", 8, 12, 3, 1],
      ["floor", 15, 12, 3, 1],
      ["cover", [4, 11], [6, 13], [20, 11], [22, 13], [12, 8], [13, 16], [3, 19], [22, 19], [9, 4], [16, 5]],
      ["pillar", [12, 8], [13, 8], [11, 16], [14, 16], [12, 12], [13, 12]],
    ],
  },
  {
    id: "stasiun",
    name: "Stasiun Joko",
    theme: { sky: 0xffd6a5, floor: 0xcfc9bd, wall: 0x8a5a44, cover: 0x4b6584, fog: 0xffe3c2 },
    ops: [
      ["spawn", "T", 1, 10, 3, 6],
      ["spawn", "D", 22, 10, 3, 6],
      ["site", "A", 16, 2, 7, 6],
      ["site", "B", 16, 18, 7, 6],
      ["floor", 4, 11, 15, 4],
      ["floor", 19, 12, 3, 2],
      ["floor", 3, 3, 13, 2],
      ["floor", 2, 5, 2, 5],
      ["floor", 3, 21, 13, 2],
      ["floor", 2, 16, 2, 5],
      ["floor", 22, 8, 2, 2],
      ["floor", 22, 16, 2, 2],
      ["floor", 12, 5, 2, 6],
      ["floor", 12, 15, 2, 6],
      ["cover", [8, 12], [15, 13], [6, 3], [10, 4], [18, 4], [20, 6], [6, 22], [10, 21], [18, 20], [20, 22]],
    ],
  },
  {
    id: "kampung",
    name: "Kampung Durian",
    theme: { sky: 0xb8f2c9, floor: 0xb7a07a, wall: 0x5f7f3f, cover: 0x9c6b3f, fog: 0xd2f5dc },
    ops: [
      ["spawn", "D", 18, 1, 6, 3],
      ["spawn", "T", 2, 22, 6, 3],
      ["site", "A", 9, 2, 8, 6],
      ["site", "B", 2, 8, 6, 7],
      ["floor", 17, 2, 1, 1],
      ["floor", 3, 15, 3, 7],
      ["floor", 8, 16, 12, 3],
      ["floor", 8, 19, 2, 4],
      ["floor", 12, 8, 3, 8],
      ["floor", 20, 4, 3, 15],
      ["floor", 8, 9, 4, 2],
      ["cover", [4, 10], [6, 12], [11, 4], [14, 6], [10, 17], [16, 17], [21, 10], [4, 18], [13, 11], [18, 17]],
    ],
  },
  {
    id: "pantai",
    name: "Pantai Jokomin",
    theme: { sky: 0x7fd3ff, floor: 0xf1dfa8, wall: 0x3e8fb0, cover: 0xe07a5f, fog: 0xc9ecff },
    ops: [
      ["spawn", "D", 10, 1, 6, 3],
      ["spawn", "T", 10, 22, 6, 3],
      ["site", "A", 1, 1, 7, 7],
      ["site", "B", 18, 1, 7, 7],
      ["floor", 2, 8, 22, 12],
      ["floor", 10, 20, 6, 2],
      ["floor", 12, 4, 2, 4],
      ["floor", 8, 2, 2, 1],
      ["floor", 16, 2, 2, 1],
      ["pillar", [6, 11], [19, 11], [12, 13], [9, 16], [16, 16], [12, 9], [13, 9]],
      ["cover", [4, 9], [21, 9], [8, 12], [17, 12], [12, 17], [13, 10], [3, 17], [22, 17]],
    ],
  },
];

RAW.push(
  {
    id: "terminal",
    name: "Terminal Bus",
    theme: { sky: 0xa7c7e7, floor: 0xbdb5a6, wall: 0x9a4f3f, cover: 0x3f7f6f, fog: 0xc8dbee },
    ops: [
      ["spawn", "D", 2, 1, 6, 3],
      ["spawn", "T", 18, 22, 6, 3],
      ["site", "A", 2, 10, 6, 6],
      ["site", "B", 17, 3, 7, 6],
      ["floor", 3, 4, 3, 6],
      ["floor", 8, 2, 9, 2],
      ["floor", 19, 9, 3, 13],
      ["floor", 8, 12, 11, 2],
      ["floor", 14, 14, 2, 6],
      ["floor", 6, 20, 13, 2],
      ["floor", 4, 16, 2, 5],
      ["floor", 11, 4, 2, 8],
      ["pillar", [20, 14], [7, 21], [13, 12]],
      ["cover", [4, 12], [6, 14], [19, 5], [22, 7], [12, 7], [16, 13], [10, 20], [15, 17], [20, 18], [9, 2]],
    ],
  },
  {
    id: "sawah",
    name: "Sawah Joko",
    theme: { sky: 0xbfe8ff, floor: 0x9fbf6a, wall: 0x6f5a3a, cover: 0xd8c27a, fog: 0xdaf2d0 },
    ops: [
      ["spawn", "T", 1, 10, 3, 6],
      ["spawn", "D", 22, 10, 3, 6],
      ["site", "A", 12, 2, 8, 5],
      ["site", "B", 12, 19, 8, 5],
      ["floor", 2, 4, 2, 6],
      ["floor", 4, 4, 8, 2],
      ["floor", 2, 16, 2, 6],
      ["floor", 4, 20, 8, 2],
      ["floor", 20, 4, 2, 2],
      ["floor", 22, 4, 2, 6],
      ["floor", 20, 20, 2, 2],
      ["floor", 22, 16, 2, 6],
      ["floor", 4, 11, 18, 4],
      ["floor", 15, 7, 2, 4],
      ["floor", 15, 15, 2, 4],
      ["pillar", [8, 12], [12, 13], [13, 11], [17, 12], [17, 13]],
      ["cover", [6, 11], [6, 14], [10, 12], [15, 13], [19, 11], [19, 14], [14, 4], [18, 3], [14, 21], [18, 20], [5, 4], [20, 21]],
    ],
  },
  {
    id: "pelabuhan",
    name: "Pelabuhan",
    theme: { sky: 0x8ec5e8, floor: 0x9c9488, wall: 0x2f4f6f, cover: 0xc0563b, fog: 0xbcdcf0 },
    ops: [
      ["spawn", "D", 10, 1, 6, 3],
      ["spawn", "T", 3, 22, 6, 3],
      ["site", "A", 2, 6, 7, 6],
      ["site", "B", 17, 8, 7, 7],
      ["floor", 10, 4, 2, 2],
      ["floor", 8, 6, 10, 2],
      ["floor", 4, 12, 3, 10],
      ["floor", 7, 18, 12, 2],
      ["floor", 7, 20, 2, 2],
      ["floor", 19, 15, 3, 5],
      ["floor", 12, 8, 2, 10],
      ["floor", 22, 15, 2, 8],
      ["floor", 14, 22, 8, 2],
      ["floor", 9, 22, 5, 1],
      ["pillar", [5, 16], [15, 18], [12, 12]],
      ["cover", [4, 8], [7, 10], [19, 10], [22, 12], [9, 6], [16, 7], [13, 15], [10, 19], [20, 17], [18, 23]],
    ],
  },
  {
    id: "kebun",
    name: "Kebun Teh",
    theme: { sky: 0xc5f0e0, floor: 0x7fa36a, wall: 0x4b6b3a, cover: 0xa58154, fog: 0xd8f5e8 },
    ops: [
      ["spawn", "D", 1, 9, 3, 6],
      ["spawn", "T", 22, 9, 3, 6],
      ["site", "A", 5, 2, 7, 5],
      ["site", "B", 5, 19, 7, 5],
      ["floor", 2, 5, 3, 4],
      ["floor", 2, 15, 3, 6],
      ["floor", 12, 3, 10, 2],
      ["floor", 19, 5, 3, 5],
      ["floor", 12, 20, 10, 2],
      ["floor", 19, 14, 3, 6],
      ["floor", 4, 11, 18, 3],
      ["floor", 8, 7, 2, 4],
      ["floor", 8, 14, 2, 5],
      ["pillar", [10, 12], [15, 11], [15, 13], [6, 12]],
      ["cover", [6, 4], [10, 3], [6, 21], [10, 22], [12, 12], [18, 12], [16, 3], [16, 21], [20, 7], [20, 16]],
    ],
  }
);

export const MAPS = Object.fromEntries(RAW.map((spec) => [spec.id, build(spec)]));
export const MAP_IDS = Object.keys(MAPS);

const WALKABLE = new Set([".", "A", "B", "T", "D"]);
export const isWalkable = (map, x, z) => z >= 0 && x >= 0 && z < map.height && x < map.width && WALKABLE.has(map.grid[z][x]);

export function siteAt(map, x, z) {
  const cell = map.grid[Math.floor(z / CELL)]?.[Math.floor(x / CELL)];
  return cell === "A" || cell === "B" ? cell : null;
}
