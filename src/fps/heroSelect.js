import { HEROES, ROLES, heroById } from "./shared/heroes.js";

// Hero select overlay: your team's picks on the left, the ten heroes by role in the middle, a
// lock button below. Only your own team is ever shown. Text goes through textContent.
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

export function createHeroSelect(root, { meId, onHover, onLock, onUnlock }) {
  const el = document.createElement("div");
  el.className = "fps-pick";
  el.innerHTML = `
    <div class="fps-pick-head">
      <div><strong>Choose your hero</strong><small>One of each per team · enemy picks are hidden</small></div>
      <span class="fps-pick-timer" data-timer>20</span>
    </div>
    <div class="fps-pick-body">
      <ul class="fps-pick-team" data-team></ul>
      <div class="fps-pick-grid" data-grid></div>
    </div>
    <div class="fps-pick-foot">
      <div class="fps-pick-detail" data-detail></div>
      <button type="button" class="fps-cta" data-lock>Lock in</button>
    </div>`;
  root.appendChild(el);
  const $ = (name) => el.querySelector(`[data-${name}]`);
  let state = null;
  let timer = null;

  // Grid: one column per role, two heroes each.
  const cards = new Map();
  for (const [roleId, role] of Object.entries(ROLES)) {
    const col = document.createElement("div");
    col.className = "fps-pick-role";
    const label = document.createElement("small");
    label.textContent = `${role.icon} ${role.name}`;
    col.appendChild(label);
    for (const hero of HEROES.filter((h) => h.role === roleId)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "fps-hero";
      card.style.setProperty("--hero", hex(hero.color));
      const icon = document.createElement("span");
      icon.className = "fps-hero-icon";
      icon.textContent = hero.icon;
      const name = document.createElement("strong");
      name.textContent = hero.name;
      const tag = document.createElement("em");
      card.append(icon, name, tag);
      card.addEventListener("click", () => onHover(hero.id));
      card.addEventListener("dblclick", () => onLock(hero.id));
      col.appendChild(card);
      cards.set(hero.id, { card, tag });
    }
    $("grid").appendChild(col);
  }

  $("lock").addEventListener("click", () => {
    const me = state?.team.find((p) => p.id === meId);
    if (!me) return;
    if (me.locked) onUnlock();
    else if (me.hover) onLock(me.hover);
  });

  const tick = () => {
    if (!state) return;
    $("timer").textContent = Math.max(0, Math.ceil((state.ends - Date.now() - (state.offset ?? 0)) / 1000));
  };

  function render() {
    const me = state.team.find((p) => p.id === meId);
    // Teammates column.
    $("team").replaceChildren(
      ...state.team.map((p) => {
        const li = document.createElement("li");
        const hero = heroById(p.hero ?? p.hover);
        li.className = `${p.locked ? "is-locked" : ""}${p.id === meId ? " is-me" : ""}`;
        if (hero) li.style.setProperty("--hero", hex(hero.color));
        const icon = document.createElement("span");
        icon.className = "fps-hero-icon";
        icon.textContent = hero?.icon ?? "?";
        const text = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = `${p.name}${p.id === meId ? " (you)" : ""}${p.bot ? " 🤖" : ""}`;
        const status = document.createElement("small");
        status.textContent = hero ? `${hero.name} · ${p.locked ? "LOCKED" : "picking..."}` : "picking...";
        text.append(name, status);
        li.append(icon, text);
        return li;
      })
    );
    // Hero cards: mine, teammates' locks (unavailable) and teammates' hovers.
    for (const [id, { card, tag }] of cards) {
      const lockedBy = state.team.find((p) => p.locked && p.hero === id && p.id !== meId);
      const hoveredBy = state.team.filter((p) => !p.locked && p.hover === id && p.id !== meId);
      const humanLock = lockedBy && !lockedBy.bot;
      card.classList.toggle("is-mine", me?.hover === id);
      card.classList.toggle("is-locked", !!me?.locked && me.hero === id);
      card.classList.toggle("is-taken", !!humanLock);
      card.disabled = !!humanLock || !!me?.locked;
      tag.textContent = lockedBy ? `🔒 ${lockedBy.name}` : hoveredBy.length ? hoveredBy.map((p) => p.name).join(", ") : "";
    }
    const hero = heroById(me?.hover);
    const detail = $("detail");
    if (!hero) detail.textContent = "Pick a hero (double-click to lock)";
    else {
      const line = (cls, text) => {
        const div = document.createElement("div");
        div.className = cls;
        div.textContent = text;
        return div;
      };
      detail.replaceChildren(
        line("fps-pick-name", `${hero.icon} ${hero.name} · ${ROLES[hero.role].name}`),
        line("fps-pick-ab", `${hero.skill.icon} [Z] ${hero.skill.name}: ${hero.skill.desc}`),
        line("fps-pick-ab", `${hero.ult.icon} [X] ${hero.ult.name}: ${hero.ult.desc}`),
        line("fps-pick-counter", `Countered by: ${hero.counter}`)
      );
    }
    const lock = $("lock");
    lock.textContent = me?.locked ? "Unlock" : "Lock in";
    lock.disabled = !me?.hover;
    lock.classList.toggle("is-unlock", !!me?.locked);
    tick();
  }

  return {
    el,
    update(pick, offset = 0) {
      state = { ...pick, offset };
      el.hidden = false;
      timer ??= setInterval(tick, 250);
      render();
    },
    hide() {
      el.hidden = true;
      clearInterval(timer);
      timer = null;
    },
    dispose() {
      clearInterval(timer);
      el.remove();
    },
  };
}
