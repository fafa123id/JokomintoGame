const SPRITE_IDS = ["charMain", "charHome", "charTebakKata", "charTebakGambar", "charXox"];
const REACTION_CLASSES = ["pet-squish", "pet-dizzy", "pet-chomp", "pet-wash", "pet-jump", "pet-shake", "pet-think"];
const SVG_NS = "http://www.w3.org/2000/svg";
const SPRITE_PATH = /\/asset\/(?:char|skins\/[a-z]+)\/(\w+)\.png$/;

export function expressionOf(img) {
  return img.getAttribute("src")?.match(SPRITE_PATH)?.[1] ?? null;
}

// Only touches src when the expression actually changes (skins rewrite the path).
export function setExpression(img, expression) {
  if (img && expressionOf(img) !== expression) img.src = `/asset/char/${expression}.png`;
}

function layer(className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 200 314");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

function mountSprite(img) {
  if (img.parentElement?.classList.contains("pet-sprite")) return img.parentElement;
  const wrapper = document.createElement("div");
  wrapper.className = "pet-sprite pet-idle";
  if (img.classList.contains("animate-bounce")) {
    img.classList.remove("animate-bounce");
    wrapper.classList.add("animate-bounce");
    wrapper.classList.remove("pet-idle");
  }
  img.classList.remove("max-w-full", "max-h-full");
  img.replaceWith(wrapper);
  wrapper.append(layer("pet-layer pet-layer--under"), img, layer("pet-layer pet-layer--over"));

  const bubble = document.createElement("div");
  bubble.className = "pet-bubble";
  wrapper.appendChild(bubble);
  return wrapper;
}

export function sprites() {
  return SPRITE_IDS.map((id) => document.getElementById(id)?.parentElement).filter((el) => el?.classList.contains("pet-sprite"));
}

export function spriteOf(imgId) {
  const parent = document.getElementById(imgId)?.parentElement;
  return parent?.classList.contains("pet-sprite") ? parent : null;
}

export function react(imgId, className, durationMs = 1000) {
  const sprite = spriteOf(imgId);
  if (!sprite) return;
  sprite.classList.remove(...REACTION_CLASSES);
  void sprite.offsetWidth;
  sprite.classList.add(className);
  sprite._pet3d?.play(className, durationMs);
  clearTimeout(sprite._reactionTimer);
  if (durationMs > 0) {
    sprite._reactionTimer = setTimeout(() => sprite.classList.remove(className), durationMs);
  }
}

export function stopReaction(imgId) {
  const sprite = spriteOf(imgId);
  sprite?.classList.remove(...REACTION_CLASSES);
  sprite?._pet3d?.stop();
}

export function say(imgId, text, durationMs = 1600) {
  const bubble = spriteOf(imgId)?.querySelector(".pet-bubble");
  if (!bubble) return;
  bubble.textContent = text;
  bubble.classList.add("is-visible");
  clearTimeout(bubble._timer);
  if (durationMs > 0) bubble._timer = setTimeout(() => bubble.classList.remove("is-visible"), durationMs);
}

export function hush(imgId) {
  spriteOf(imgId)?.querySelector(".pet-bubble")?.classList.remove("is-visible");
}

function spawn(className, x, y, styles = {}, content = "") {
  const el = document.createElement("div");
  el.className = `fx-particle ${className}`;
  el.textContent = content;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  for (const [key, value] of Object.entries(styles)) el.style.setProperty(key, value);
  el.addEventListener("animationend", () => el.remove(), { once: true });
  document.body.appendChild(el);
}

export function floatEmojis(imgId, emojis, count = 5) {
  const rect = spriteOf(imgId)?.getBoundingClientRect();
  if (!rect) return;
  for (let i = 0; i < count; i++) {
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];
    const x = rect.left + rect.width * (0.2 + Math.random() * 0.6);
    const y = rect.top + rect.height * (0.15 + Math.random() * 0.3);
    setTimeout(() => spawn("fx-float", x, y, { "--dx": `${(Math.random() - 0.5) * 80}px` }, emoji), i * 90);
  }
}

export function confetti(count = 60) {
  const colors = ["#f472b6", "#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#f87171"];
  for (let i = 0; i < count; i++) {
    spawn("fx-confetti", Math.random() * window.innerWidth, -20, {
      background: colors[i % colors.length],
      "--dx": `${(Math.random() - 0.5) * 200}px`,
      "--spin": `${Math.random() * 720 - 360}deg`,
      "--duration": `${1.6 + Math.random() * 1.4}s`,
    });
  }
}

const TAP_LINES = ["Hihi! 😆", "Geli! 🤭", "Hey! 😳", "Again? 😄", "❤️", "Boop! 👉👃", "Hehe~"];
let taps = [];

function onMainTap() {
  if (window.getGameService?.()?.state.value === "sleep") return;
  const now = Date.now();
  taps = taps.filter((t) => now - t < 2000);
  taps.push(now);
  if (taps.length >= 5) {
    taps = [];
    react("charMain", "pet-dizzy", 900);
    say("charMain", "Pusing! 😵‍💫");
    floatEmojis("charMain", ["💫", "⭐"], 6);
    return;
  }
  react("charMain", "pet-squish", 500);
  say("charMain", TAP_LINES[Math.floor(Math.random() * TAP_LINES.length)], 1200);
  floatEmojis("charMain", ["❤️", "💕", "✨"], 3);
}

function onStateChange(state) {
  if (state === "eating") {
    react("charMain", "pet-chomp", 2000);
    say("charMain", "Nyam nyam! 😋", 1800);
    burstFrom("charMain", "hearts");
    floatEmojis("charMain", ["😋", "✨"], 4);
  } else if (state === "bathing") {
    react("charMain", "pet-wash", 2000);
    say("charMain", "Byur! 🛁", 1800);
    burstFrom("charMain", "bubbles");
    floatEmojis("charMain", ["🫧", "🫧", "💧"], 8);
  } else if (state === "idle") {
    stopReaction("charMain");
  }
}

export function celebrate(imgId, line = "Yeay! 🎉") {
  react(imgId, "pet-jump", 1200);
  say(imgId, line, 2000);
  confetti();
  burstFrom(imgId, "coins");
}

export function burstFrom(imgId, kind) {
  const rect = spriteOf(imgId)?.getBoundingClientRect();
  if (rect) window.dispatchEvent(new CustomEvent("stage:burst", { detail: { kind, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } }));
}

export function sulk(imgId, line = "Huhu... 😢") {
  react(imgId, "pet-shake", 1000);
  say(imgId, line, 2000);
}

async function enable3D() {
  const { supports3D, attachPet3D } = await import("./three/petRenderer.js");
  if (!supports3D()) return;
  const { createStage } = await import("./three/stage.js");
  const world = document.querySelector(".gradient-bg");
  if (world) createStage(world);
  for (const sprite of sprites()) {
    try {
      attachPet3D(sprite);
    } catch (err) {
      console.warn("3D pet unavailable, using 2D sprite", err);
      return;
    }
  }
}

export function initPet() {
  for (const id of SPRITE_IDS) {
    const img = document.getElementById(id);
    if (img) mountSprite(img);
  }
  enable3D().catch((err) => console.warn("3D pet unavailable, using 2D sprite", err));
  spriteOf("charMain")?.addEventListener("click", onMainTap);
  window.addEventListener("pet:state", (e) => onStateChange(e.detail));
}
