import { CELL } from "./shared/physics.js";
import { validMapPoint } from "./shared/deploy.js";
import { Minimap } from "./minimap.js";

// Kabut's laptop: a large map to pick spots on. Tap/click to add a spot (tap a spot again to remove
// it), then Deploy; Cancel closes without using anything. Text only via textContent.
export function createLaptop(root, { map, count, radius, title, ult, touch, positions, onDeploy, onCancel }) {
  const el = document.createElement("div");
  el.className = "fps-laptop";
  el.innerHTML = `
    <div class="fps-laptop-screen">
      <div class="fps-laptop-head"><strong data-title></strong><small data-hint></small></div>
      <div class="fps-laptop-map" data-map></div>
      <div class="fps-laptop-foot">
        <button type="button" class="fps-back" data-cancel>Cancel</button>
        <button type="button" class="fps-cta" data-deploy>Deploy</button>
      </div>
    </div>`;
  root.appendChild(el);
  const $ = (name) => el.querySelector(`[data-${name}]`);
  $("title").textContent = `💻 ${title}`;

  const size = Math.round(Math.min(window.innerHeight * (touch ? 0.62 : 0.6), window.innerWidth * 0.8, 520));
  const holder = $("map");
  holder.style.width = holder.style.height = `${size}px`;
  const minimap = new Minimap(holder, map, { size });
  minimap.canvas.classList.add("fps-laptop-canvas");
  const scale = size / Math.max(map.width, map.height);
  const picks = [];

  const hint = () => {
    $("hint").textContent = ult
      ? picks.length ? "Zone set · Deploy to arm the lasers (4.5 s warning)" : "Pick the laser zone"
      : `Pick up to ${count} spots${picks.length === 1 ? " · one spot = half cooldown" : ""} (${picks.length}/${count})`;
    $("deploy").disabled = !picks.length;
  };

  const marker = (p) => {
    const m = document.createElement("span");
    m.className = `fps-laptop-pick${ult ? " is-laser" : ""}`;
    const px = (radius / CELL) * scale * 2;
    m.style.width = m.style.height = `${px}px`;
    m.style.left = `${(p.x / CELL) * scale - px / 2}px`;
    m.style.top = `${(p.z / CELL) * scale - px / 2}px`;
    holder.appendChild(m);
    return m;
  };

  holder.addEventListener("click", (e) => {
    const rect = minimap.canvas.getBoundingClientRect();
    const p = { x: ((e.clientX - rect.left) / scale) * CELL, z: ((e.clientY - rect.top) / scale) * CELL };
    // Tapping near an existing pick removes it.
    const near = picks.findIndex((q) => Math.hypot(q.x - p.x, q.z - p.z) < radius);
    if (near >= 0) {
      picks[near].el.remove();
      picks.splice(near, 1);
    } else if (validMapPoint(map, p)) {
      if (picks.length >= count) {
        picks[0].el.remove();
        picks.shift();
      }
      picks.push({ ...p, el: marker(p) });
    }
    hint();
  });
  $("deploy").addEventListener("click", () => picks.length && onDeploy(picks.map(({ x, z }) => ({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }))));
  $("cancel").addEventListener("click", onCancel);
  const onKey = (e) => e.code === "Escape" && onCancel();
  document.addEventListener("keydown", onKey);

  // Live positions on the laptop.
  const timer = setInterval(() => {
    const p = positions();
    minimap.draw(performance.now(), { me: p.me, mates: p.mates, enemies: p.enemies, seen: p.seen, bomb: null });
  }, 100);
  hint();

  return {
    dispose() {
      clearInterval(timer);
      document.removeEventListener("keydown", onKey);
      minimap.dispose();
      el.remove();
    },
  };
}
