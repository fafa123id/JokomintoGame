import { WEAPONS, SHOP, ARMOR } from "./shared/weapons.js";

// Buy menu. Bomb: spend credits during the buy phase; click something you bought this round to
// sell it back. Team Deathmatch: a free loadout picker used from your next spawn.
const ICONS = { pistol: "🔫", revolver: "🤠", smg: "🐝", shotgun: "💥", rifle: "🎯", lmg: "⚙️", sniper: "🔭" };
const fireMode = (w) => (w.pellets ? `${w.pellets} pellets` : w.burst ? `${w.burst}-round burst` : w.auto ? "Auto" : "Semi");

export function createShop(root, { mode, onBuy, onSell, onClose }) {
  const tdm = mode === "tdm";
  const el = document.createElement("div");
  el.className = "fps-shop";
  el.innerHTML = `
    <div class="fps-shop-card">
      <div class="fps-shop-head">
        <strong>${tdm ? "🎒 Loadout" : "🛒 Shop"}</strong>
        <span data-credits></span>
        <button type="button" class="fps-shop-close" data-close aria-label="Close">✕</button>
      </div>
      <small class="fps-shop-hint">${tdm ? "Everything is free · used from your next spawn" : "Click to buy · click again to sell (this round only) · B or Esc to close"}</small>
      <div class="fps-shop-grid" data-grid></div>
    </div>`;
  root.appendChild(el);
  const $ = (name) => el.querySelector(`[data-${name}]`);
  const cards = new Map();

  const card = (id, title, sub, price, icon) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fps-shop-item";
    b.dataset.item = id;
    const i = document.createElement("span");
    i.className = "fps-shop-icon";
    i.textContent = icon;
    const t = document.createElement("strong");
    t.textContent = title;
    const s = document.createElement("small");
    s.textContent = sub;
    const p = document.createElement("em");
    p.textContent = tdm ? "" : price ? `💰 ${price}` : "Free";
    b.append(i, t, s, p);
    b.addEventListener("click", () => {
      const state = cards.get(id).state;
      if (state === "sell") onSell(id);
      else onBuy(id);
    });
    cards.set(id, { el: b, state: "" });
    return b;
  };

  for (const section of SHOP) {
    const col = document.createElement("div");
    col.className = "fps-shop-col";
    const h = document.createElement("h4");
    h.textContent = section.name;
    col.appendChild(h);
    for (const id of section.items) {
      const w = WEAPONS[id];
      col.appendChild(card(id, w.name, `${w.category} · ${fireMode(w)} · ${w.damage}${w.pellets ? "×" + w.pellets : ""} dmg`, w.price, ICONS[w.family]));
    }
    $("grid").appendChild(col);
  }
  if (!tdm) {
    const col = document.createElement("div");
    col.className = "fps-shop-col";
    const h = document.createElement("h4");
    h.textContent = "Armor";
    col.appendChild(h);
    for (const a of Object.values(ARMOR)) col.appendChild(card(a.id, a.name, `+${a.points} armor · soaks 2/3 of each hit`, a.price, "🦺"));
    $("grid").appendChild(col);
  }
  $("close").addEventListener("click", onClose);
  const onKey = (e) => {
    if (e.code === "Escape" || (e.code === "KeyB" && !e.repeat)) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  document.addEventListener("keydown", onKey, true);

  return {
    el,
    // state: { credits, armor, purchases, slots, loadout }
    update(state) {
      $("credits").textContent = tdm ? "" : `💰 ${state.credits ?? 0}`;
      for (const [id, c] of cards) {
        const armor = ARMOR[id];
        const owned = armor ? state.armor >= armor.points : tdm ? state.loadout?.[WEAPONS[id].slot] === id : state.slots?.[WEAPONS[id].slot] === id;
        const bought = state.purchases?.includes(id);
        const price = armor ? armor.price : WEAPONS[id].price;
        c.state = bought && !tdm ? "sell" : owned ? "owned" : "";
        c.el.classList.toggle("is-owned", owned);
        c.el.classList.toggle("is-sell", c.state === "sell");
        c.el.disabled = !tdm && !owned && !bought && (state.credits ?? 0) < price;
        c.el.querySelector("em").textContent = tdm ? (owned ? "Equipped" : "") : c.state === "sell" ? `Sell +${price}` : owned ? "Owned" : price ? `💰 ${price}` : "Free";
      }
    },
    dispose() {
      document.removeEventListener("keydown", onKey, true);
      el.remove();
    },
  };
}

export const WEAPON_ICONS = ICONS;
