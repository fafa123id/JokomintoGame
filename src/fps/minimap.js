import { CELL } from "./shared/physics.js";

// North-up minimap. The layout is drawn once; players are redrawn a few times per second.
// Enemies appear only while the server says a teammate can see them, then fade out briefly.
const COLORS = { wall: "#1f2937", cover: "#6b7280", floor: "rgba(255,255,255,0.16)", A: "rgba(245,158,11,0.45)", B: "rgba(139,92,246,0.45)" };
const FADE_MS = 1500;
const DRAW_MS = 66;

export class Minimap {
  constructor(container, map, { size }) {
    this.map = map;
    this.size = size;
    this.scale = size / Math.max(map.width, map.height);
    this.canvas = document.createElement("canvas");
    this.canvas.className = "fps-minimap";
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.canvas.height = Math.round(size * ratio);
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.ctx = this.canvas.getContext("2d");
    this.ctx.scale(ratio, ratio);
    container.appendChild(this.canvas);
    this.lastSeen = new Map();
    this.lastDraw = 0;
    this.layout = this.drawLayout(ratio);
  }

  drawLayout(ratio) {
    const { map, scale, size } = this;
    const layer = document.createElement("canvas");
    layer.width = layer.height = Math.round(size * ratio);
    const ctx = layer.getContext("2d");
    ctx.scale(ratio, ratio);
    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        const c = map.grid[z][x];
        ctx.fillStyle = c === "#" ? COLORS.wall : c === "=" ? COLORS.cover : COLORS[c] ?? COLORS.floor;
        ctx.fillRect(x * scale, z * scale, scale + 0.5, scale + 0.5);
      }
    }
    ctx.font = `bold ${Math.round(scale * 2.2)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const site of ["A", "B"]) {
      const cells = map.sites[site];
      const cx = cells.reduce((s, c) => s + c.x + 0.5, 0) / cells.length;
      const cz = cells.reduce((s, c) => s + c.z + 0.5, 0) / cells.length;
      ctx.fillText(site, cx * scale, cz * scale);
    }
    return layer;
  }

  toPx(x, z) {
    return [(x / CELL) * this.scale, (z / CELL) * this.scale];
  }

  dot(x, z, color, radius, yaw = null) {
    const ctx = this.ctx;
    const [px, pz] = this.toPx(x, z);
    if (yaw !== null) {
      // View cone in the facing direction (forward is -sin(yaw), -cos(yaw)).
      const a = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
      ctx.fillStyle = color.replace(/[\d.]+\)$/, "0.22)");
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.arc(px, pz, radius * 4.5, a - 0.55, a + 0.55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, pz, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // me: {x, z, yaw}; mates/enemies: [{id, x, z, yaw}]; seen: Set of enemy ids; bomb: {x, z, planted} | null
  draw(now, { me, mates, enemies, seen, bomb, smokes = [] }) {
    if (now - this.lastDraw < DRAW_MS) return;
    this.lastDraw = now;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.drawImage(this.layout, 0, 0, this.size, this.size);

    ctx.fillStyle = "rgba(203,213,225,0.55)";
    for (const s of smokes) {
      const [px, pz] = this.toPx(s.x, s.z);
      ctx.beginPath();
      ctx.arc(px, pz, (s.r / CELL) * this.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const e of enemies) if (seen.has(e.id)) this.lastSeen.set(e.id, { x: e.x, z: e.z, at: now });
    for (const [id, spot] of this.lastSeen) {
      const age = now - spot.at;
      if (age > FADE_MS) {
        this.lastSeen.delete(id);
        continue;
      }
      const live = seen.has(id);
      const enemy = live ? enemies.find((e) => e.id === id) : null;
      const pos = enemy ?? spot;
      this.dot(pos.x, pos.z, `rgba(248,113,113,${live ? 1 : Math.max(0.15, 1 - age / FADE_MS)})`, this.scale * 0.55);
    }

    if (bomb) {
      const [px, pz] = this.toPx(bomb.x, bomb.z);
      const pulse = bomb.planted ? 0.6 + 0.4 * Math.sin(now / 120) : 1;
      ctx.fillStyle = `rgba(239,68,68,${pulse})`;
      ctx.fillRect(px - this.scale * 0.45, pz - this.scale * 0.45, this.scale * 0.9, this.scale * 0.9);
    }
    for (const m of mates) this.dot(m.x, m.z, "rgba(96,165,250,1)", this.scale * 0.5, m.yaw);
    if (me) this.dot(me.x, me.z, "rgba(253,224,71,1)", this.scale * 0.6, me.yaw);
  }

  dispose() {
    this.canvas.remove();
  }
}
