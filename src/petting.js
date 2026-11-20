import { api, state, setPet } from "./api.js";
import { updateContext } from "./components.js";
import { spriteOf, say, floatEmojis, floatStats } from "./pet.js";
import { startPurr, stopPurr } from "./purr.js";
import { sendEvent } from "./stateManager.js";

const STROKE_START_PX = 24;
const SEND_EVERY_MS = 1400;
const LINES = ["Purrr~ 😻", "Enak banget~ 😌", "Lagi dong~ 🥰", "Hehe geli~ 😊"];

let stroke = null;
let cappedNotice = 0;

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const isIdle = () => window.getGameService?.()?.state.value === "idle";

function begin(sprite) {
  stroke.active = true;
  sendEvent("ACTIVITY");
  sprite.dataset.stroking = "1";
  sprite.classList.add("pet-petted");
  sprite._pet3d?.setMode("petted", Infinity);
  startPurr();
  say("charMain", pick(LINES), 0, { mood: "happy" });
  stroke.hearts = setInterval(() => floatEmojis("charMain", ["💕", "💗", "✨"], 1), 450);
  stroke.sender = setInterval(send, SEND_EVERY_MS);
}

async function send() {
  sendEvent("ACTIVITY");
  if (!state.user) return;
  const res = await api("/api/pet/stroke", {});
  if (res.error) return;
  setPet(res.pet);
  updateContext();
  if (res.gained > 0) floatStats("charMain", [{ text: `+${res.gained} 😊`, tone: "good" }]);
  else if (res.capped && Date.now() - cappedNotice > 15000) {
    cappedNotice = Date.now();
    say("charMain", "Udah puas dielus~ makasih 😌", 2000, { mood: "happy" });
  }
}

function end(sprite) {
  if (!stroke) return;
  const wasActive = stroke.active;
  clearInterval(stroke.hearts);
  clearInterval(stroke.sender);
  stroke = null;
  if (!wasActive) return;
  stopPurr();
  sendEvent("ACTIVITY");
  sprite.classList.remove("pet-petted");
  sprite._pet3d?.stop();
  say("charMain", pick(["Makasih elusannya 💕", "Purr... 😽", "Lagi nanti ya~ 🥰"]), 1600, { mood: "happy" });
  // Swallow the click that follows the stroke so it doesn't count as a tap.
  setTimeout(() => delete sprite.dataset.stroking, 0);
}

export function initPetting() {
  const sprite = spriteOf("charMain");
  if (!sprite) return;
  sprite.style.touchAction = "none";

  sprite.addEventListener("pointerdown", (e) => {
    if (!isIdle() || !state.user) return;
    stroke = { x: e.clientX, y: e.clientY, travel: 0, active: false };
    sprite.setPointerCapture?.(e.pointerId);
  });
  sprite.addEventListener("pointermove", (e) => {
    if (!stroke) return;
    stroke.travel += Math.hypot(e.clientX - stroke.x, e.clientY - stroke.y);
    stroke.x = e.clientX;
    stroke.y = e.clientY;
    sprite._pet3d?.setPointer(e.clientX, e.clientY);
    if (!stroke.active && stroke.travel > STROKE_START_PX) begin(sprite);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    sprite.addEventListener(type, () => end(sprite));
  }
  document.addEventListener("visibilitychange", () => document.hidden && end(sprite));
}
