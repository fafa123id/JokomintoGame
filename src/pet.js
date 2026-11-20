import { state } from "./api.js";
const SPRITE_IDS = ["charMain", "charHome", "charTebakKata", "charTebakGambar", "charXox", "charChess", "charMemory", "charSimon"];
const REACTION_CLASSES = [
  "pet-squish", "pet-dizzy", "pet-chomp", "pet-wash", "pet-jump", "pet-shake", "pet-think", "pet-scratch", "pet-sigh",
  "pet-dance0", "pet-dance1", "pet-dance2", "pet-dance3",
];
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

const TYPE_MS = 26;
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const graphemes = (text) => (segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : Array.from(text));
const isEmoji = (g) => /\p{Extended_Pictographic}/u.test(g);
const reducedMotion = () => document.documentElement.classList.contains("motion-reduced");

function hideBubble(bubble) {
  clearTimeout(bubble._timer);
  clearInterval(bubble._typer);
  bubble.classList.remove("is-visible");
  bubble._priority = 0;
  bubble._until = 0;
}

function typeInto(bubble, text) {
  const parts = graphemes(text);
  const append = (g) => {
    if (isEmoji(g)) {
      const emoji = document.createElement("span");
      emoji.className = "pb-emoji";
      emoji.textContent = g;
      bubble.insertBefore(emoji, bubble._cursor);
    } else {
      bubble.insertBefore(document.createTextNode(g), bubble._cursor);
    }
  };
  bubble.replaceChildren();
  bubble._cursor = document.createElement("span");
  bubble._cursor.className = "pb-cursor";
  bubble._cursor.textContent = "\u258D";
  bubble.appendChild(bubble._cursor);
  if (reducedMotion()) {
    parts.forEach(append);
    bubble._cursor.remove();
    return;
  }
  let i = 0;
  bubble._typer = setInterval(() => {
    append(parts[i++]);
    if (i >= parts.length) {
      clearInterval(bubble._typer);
      bubble._cursor.remove();
    }
  }, TYPE_MS);
}

// priority: 1 = ambient chatter, 2 = reactions and events. Lower priority never interrupts higher.
export function say(imgId, text, durationMs = 1600, { mood = "", priority = 2 } = {}) {
  const bubble = spriteOf(imgId)?.querySelector(".pet-bubble");
  if (!bubble) return false;
  const now = Date.now();
  const busy = bubble.classList.contains("is-visible") && bubble._until > now;
  if (busy && bubble._priority > priority) return false;

  clearTimeout(bubble._timer);
  clearInterval(bubble._typer);
  bubble._priority = priority;
  bubble._until = durationMs > 0 ? now + durationMs : Infinity;
  bubble.className = "pet-bubble";
  if (mood) bubble.classList.add(`pb--${mood}`);
  if (priority === 1) bubble.classList.add("pb--complain");
  void bubble.offsetWidth;
  bubble.classList.add("is-visible");
  typeInto(bubble, text);
  if (durationMs > 0) bubble._timer = setTimeout(() => hideBubble(bubble), durationMs);
  return true;
}

export function sayChain(imgId, steps, priority = 2) {
  const sprite = spriteOf(imgId);
  if (!sprite) return;
  (sprite._chain ?? []).forEach(clearTimeout);
  sprite._chain = steps.map((step) =>
    setTimeout(() => say(imgId, step.text, step.ms, { mood: step.mood, priority }), step.at)
  );
}

export function hush(imgId) {
  const sprite = spriteOf(imgId);
  (sprite?._chain ?? []).forEach(clearTimeout);
  const bubble = sprite?.querySelector(".pet-bubble");
  if (bubble) hideBubble(bubble);
}

// Removes on animationend, with a timer fallback in case the animation never runs.
function removeAfterAnimation(el, fallbackMs) {
  const remove = () => el.remove();
  el.addEventListener("animationend", remove, { once: true });
  setTimeout(remove, fallbackMs);
}

