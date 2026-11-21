import { motionEnabled } from "./motion.js";

const PAGES = ["gameTitle", "optionButton", "menuGame", "menuSabun", "menuMakanan", "tebakKata", "tebakGambar", "xoxGame", "chessGame", "memoryGame", "simonGame", "versusGame"];
const TILT_TARGETS = ".mainScreen button.btn-hover, .mainScreen .card-shadow.rounded-3xl, .stat-bar";
const MAX_TILT = 8;

const isShown = (el) => el && getComputedStyle(el).display !== "none" && !el.classList.contains("hidden");

function animatePages() {
  for (const id of PAGES) {
    const page = document.getElementById(id);
    if (!isShown(page) || page._wasShown) {
      if (page) page._wasShown = isShown(page);
      continue;
    }
    page._wasShown = true;
    page.classList.remove("page-enter");
    void page.offsetWidth;
    page.classList.add("page-enter");
  }
}

function tilt(el, event) {
  const rect = el.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  const strength = rect.height > 160 ? 0.35 : 1;
  el.style.transform =
    `perspective(800px) rotateX(${(-y * MAX_TILT * strength).toFixed(2)}deg) ` +
    `rotateY(${(x * MAX_TILT * strength).toFixed(2)}deg) translateZ(6px)`;
}

export function initUi3d() {
  if (!motionEnabled()) return;

  window.addEventListener("pet:state", () => requestAnimationFrame(animatePages));
  requestAnimationFrame(animatePages);

  let active = null;
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const onBoard = event.target.closest?.(".chess-board, .xox-board");
    const target = onBoard ? null : event.target.closest?.(TILT_TARGETS);
    if (active && active !== target) {
      active.style.transform = "";
      active = null;
    }
    if (!target) return;
    target.classList.add("tilt-3d");
    active = target;
    tilt(target, event);
  });
  document.addEventListener("pointerleave", () => {
    if (active) active.style.transform = "";
    active = null;
  });
}
