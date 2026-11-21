import { CELL } from "./physics.js";

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
  const center = ({ x, z }) => ({ x: (x + 0.5) * CELL, z: (z + 0.5) * CELL });
  return {
    id,
    name,
    theme,
    width,
    height,
    grid: grid.map((row) => row.join("")),
    spawns: { attack: cells("T").map(center), defend: cells("D").map(center) },
    sites: { A: cells("A"), B: cells("B") },
  };
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
      ["pillar", [6, 11], [19, 11], [12, 13], [9, 16], [16, 16]],
      ["cover", [4, 9], [21, 9], [8, 12], [17, 12], [12, 17], [13, 10], [3, 17], [22, 17]],
    ],
  },
];

export const MAPS = Object.fromEntries(RAW.map((spec) => [spec.id, build(spec)]));
export const MAP_IDS = Object.keys(MAPS);

const WALKABLE = new Set([".", "A", "B", "T", "D"]);
export const isWalkable = (map, x, z) => z >= 0 && x >= 0 && z < map.height && x < map.width && WALKABLE.has(map.grid[z][x]);

export function siteAt(map, x, z) {
  const cell = map.grid[Math.floor(z / CELL)]?.[Math.floor(x / CELL)];
  return cell === "A" || cell === "B" ? cell : null;
}
