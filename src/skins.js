import { api, state, setPet } from "./api.js";
import { updateContext, showMessage } from "./components.js";
import { openModal, html, ui } from "./modal.js";
import { sprites, say, floatEmojis, expressionOf, burstFrom } from "./pet.js";
import { requireSession } from "./account.js";

// Accessories are drawn in sprite coordinates (200 x 314). Eyes ≈ y135, neck ≈ y205.
const ACCESSORIES = {
  sunglasses: `
    <rect x="50" y="118" width="46" height="32" rx="12" fill="#111827"/>
    <rect x="104" y="118" width="46" height="32" rx="12" fill="#111827"/>
    <rect x="93" y="127" width="14" height="6" rx="3" fill="#111827"/>
    <path d="M60 126h14M114 126h14" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>`,
  bow: `
    <g transform="translate(140 40) rotate(18)">
      <path d="M0 0L-26-16L-26 16Z" fill="#fb7185"/>
      <path d="M0 0L26-16L26 16Z" fill="#fb7185"/>
      <path d="M-20-8L-12 0L-20 8M20-8L12 0L20 8" stroke="#e11d48" stroke-width="2" fill="none"/>
      <circle r="7" fill="#e11d48"/>
    </g>`,
  bowtie: `
    <g transform="translate(100 206)">
      <path d="M0 0L-24-13L-24 13Z" fill="#1f2937"/>
      <path d="M0 0L24-13L24 13Z" fill="#1f2937"/>
      <rect x="-6" y="-7" width="12" height="14" rx="3" fill="#4b5563"/>
    </g>`,
  partyhat: `
    <defs>
      <linearGradient id="party-hat" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#a855f7"/>
      </linearGradient>
    </defs>
    <path d="M100 6L126 90H74Z" fill="url(#party-hat)"/>
    <path d="M88 48L112 40M82 68L118 58" stroke="#fde047" stroke-width="5" stroke-linecap="round"/>
    <circle cx="100" cy="6" r="9" fill="#fde047"/>`,
  headphones: `
    <path d="M34 152C26 44 174 44 166 152" stroke="#111827" stroke-width="11" fill="none" stroke-linecap="round"/>
    <rect x="16" y="126" width="30" height="54" rx="13" fill="#ef4444"/>
    <rect x="154" y="126" width="30" height="54" rx="13" fill="#ef4444"/>
    <rect x="22" y="136" width="8" height="34" rx="4" fill="#fca5a5"/>`,
  chefhat: `
    <circle cx="78" cy="52" r="22" fill="#fff" stroke="#e5e7eb" stroke-width="2"/>
    <circle cx="122" cy="52" r="22" fill="#fff" stroke="#e5e7eb" stroke-width="2"/>
    <circle cx="100" cy="38" r="26" fill="#fff" stroke="#e5e7eb" stroke-width="2"/>
    <rect x="68" y="58" width="64" height="34" rx="6" fill="#fff" stroke="#e5e7eb" stroke-width="2"/>
    <path d="M84 66v20M100 66v20M116 66v20" stroke="#e5e7eb" stroke-width="2"/>`,
  headband: `
    <rect x="30" y="96" width="140" height="16" rx="6" fill="#dc2626"/>
    <circle cx="100" cy="104" r="7" fill="#fbbf24"/>
    <path d="M168 102C186 96 196 108 194 122M168 108C182 114 186 128 178 138"
      stroke="#dc2626" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  wizardhat: `
    <path d="M58 94C82 70 94 30 118 -14C122 30 134 66 146 94Z" fill="#6d28d9"/>
    <ellipse cx="100" cy="94" rx="58" ry="11" fill="#5b21b6"/>
    <path d="M108 30l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#fde047"/>
    <circle cx="92" cy="64" r="3" fill="#fde047"/><circle cx="124" cy="72" r="2.5" fill="#fde047"/>`,
  crown: `
    <path d="M64 92V56L82 74L100 44L118 74L136 56V92Z" fill="#fbbf24" stroke="#b45309" stroke-width="3" stroke-linejoin="round"/>
    <rect x="64" y="84" width="72" height="10" rx="3" fill="#f59e0b"/>
    <circle cx="100" cy="66" r="6" fill="#ef4444"/><circle cx="80" cy="80" r="4" fill="#3b82f6"/><circle cx="120" cy="80" r="4" fill="#22c55e"/>`,
  halo: `<ellipse cx="100" cy="14" rx="36" ry="10" fill="none" stroke="#fde047" stroke-width="7"/>`,
  wings: `
    <path d="M40 200C-6 170-14 230 8 262C24 248 30 236 46 232Z" fill="#fff" stroke="#e0e7ff" stroke-width="3"/>
    <path d="M160 200C206 170 214 230 192 262C176 248 170 236 154 232Z" fill="#fff" stroke="#e0e7ff" stroke-width="3"/>`,
};

// "tint" skins have recolored sprites in /asset/skins/<id>/ (see server/scripts/generate-skin-sprites.js).
const SKIN_STYLES = {
  classic: { emoji: "🐰" },
  cool: { emoji: "😎", over: ["sunglasses"] },
  sweet: { emoji: "🍓", tint: true, over: ["bow"] },
  dapper: { emoji: "🎩", over: ["bowtie"] },
  party: { emoji: "🥳", tint: true, over: ["partyhat"] },
  dj: { emoji: "🎧", tint: true, over: ["headphones"] },
  chef: { emoji: "👨‍🍳", over: ["chefhat"] },
  ninja: { emoji: "🥷", tint: true, over: ["headband"] },
  wizard: { emoji: "🧙", tint: true, over: ["wizardhat"] },
  royal: { emoji: "👑", tint: true, over: ["crown"] },
  angel: { emoji: "😇", tint: true, over: ["halo"], under: ["wings"], glow: true },
};

let currentSkin = "classic";

const layerMarkup = (parts = []) => parts.map((p) => ACCESSORIES[p]).join("");

function spritePath(skinId, expression) {
  return SKIN_STYLES[skinId]?.tint ? `/asset/skins/${skinId}/${expression}.png` : `/asset/char/${expression}.png`;
}

function syncSpriteImage(img, skinId) {
  const expression = expressionOf(img);
  if (!expression) return;
  const next = spritePath(skinId, expression);
  if (img.getAttribute("src") !== next) img.setAttribute("src", next);
}

// Sprites with a fixed skin (an opponent's Joko) keep it instead of following the player's skin.
const skinFor = (img) => img.closest(".pet-sprite")?.dataset.fixedSkin || currentSkin;

function watchSpriteImage(img) {
  if (img._skinObserver) return;
  img._skinObserver = new MutationObserver(() => syncSpriteImage(img, skinFor(img)));
  img._skinObserver.observe(img, { attributes: true, attributeFilter: ["src"] });
}

function dressSprite(sprite, skinId) {
  const style = SKIN_STYLES[skinId] ?? SKIN_STYLES.classic;
  sprite.dataset.skin = skinId;
  syncSpriteImage(sprite.querySelector("img"), skinId);
  sprite.querySelector(".pet-layer--over").innerHTML = layerMarkup(style.over);
  sprite.querySelector(".pet-layer--under").innerHTML = layerMarkup(style.under);
  sprite.querySelector(".pet-layer--over").classList.toggle("pet-glow", !!style.glow);
}

export function applySkin(skinId) {
  currentSkin = SKIN_STYLES[skinId] ? skinId : "classic";
  for (const sprite of sprites()) {
    watchSpriteImage(sprite.querySelector("img"));
    if (!sprite.dataset.fixedSkin) dressSprite(sprite, currentSkin);
  }
}

export function dressFixedSkin(sprite, skinId) {
  if (!sprite?.querySelector("img")) return;
  sprite.dataset.fixedSkin = SKIN_STYLES[skinId] ? skinId : "classic";
  watchSpriteImage(sprite.querySelector("img"));
  dressSprite(sprite, sprite.dataset.fixedSkin);
}

function previewSprite(skinId) {
  const sprite = html(`
    <div class="pet-sprite mx-auto" style="height: 7rem">
      <svg class="pet-layer pet-layer--under" viewBox="0 0 200 314" aria-hidden="true"></svg>
      <img src="/asset/char/idle.png" alt="">
      <svg class="pet-layer pet-layer--over" viewBox="0 0 200 314" aria-hidden="true"></svg>
    </div>`);
  dressSprite(sprite, skinId);
  return sprite;
}

function skinCard(skin, coin, onAction) {
  const card = html(`
    <div class="rounded-2xl p-3 text-center border-2 transition">
      <div data-preview class="pt-6 pb-1"></div>
      <p data-name class="font-semibold text-gray-800 text-sm truncate"></p>
      <button type="button" data-action class="mt-2 w-full py-2 rounded-xl text-sm font-bold"></button>
    </div>`);
  card.querySelector("[data-preview]").appendChild(previewSprite(skin.id));
  card.querySelector("[data-name]").textContent = `${SKIN_STYLES[skin.id]?.emoji ?? ""} ${skin.name}`;
  const button = card.querySelector("[data-action]");

  if (skin.equipped) {
    card.classList.add("border-purple-400", "bg-purple-50");
    button.textContent = "Equipped";
    button.disabled = true;
    button.classList.add("bg-purple-200", "text-purple-700");
  } else if (skin.owned) {
    card.classList.add("border-gray-100");
    button.textContent = "Equip";
    button.classList.add("bg-purple-500", "text-white", "hover:bg-purple-600");
    button.addEventListener("click", () => onAction("equip", skin));
  } else {
    card.classList.add("border-gray-100");
    button.textContent = `🪙 ${skin.price.toLocaleString()}`;
    const affordable = coin >= skin.price;
    button.disabled = !affordable;
    button.classList.add(...(affordable
      ? ["bg-gradient-to-r", "from-yellow-400", "to-orange-500", "text-white", "hover:opacity-90"]
      : ["bg-gray-100", "text-gray-400", "cursor-not-allowed"]));
    button.addEventListener("click", () => onAction("buy", skin));
  }
  return card;
}

function renderShop(view, data) {
  view.querySelector("[data-coin]").textContent = data.coin.toLocaleString();
  const grid = view.querySelector("[data-grid]");
  grid.replaceChildren(...data.skins.map((skin) => skinCard(skin, data.coin, (action, s) => onAction(view, action, s))));
}

async function onAction(view, action, skin) {
  const res = await api(`/api/skins/${action}`, { skinId: skin.id });
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    return;
  }
  if (res.pet) setPet(res.pet);
  state.user.skin = res.equipped;
  applySkin(res.equipped);
  updateContext();
  renderShop(view, res);
  if (action === "buy") {
    showMessage(`New skin unlocked: ${skin.name}!`, "success", 2000, true);
    say("charMain", "Keren kan? ✨", 1800);
    burstFrom("charMain", "stars");
    floatEmojis("charMain", ["✨", "⭐", "💖"], 6);
  }
}

async function openShop() {
  if (!(await requireSession())) return;
  const view = html(`
    <div>
      <h2 class="${ui.title}">👕 Skin Shop</h2>
      <p class="${ui.subtitle}">Your coins: 🪙 <span data-coin>-</span></p>
      <div data-grid class="grid grid-cols-2 gap-3"></div>
    </div>`);
  openModal(view);
  const data = await api("/api/skins");
  if (data.error) {
    view.querySelector("[data-grid]").textContent = data.error;
    return;
  }
  renderShop(view, data);
}

export function initSkins() {
  const toolbar = document.querySelector("[data-open-leaderboard]")?.parentElement;
  if (toolbar) {
    const button = html(`<button type="button" aria-label="Skin shop"
      class="h-12 w-12 rounded-full bg-white/90 text-xl shadow-lg hover:bg-white">👕</button>`);
    button.addEventListener("click", openShop);
    toolbar.insertBefore(button, toolbar.children[1]);
  }
  window.addEventListener("session:changed", () => applySkin(state.user?.skin ?? "classic"));
}
