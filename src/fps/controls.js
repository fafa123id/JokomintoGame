import { KEY } from "./shared/physics.js";

// Desktop: pointer lock + WASD. Phones/tablets: left stick to move, drag on the right to look,
// on-screen buttons for fire, jump, crouch, reload, use and weapon swap.
const MOUSE_SENS = 0.0022;
const TOUCH_SENS = 0.0055;
const STICK_RADIUS = 60;

export const isTouchDevice = () => matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;

export function createControls(root, { onReload, onSwitch, onCycle, onDrop, onChat, onScoreboard, onLockChange, onPrimary, onWheel, onSpectate }) {
  const state = { yaw: 0, pitch: 0, keys: 0, fire: false, use: false, locked: false, typing: false };
  const pressed = new Set();
  const touch = isTouchDevice();
  const cleanups = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  const keyMap = { KeyW: KEY.FORWARD, ArrowUp: KEY.FORWARD, KeyS: KEY.BACK, ArrowDown: KEY.BACK, KeyA: KEY.LEFT, ArrowLeft: KEY.LEFT, KeyD: KEY.RIGHT, ArrowRight: KEY.RIGHT, Space: KEY.JUMP, KeyC: KEY.CROUCH, ControlLeft: KEY.CROUCH, ControlRight: KEY.CROUCH, ShiftLeft: KEY.WALK };
  // Ctrl crouches only while the keyboard is locked (Chrome/Edge fullscreen). Without the lock,
  // Ctrl+W (crouch + forward) is the browser's close-tab shortcut, so Ctrl is ignored and C is used.
  let keyboardLocked = false;
  const isCtrl = (code) => code === "ControlLeft" || code === "ControlRight";
  const recompute = () => {
    let k = 0;
    for (const code of pressed) k |= keyMap[code] ?? 0;
    state.keys = (state.keys & ~0x7f) | k | touchKeys;
  };
  let touchKeys = 0;

  const look = (dx, dy, sens) => {
    state.yaw -= dx * sens;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sens));
  };

  let requestLock = () => {};
  if (!touch) {
    const canvas = root.querySelector("canvas");
    requestLock = async () => {
      if (document.pointerLockElement === canvas) return;
      // Fullscreen first: the Keyboard Lock API only works there, and it routes Ctrl+W and
      // other browser shortcuts to the game instead of the browser.
      if (navigator.keyboard?.lock && !document.fullscreenElement) {
        try {
          await root.requestFullscreen({ navigationUI: "hide" });
          await navigator.keyboard.lock();
          keyboardLocked = true;
        } catch {
          keyboardLocked = false;
        }
      }
      try {
        await canvas.requestPointerLock?.();
      } catch {}
    };
    // Buttons and the chat box handle their own clicks; anywhere else captures the mouse.
    on(root, "click", (e) => {
      if (e.target.closest("button, input, form, .fps-pause-card, .fps-chat")) return;
      requestLock();
    });
    on(document, "fullscreenchange", () => {
      if (document.fullscreenElement) return;
      keyboardLocked = false;
      navigator.keyboard?.unlock?.();
      for (const code of [...pressed]) if (isCtrl(code)) pressed.delete(code);
      recompute();
    });
    on(document, "pointerlockchange", () => {
      state.locked = document.pointerLockElement === canvas;
      if (!state.locked) {
        state.fire = false;
        pressed.clear();
        recompute();
      }
      onLockChange?.(state.locked);
    });
    on(document, "mousemove", (e) => state.locked && look(e.movementX, e.movementY, MOUSE_SENS));
    on(document, "mousedown", (e) => {
      if (!state.locked || state.typing || e.button !== 0) return;
      state.fire = true;
      onPrimary?.();
    });
    on(document, "wheel", (e) => state.locked && !state.typing && Math.abs(e.deltaY) > 1 && onWheel?.(e.deltaY > 0 ? 1 : -1), { passive: true });
    on(document, "mouseup", (e) => e.button === 0 && (state.fire = false));
    on(document, "keydown", (e) => {
      if (state.typing) return;
      if (!state.locked) {
        if (e.code === "Escape") requestLock();
        return;
      }
      // With the keyboard locked the game owns every key, so browser shortcuts don't fire.
      if (keyboardLocked && (e.ctrlKey || e.metaKey || e.altKey)) e.preventDefault();
      if (isCtrl(e.code) && !keyboardLocked) return;
      if (e.code === "Tab") {
        e.preventDefault();
        onScoreboard?.(true);
      }
      // Esc (a tap) opens the menu by releasing the mouse; holding it still leaves fullscreen.
      if (e.code === "Escape") return document.exitPointerLock?.();
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        return onChat?.();
      }
      if (e.repeat && !keyMap[e.code]) return;
      if (e.code === "KeyR") onReload?.();
      const slot = { Digit1: "rifle", Digit2: "pistol", Digit3: "knife", Digit4: "bomb" }[e.code];
      if (slot) onSwitch?.(slot);
      if (e.code === "KeyQ") onCycle?.(-1);
      if (e.code === "KeyE") onCycle?.(1);
      if (e.code === "KeyG") onDrop?.();
      if (e.code === "KeyF") state.use = true;
      if (keyMap[e.code]) {
        e.preventDefault();
        pressed.add(e.code);
        recompute();
      }
    });
    on(document, "keyup", (e) => {
      if (e.code === "Tab") onScoreboard?.(false);
      if (e.code === "KeyF") state.use = false;
      pressed.delete(e.code);
      recompute();
    });
  } else {
    state.locked = true;
    const pad = document.createElement("div");
    pad.className = "fps-touch";
    pad.innerHTML = `
      <div class="fps-stick" data-stick><span></span></div>
      <button type="button" class="fps-btn fps-btn--fire" data-fire aria-label="Fire">🔫</button>
      <button type="button" class="fps-btn fps-btn--jump" data-hold="${KEY.JUMP}" aria-label="Jump">⤒</button>
      <button type="button" class="fps-btn fps-btn--crouch" data-toggle="${KEY.CROUCH}" aria-label="Crouch">⤓</button>
      <button type="button" class="fps-btn fps-btn--reload" data-reload aria-label="Reload">↻</button>
      <button type="button" class="fps-btn fps-btn--use" data-use aria-label="Plant or defuse">💣</button>
      <button type="button" class="fps-btn fps-btn--score" data-score aria-label="Scoreboard">☰</button>
      <div class="fps-spec-bar">
        <button type="button" data-spec="prev" aria-label="Previous teammate">◀</button>
        <button type="button" data-spec="mode" aria-label="Change camera">🎥</button>
        <button type="button" data-spec="next" aria-label="Next teammate">▶</button>
      </div>`;
    root.appendChild(pad);
    cleanups.push(() => pad.remove());

    const stick = pad.querySelector("[data-stick]");
    const knob = stick.querySelector("span");
    let stickId = null;
    let stickOrigin = null;
    const lookers = new Map();
    const setStick = (dx, dz) => {
      const len = Math.hypot(dx, dz);
      const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
      knob.style.transform = `translate(${dx * k}px, ${dz * k}px)`;
      const nx = dx / STICK_RADIUS;
      const nz = dz / STICK_RADIUS;
      let keys = 0;
      if (nz < -0.3) keys |= KEY.FORWARD;
      if (nz > 0.3) keys |= KEY.BACK;
      if (nx < -0.3) keys |= KEY.LEFT;
      if (nx > 0.3) keys |= KEY.RIGHT;
      if (len > 0 && len < STICK_RADIUS * 0.55) keys |= KEY.WALK;
      touchKeys = (touchKeys & ~(KEY.FORWARD | KEY.BACK | KEY.LEFT | KEY.RIGHT | KEY.WALK)) | keys;
      recompute();
    };

    on(pad, "touchstart", (e) => {
      for (const t of e.changedTouches) {
        const target = t.target.closest("button");
        if (target?.dataset.fire !== undefined) {
          state.fire = true;
          lookers.set(t.identifier, { x: t.clientX, y: t.clientY, fire: true });
        } else if (target?.dataset.hold) {
          touchKeys |= Number(target.dataset.hold);
          recompute();
        } else if (target?.dataset.toggle) {
          touchKeys ^= Number(target.dataset.toggle);
          target.classList.toggle("is-on", !!(touchKeys & Number(target.dataset.toggle)));
          recompute();
        } else if (target?.dataset.reload !== undefined) onReload?.();
        else if (target?.dataset.use !== undefined) state.use = true;
        else if (target?.dataset.score !== undefined) onScoreboard?.(true);
        else if (target?.dataset.spec) onSpectate?.(target.dataset.spec);
        else if (t.clientX < window.innerWidth * 0.4 && stickId === null) {
          stickId = t.identifier;
          stickOrigin = { x: t.clientX, y: t.clientY };
          stick.style.left = `${t.clientX}px`;
          stick.style.top = `${t.clientY}px`;
          stick.classList.add("is-active");
        } else lookers.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      e.preventDefault();
    }, { passive: false });
    on(pad, "touchmove", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) setStick(t.clientX - stickOrigin.x, t.clientY - stickOrigin.y);
        const l = lookers.get(t.identifier);
        if (l) {
          look(t.clientX - l.x, t.clientY - l.y, TOUCH_SENS);
          l.x = t.clientX;
          l.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        const target = t.target.closest?.("button");
        if (t.identifier === stickId) {
          stickId = null;
          stick.classList.remove("is-active");
          setStick(0, 0);
        }
        if (lookers.get(t.identifier)?.fire) state.fire = false;
        lookers.delete(t.identifier);
        if (target?.dataset.hold) {
          touchKeys &= ~Number(target.dataset.hold);
          recompute();
        }
        if (target?.dataset.use !== undefined) state.use = false;
        if (target?.dataset.score !== undefined) onScoreboard?.(false);
      }
    };
    on(pad, "touchend", end);
    on(pad, "touchcancel", end);
  }

  return {
    state,
    touch,
    get keyboardLocked() {
      return keyboardLocked;
    },
    ctrlCrouchSupported: !touch && !!navigator.keyboard?.lock,
    requestLock: () => requestLock(),
    // While the chat box has focus the game ignores keys and stops moving.
    setTyping(on) {
      state.typing = on;
      if (on) {
        pressed.clear();
        state.fire = false;
        state.use = false;
        recompute();
      }
    },
    setUseVisible(visible) {
      root.querySelector("[data-use]")?.classList.toggle("is-visible", visible);
    },
    unlock() {
      if (document.pointerLockElement) document.exitPointerLock?.();
    },
    dispose() {
      cleanups.forEach((fn) => fn());
      if (document.pointerLockElement) document.exitPointerLock?.();
      if (keyboardLocked) navigator.keyboard?.unlock?.();
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    },
  };
}
