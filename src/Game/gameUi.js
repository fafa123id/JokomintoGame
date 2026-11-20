const LOW_TIME = 5;

export function createTimerBar(timeElementId) {
  const holder = document.getElementById(timeElementId)?.closest("p")?.parentElement;
  let bar = holder?.querySelector(".time-bar");
  if (holder && !bar) {
    bar = document.createElement("div");
    bar.className = "time-bar";
    bar.innerHTML = `<div class="time-bar-fill"></div>`;
    holder.appendChild(bar);
  }
  const fill = bar?.querySelector(".time-bar-fill");
  let total = 1;

  return {
    start(seconds) {
      total = Math.max(1, seconds);
      this.set(seconds);
    },
    set(seconds) {
      if (!bar) return;
      fill.style.width = `${Math.max(0, Math.min(1, seconds / total)) * 100}%`;
      bar.classList.toggle("is-low", seconds > 0 && seconds <= LOW_TIME);
    },
    reset() {
      if (!bar) return;
      fill.style.width = "100%";
      bar.classList.remove("is-low");
    },
  };
}

export const isLowTime = (seconds) => seconds > 0 && seconds <= LOW_TIME;

export function shake(element) {
  if (!element) return;
  element.classList.remove("input-shake");
  void element.offsetWidth;
  element.classList.add("input-shake");
  setTimeout(() => element.classList.remove("input-shake"), 500);
}

// Renders letters as tiles; previously hidden letters that are now visible flip in.
export function renderWordTiles(container, letters, { state = "", stagger = 70 } = {}) {
  const tiles = [...container.querySelectorAll(".letter-tile")];
  container.classList.add("word-tiles");
  if (tiles.length !== letters.length) {
    container.replaceChildren(
      ...letters.map(() => {
        const tile = document.createElement("span");
        tile.className = "letter-tile is-hidden";
        return tile;
      })
    );
  }
  [...container.children].forEach((tile, i) => {
    const letter = letters[i];
    const hidden = !letter || letter === "_";
    const wasHidden = tile.classList.contains("is-hidden") || tile.classList.contains("is-loading");
    tile.textContent = hidden ? "" : letter;
    tile.className = "letter-tile";
    if (hidden) {
      tile.classList.add("is-hidden");
      return;
    }
    const effect = state === "win" ? "is-win" : state === "answer" && wasHidden ? "is-answer" : wasHidden ? "is-flip" : "";
    if (effect) {
      tile.style.animationDelay = `${i * stagger}ms`;
      tile.classList.add(effect);
    }
  });
}

export function renderLoadingTiles(container, count = 5) {
  container.classList.add("word-tiles");
  container.replaceChildren(
    ...Array.from({ length: count }, (_, i) => {
      const tile = document.createElement("span");
      tile.className = "letter-tile is-hidden is-loading";
      tile.style.animationDelay = `${i * 90}ms`;
      return tile;
    })
  );
}

// Brings the pet (and its speech bubble) into view so its reaction is seen.
export function focusPet(imgId) {
  const sprite = document.getElementById(imgId)?.parentElement;
  if (!sprite) return;
  const rect = sprite.getBoundingClientRect();
  const fullyVisible = rect.top - 70 >= 0 && rect.bottom <= window.innerHeight;
  if (fullyVisible) return;
  const reduced = document.documentElement.classList.contains("motion-reduced");
  const top = window.scrollY + rect.top - Math.max(90, (window.innerHeight - rect.height) / 3);
  window.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
}

// Short result label right under the answer form.
export function answerFeedback(form, text, tone) {
  if (!form) return;
  let label = form.nextElementSibling?.classList.contains("answer-feedback") ? form.nextElementSibling : null;
  if (!label) {
    label = document.createElement("p");
    label.className = "answer-feedback";
    label.setAttribute("role", "status");
    label.setAttribute("aria-live", "polite");
    form.after(label);
  }
  label.textContent = text;
  label.className = `answer-feedback answer-feedback--${tone} is-visible`;
  clearTimeout(label._timer);
  label._timer = setTimeout(() => label.classList.remove("is-visible"), 2200);
}

// Delayed end-of-round actions that must be cancelled when a new round starts or the player leaves.
export function createRoundTimers() {
  const timers = new Set();
  return {
    later(fn, ms) {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    },
    clear() {
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}
