import { aimDirection, rayWorld, cellAt, toCell, forwardOf, WALL_HEIGHT, COVER_HEIGHT, PLAYER } from "./physics.js";

// Placement maths shared by the server (where things really go) and the client (the preview),
// so what you see before deploying is exactly what you get.

// Where an aim lands on the floor: the first wall/floor hit within range (pulled back a little),
// otherwise the point at range, dropped to the ground.
export function deployPoint(map, body, yaw, pitch, range) {
  const eye = { x: body.x, y: body.y + (body.crouch ? PLAYER.crouchEye : PLAYER.eye), z: body.z };
  const dir = aimDirection(yaw, pitch);
  const t = Math.max(0, Math.min(range, rayWorld(map, eye, dir, range)) - 0.3);
  return { x: eye.x + dir.x * t, y: 0, z: eye.z + dir.z * t };
}

// A wall or barrier of `length` across the aim direction, snapped to the grid axes.
export function deployWall(map, body, yaw, pitch, { length, range }, thick = 0.25, height = 3) {
  const at = deployPoint(map, body, yaw, Math.min(pitch, -0.05), range);
  const f = forwardOf(yaw);
  const alongX = Math.abs(f.z) > Math.abs(f.x);
  const half = length / 2;
  return alongX
    ? { x0: at.x - half, x1: at.x + half, z0: at.z - thick, z1: at.z + thick, h: height }
    : { x0: at.x - thick, x1: at.x + thick, z0: at.z - half, z1: at.z + half, h: height };
}

// Is something solid at this height? Crates are COVER_HEIGHT tall, walls taller; blocks have h.
export function solidAt(map, x, y, z) {
  const c = cellAt(map, toCell(x), toCell(z));
  if (c === "#") return y < WALL_HEIGHT;
  if (c === "=") return y < COVER_HEIGHT;
  return (map.blocks ?? []).some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y < b.h);
}

export const GRENADE = { speed: 17, lift: 2, gravity: 14, fuse: 1.6, step: 0.05 };

export function grenadeStart(body, yaw, pitch) {
  const dir = aimDirection(yaw, pitch + 0.15);
  const eye = body.y + (body.crouch ? PLAYER.crouchEye : PLAYER.eye);
  return { x: body.x + dir.x * 0.6, y: eye, z: body.z + dir.z * 0.6, vx: dir.x * GRENADE.speed, vy: dir.y * GRENADE.speed + GRENADE.lift, vz: dir.z * GRENADE.speed };
}

// One flight step: gravity, bounces off walls, crates and the floor.
export function grenadeStep(map, g, dt) {
  g.vy -= GRENADE.gravity * dt;
  const nx = g.x + g.vx * dt;
  const ny = g.y + g.vy * dt;
  const nz = g.z + g.vz * dt;
  if (solidAt(map, nx, g.y, g.z)) g.vx *= -0.4;
  else g.x = nx;
  if (solidAt(map, g.x, g.y, nz)) g.vz *= -0.4;
  else g.z = nz;
  if (ny <= 0.1) {
    g.y = 0.1;
    g.vy = Math.abs(g.vy) * 0.35;
    g.vx *= 0.6;
    g.vz *= 0.6;
  } else g.y = ny;
  return g;
}

// The whole flight until the fuse runs out, for the throw preview.
export function grenadePath(map, body, yaw, pitch) {
  const g = grenadeStart(body, yaw, pitch);
  const points = [{ x: g.x, y: g.y, z: g.z }];
  for (let t = 0; t < GRENADE.fuse; t += GRENADE.step) {
    grenadeStep(map, g, GRENADE.step);
    points.push({ x: g.x, y: g.y, z: g.z });
  }
  return points;
}

// A map point is usable when it's on open floor inside the map.
export function validMapPoint(map, p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  const c = cellAt(map, toCell(p.x), toCell(p.z));
  return c !== "#" && c !== "=";
}