function spawn(className, x, y, styles = {}, content = "") {
  if (reducedMotion()) return;
  const el = document.createElement("div");
  el.className = `fx-particle ${className}`;
  el.textContent = content;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  for (const [key, value] of Object.entries(styles)) el.style.setProperty(key, value);
  removeAfterAnimation(el, 4000);
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
  if (spriteOf("charMain")?.dataset.stroking) return;
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

const SCENE_MS = { eat: 2650, bath: 2800 };
let introRunning = false;
let sceneUntil = 0;

const mainPet3D = () => spriteOf("charMain")?._pet3d ?? null;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (min, max) => min + Math.random() * (max - min);

const FOOD_TALK = {
  biskuit: { start: "Cookies! 🍪", during: "Kriuk kriuk~ 😋", after: ["Manis! Makasih ya 🥰", "Nambah satu lagi boleh? 🍪"] },
  roti: { start: "Roti anget! 🍞", during: "Hap! Empuk banget~", after: ["Kenyang dikit 😌", "Enak! Makasih 💕"] },
  nasigoreng: { start: "Nasgor favoritku! 🍳", during: "Nyam nyam nyam~ 🤤", after: ["Kenyaaang~ 😋", "Pedesnya pas! 🔥"] },
  pizza: { start: "PIZZA!! 🍕", during: "Kejunya molor~ 🧀", after: ["Mamma mia! 🤌", "Pizza terbaik! 💯"] },
  steak: { start: "Steak premium?! 🥩", during: "Juicy bangett~ 🤤", after: ["Aku jadi kuat! 💪", "Makan ala sultan 👑"] },
};

const SOAP_TALK = {
  biasa: { start: "Waktunya mandi! 🧼", during: "Byur byur~ 🫧", after: ["Seger! 😌", "Bersih kinclong ✨"] },
  wangi: { start: "Sabun wangi! 🌸", during: "Hmm wanginya~ 💐", after: ["Harum semerbak! 🌷", "Aku wangi kan? 😚"] },
  premium: { start: "Mandi ala sultan 👑", during: "Busanya lembut~ ✨", after: ["Kinclong maksimal! 💎", "Aku bersinar! 🌟"] },
};

function sceneTalk(name, data) {
  const table = name === "eat" ? FOOD_TALK : SOAP_TALK;
  const talk = table[name === "eat" ? data.food : data.soap] ?? Object.values(table)[0];
  return { ...talk, mood: name === "eat" ? "happy" : "fresh", ending: pick(talk.after) };
}

function narrate(talk, totalMs) {
  sayChain("charMain", [
    { at: 0, text: talk.start, ms: 900, mood: talk.mood },
    { at: 950, text: talk.during, ms: Math.max(900, totalMs - 1050), mood: talk.mood },
    { at: totalMs - 80, text: talk.ending, ms: 2600, mood: talk.mood },
  ]);
}

let skipButton = null;
let skipHandler = null;

function ensureSkipButton() {
  if (skipButton) return skipButton;
  skipButton = document.createElement("button");
  skipButton.type = "button";
  skipButton.className = "scene-skip";
  skipButton.textContent = "Lewati ⏭";
  skipButton.setAttribute("aria-label", "Skip animation");
  skipButton.addEventListener("click", () => skipHandler?.());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && skipHandler) skipHandler();
  });
  return skipButton;
}

function showSkip(onSkip) {
  const holder = spriteOf("charMain")?.parentElement;
  if (!holder) return;
  const button = ensureSkipButton();
  holder.appendChild(button);
  skipHandler = onSkip;
  button.classList.remove("is-visible");
  clearTimeout(button._timer);
  button._timer = setTimeout(() => button.classList.add("is-visible"), 400);
}

function hideSkip() {
  skipHandler = null;
  if (!skipButton) return;
  clearTimeout(skipButton._timer);
  skipButton.classList.remove("is-visible");
}

// Plays an eat/bath scene; onEnd runs once when it finishes or is skipped.
// Returns the 3D duration, or 0 when 3D is off (callers then show the GIF fallback).
export function playPetScene(name, data, onEnd) {
  const pet = mainPet3D();
  const ms = pet?.fx ? (SCENE_MS[name] ?? 0) : 0;
  const total = Math.max(2000, ms);
  const talk = sceneTalk(name, data);
  if (ms) pet.playScene(name, data);
  narrate(talk, total);
  sceneUntil = Date.now() + total + 2600;

  let done = false;
  const finish = (skipped) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    hideSkip();
    if (skipped) {
      pet?.fx?.skip();
      hush("charMain");
      say("charMain", talk.ending, 2200, { mood: talk.mood });
      sceneUntil = Date.now() + 2200;
    }
    onEnd?.({ skipped });
  };
  const timer = setTimeout(() => finish(false), total);
  showSkip(() => finish(true));
  return ms;
}

