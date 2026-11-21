// Movement, collision, ray casts and hitboxes shared by the server and the browser.
// The same code runs on both sides, so client-side prediction matches the server exactly.

export const CELL = 3;
export const WALL_HEIGHT = 4;
export const COVER_HEIGHT = 1.1;

export const PLAYER = {
  radius: 0.35,
  height: 1.75,
  crouchHeight: 1.3,
  eye: 1.6,
  crouchEye: 1.15,
  speed: 5.4,
  walkSpeed: 2.7,
  crouchSpeed: 2.3,
  airControl: 0.35,
  gravity: 20,
  jump: 6.2,
  maxHealth: 100,
};

// Input bit flags.
export const KEY = { FORWARD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, CROUCH: 32, WALK: 64 };

const SOLID = new Set(["#", "="]);

export function cellAt(map, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) return "#";
  return map.grid[cz][cx];
}

export const isSolid = (map, cx, cz) => SOLID.has(cellAt(map, cx, cz));
export const toCell = (v) => Math.floor(v / CELL);

// Axis-aligned square footprint against solid cells.
export function collides(map, x, z, r = PLAYER.radius) {
  const minX = toCell(x - r);
  const maxX = toCell(x + r);
  const minZ = toCell(z - r);
  const maxZ = toCell(z + r);
  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) if (isSolid(map, cx, cz)) return true;
  }
  return false;
}

// Camera convention (three.js): yaw rotates around Y, forward is (-sin yaw, -cos yaw).
export function forwardOf(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function createBody(x, z, yaw = 0) {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, grounded: true, crouch: false };
}

// One fixed simulation step. dt is in seconds.
export function step(map, body, keys, yaw, pitch, dt, { frozen = false } = {}) {
  body.yaw = yaw;
  body.pitch = Math.max(-1.45, Math.min(1.45, pitch));
  body.crouch = !!(keys & KEY.CROUCH);

  let ix = 0;
  let iz = 0;
  if (!frozen) {
    const f = forwardOf(yaw);
    const r = { x: -f.z, z: f.x };
    if (keys & KEY.FORWARD) (ix += f.x), (iz += f.z);
    if (keys & KEY.BACK) (ix -= f.x), (iz -= f.z);
    if (keys & KEY.RIGHT) (ix += r.x), (iz += r.z);
    if (keys & KEY.LEFT) (ix -= r.x), (iz -= r.z);
  }
  const len = Math.hypot(ix, iz);
  if (len > 0) (ix /= len), (iz /= len);

  const speed = body.crouch ? PLAYER.crouchSpeed : keys & KEY.WALK ? PLAYER.walkSpeed : PLAYER.speed;
  if (body.grounded) {
    body.vx = ix * speed;
    body.vz = iz * speed;
  } else {
    body.vx += (ix * speed - body.vx) * PLAYER.airControl * dt * 6;
    body.vz += (iz * speed - body.vz) * PLAYER.airControl * dt * 6;
  }

  const nx = body.x + body.vx * dt;
  if (!collides(map, nx, body.z)) body.x = nx;
  else body.vx = 0;
  const nz = body.z + body.vz * dt;
  if (!collides(map, body.x, nz)) body.z = nz;
  else body.vz = 0;

  if (!frozen && keys & KEY.JUMP && body.grounded && !body.crouch) {
    body.vy = PLAYER.jump;
    body.grounded = false;
  }
  body.vy -= PLAYER.gravity * dt;
  body.y += body.vy * dt;
  if (body.y <= 0) {
    body.y = 0;
    body.vy = 0;
    body.grounded = true;
  }
  return body;
}

export const eyeHeight = (body) => body.y + (body.crouch ? PLAYER.crouchEye : PLAYER.eye);

export function aimDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

// Head, body and legs boxes; damage depends on which one a shot hits first.
export function hitboxes(body) {
  const h = body.crouch ? PLAYER.crouchHeight : PLAYER.height;
  const y = body.y;
  const legs = h * 0.45;
  const head = 0.32;
  const box = (part, half, y0, y1) => ({
    part,
    min: { x: body.x - half, y: y + y0, z: body.z - half },
    max: { x: body.x + half, y: y + y1, z: body.z + half },
  });
  return [box("head", 0.17, h - head, h), box("body", 0.3, legs, h - head), box("legs", 0.24, 0, legs)];
}

// Slab test; returns the entry distance or null.
export function rayBox(o, d, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (const axis of ["x", "y", "z"]) {
    if (Math.abs(d[axis]) < 1e-9) {
      if (o[axis] < min[axis] || o[axis] > max[axis]) return null;
      continue;
    }
    let t1 = (min[axis] - o[axis]) / d[axis];
    let t2 = (max[axis] - o[axis]) / d[axis];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

// Distance from o along d (unit vector) to the first wall, cover or floor; capped at maxDist.
export function rayWorld(map, o, d, maxDist) {
  let best = maxDist;
  if (d.y < 0) best = Math.min(best, -o.y / d.y);

  let cx = toCell(o.x);
  let cz = toCell(o.z);
  const stepX = d.x > 0 ? 1 : -1;
  const stepZ = d.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(d.x) < 1e-9 ? Infinity : CELL / Math.abs(d.x);
  const tDeltaZ = Math.abs(d.z) < 1e-9 ? Infinity : CELL / Math.abs(d.z);
  let tMaxX = Math.abs(d.x) < 1e-9 ? Infinity : ((d.x > 0 ? (cx + 1) * CELL : cx * CELL) - o.x) / d.x;
  let tMaxZ = Math.abs(d.z) < 1e-9 ? Infinity : ((d.z > 0 ? (cz + 1) * CELL : cz * CELL) - o.z) / d.z;
  let tEnter = 0;

  for (let i = 0; i < 256 && tEnter < best; i++) {
    const tExit = Math.min(tMaxX, tMaxZ);
    const cell = cellAt(map, cx, cz);
    if (cell === "#" || cell === "=") {
      const top = cell === "#" ? WALL_HEIGHT : COVER_HEIGHT;
      const yIn = o.y + d.y * tEnter;
      const yOut = o.y + d.y * Math.min(tExit, best);
      if (yIn <= top && yIn >= 0) return Math.min(best, tEnter);
      if (yIn > top && yOut <= top && d.y < 0) {
        const t = (top - o.y) / d.y;
        if (t >= tEnter && t <= tExit) return Math.min(best, t);
      }
      if (cell === "#" && tEnter === 0) return 0;
    }
    tEnter = tExit;
    if (tMaxX < tMaxZ) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cz += stepZ;
      tMaxZ += tDeltaZ;
    }
  }
  return best;
}

// True when nothing solid blocks the straight line between two points.
export function lineOfSight(map, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const d = { x: dx / dist, y: dy / dist, z: dz / dist };
  return rayWorld(map, a, d, dist) >= dist - 0.05;
}