const COMPLAINTS = {
  hungry: {
    mood: "hungry",
    gesture: "pet-shake",
    lines: ["Uhh... aku lapar 😩", "Perutku bunyi nih... 🍽️", "Makan yuk? 🥺", "Laper bangett~ 😫"],
  },
  dirty: {
    mood: "dirty",
    gesture: "pet-scratch",
    lines: ["Gatal-gatal... 🤢", "Aku bau ya? 😖", "Mandiin dong 🛁", "Ada lalat! 🪰"],
  },
  sad: {
    mood: "sad",
    gesture: "pet-sigh",
    lines: ["Bosen... main yuk 🎮", "Huhu... temenin aku 😔", "Aku kesepian... 🥺"],
  },
};

let nextComplaint = Date.now() + 5000;
let lastNeed = null;

function currentNeed() {
  const pet = state.pet;
  if (!pet) return null;
  if (pet.hunger >= 70) return "hungry";
  if (pet.hygiene <= 30) return "dirty";
  if (pet.mood <= 30) return "sad";
  return null;
}

function complainTick() {
  const now = Date.now();
  const need = currentNeed();
  if (need !== lastNeed) {
    lastNeed = need;
    if (need) nextComplaint = Math.min(nextComplaint, now + 2500);
  }
  if (!need || now < nextComplaint || now < sceneUntil || document.hidden) return;
  if (window.getGameService?.()?.state.value !== "idle") return;
  const sprite = spriteOf("charMain");
  if (!sprite || sprite.offsetParent === null) return;

  const complaint = COMPLAINTS[need];
  if (say("charMain", pick(complaint.lines), 2800, { mood: complaint.mood, priority: 1 })) {
    react("charMain", complaint.gesture, 1400);
  }
  nextComplaint = now + between(13000, 21000);
}

export function petPlayIntro(onDone) {
  const pet = mainPet3D();
  if (!pet?.fx) return onDone();
  if (introRunning) return;
  introRunning = true;
  say("charMain", "Ayo main! ⚽", 1200);
  pet.playScene("playIntro", {}, () => {
    introRunning = false;
    onDone();
  });
}

function onStateChange(state) {
  const scene3D = !!mainPet3D()?.fx;
  if (state === "eating") {
    if (!scene3D) {
      react("charMain", "pet-chomp", 2000);
      burstFrom("charMain", "hearts");
      floatEmojis("charMain", ["😋", "✨"], 4);
    }
  } else if (state === "bathing") {
    if (!scene3D) {
      react("charMain", "pet-wash", 2000);
      burstFrom("charMain", "bubbles");
      floatEmojis("charMain", ["🫧", "🫧", "💧"], 8);
    }
  } else if (state === "idle" && !scene3D) {
    stopReaction("charMain");
  }
}

const FALLBACK_REACTION = { victory: "pet-jump", oops: "pet-shake", fail: "pet-sigh", hint: "pet-squish", ready: "pet-squish" };

// Plays a 3D game scene on any pet, falling back to the 2D CSS reaction.
export function gameFx(imgId, scene, data = {}) {
  const pet = spriteOf(imgId)?._pet3d;
  if (pet?.fx) pet.playScene(scene, data);
  else react(imgId, FALLBACK_REACTION[scene] ?? "pet-squish", 1000);
}

export function setNervous(imgId, on) {
  const pet = spriteOf(imgId)?._pet3d;
  if (pet?.fx) pet.fx.nervous = on;
}

// Floating "+30 🧼" style numbers rising from the pet.
export function floatStats(imgId, stats) {
  const rect = spriteOf(imgId)?.getBoundingClientRect();
  if (!rect?.width) return;
  stats.forEach((stat, i) => {
    const el = document.createElement("div");
    el.className = `stat-pop stat-pop--${stat.tone ?? "good"}`;
    el.textContent = stat.text;
    el.style.left = `${rect.left + rect.width * (0.5 + (i - (stats.length - 1) / 2) * 0.42)}px`;
    el.style.top = `${rect.top + rect.height * 0.25}px`;
    el.style.animationDelay = `${i * 0.12}s`;
    removeAfterAnimation(el, 1800 + i * 120);
    document.body.appendChild(el);
  });
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
    const main = sprite === spriteOf("charMain");
    attachPet3D(sprite, { fx: main ? "ambient" : true, detail: main ? 1 : 0.6 });
  }
  document.documentElement.classList.add("fx3d");
}

export function initPet() {
  for (const id of SPRITE_IDS) {
    const img = document.getElementById(id);
    if (img) mountSprite(img);
  }
  enable3D().catch((err) => console.warn("3D pet unavailable, using 2D sprite", err));
  setInterval(complainTick, 1000);
  spriteOf("charMain")?.addEventListener("click", onMainTap);
  window.addEventListener("pet:state", (e) => onStateChange(e.detail));
}
