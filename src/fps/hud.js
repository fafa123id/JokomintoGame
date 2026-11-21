import { WEAPONS } from "./shared/weapons.js";

// HUD drawn in the DOM over the canvas. Text only goes through textContent.
const SLOT_ICONS = { rifle: "🎯", pistol: "🔫", knife: "🔪", bomb: "💣" };
const CHAT_LINES = 7;
const CHAT_FADE_MS = 9000;

export function createHud(root, { touch, ctrlCrouch = false }) {
  const crouchKey = ctrlCrouch ? "Ctrl/C crouch" : "C crouch";
  const help = `WASD move · Mouse aim · Click shoot · R reload · Q/E/scroll or 1-4 weapons · G drop weapon · Z skill · X ultimate · F plant/defuse · Space jump · ${crouchKey} · Shift walk · Tab scores · Enter chat · Esc menu`;
  const hud = document.createElement("div");
  hud.className = "fps-hud";
  hud.innerHTML = `
    <div class="fps-top">
      <div class="fps-roster fps-roster--red" data-roster-red></div>
      <div class="fps-team fps-team--red"><small data-side-red></small><strong data-score-red>0</strong></div>
      <div class="fps-clock"><strong data-clock>0:00</strong><span class="fps-bombicon" data-bombicon>💣</span><small data-phase></small></div>
      <div class="fps-team fps-team--blue"><strong data-score-blue>0</strong><small data-side-blue></small></div>
      <div class="fps-roster fps-roster--blue" data-roster-blue></div>
    </div>
    <button type="button" class="fps-leave" data-menu-btn>☰ Menu</button>
    <button type="button" class="fps-chatbtn" data-chat-btn aria-label="Chat">💬</button>
    <div class="fps-feed" data-feed></div>
    <div class="fps-crosshair" data-crosshair><i></i><i></i><i></i><i></i></div>
    <div class="fps-hitmarker" data-hitmarker><i></i><i></i><i></i><i></i></div>
    <div class="fps-vignette" data-vignette></div>
    <div class="fps-banner" data-banner><strong></strong><small></small></div>
    <div class="fps-callout" data-callout><strong></strong><small></small></div>
    <div class="fps-prompt" data-prompt><span></span><div class="fps-progress"><div></div></div></div>
    <div class="fps-bombtag" data-bombtag></div>
    <div class="fps-health"><span data-hp>100</span><em class="fps-shield" data-shield></em><div class="fps-bar"><div data-hpbar></div></div></div>
    <div class="fps-abilities" data-abilities>
      <div class="fps-ability" data-ab="skill"><span></span><i></i><b>Z</b><small></small></div>
      <div class="fps-ability fps-ability--ult" data-ab="ult"><span></span><i></i><b>X</b><small></small></div>
    </div>
    <div class="fps-slots" data-slots></div>
    <div class="fps-ammo"><small data-weapon></small><strong data-ammo-count><span data-mag>25</span><em>/ <span data-reserve>75</span></em></strong><div class="fps-bar fps-bar--reload"><div data-reloadbar></div></div></div>
    <div class="fps-chat" data-chat>
      <div class="fps-chat-log" data-chat-log></div>
      <form class="fps-chat-form" data-chat-form>
        <button type="button" class="fps-chat-channel" data-chat-channel>TEAM</button>
        <input data-chat-input maxlength="120" autocomplete="off" enterkeyhint="send" placeholder="${touch ? "Message" : "Message · Tab: switch channel · Esc: close"}" />
        <button type="submit" class="fps-chat-send" aria-label="Send">➤</button>
      </form>
    </div>
    <div class="fps-dead" data-dead>
      <strong>You were eliminated</strong>
      <span class="fps-spec-name" data-spectate></span>
      <small class="fps-spec-help" data-spec-help></small>
    </div>
    <div class="fps-board" data-board><table><thead><tr><th>Player</th><th>K</th><th>D</th><th>A</th></tr></thead><tbody></tbody></table></div>
    <div class="fps-pause" data-pause>
      <div class="fps-pause-card">
        <div data-pause-main>
          <strong data-pause-title>Paused</strong>
          <button type="button" class="fps-cta" data-resume>Resume</button>
          <button type="button" class="fps-back" data-leave>Leave match</button>
          ${touch ? "" : `<small class="fps-pause-help"></small>`}
        </div>
        <div data-pause-confirm hidden>
          <strong>Leave the match?</strong>
          <p>A bot takes over your Jokoman. You can come back while the match is still running.</p>
          <button type="button" class="fps-cta fps-cta--danger" data-leave-yes>Leave</button>
          <button type="button" class="fps-back" data-leave-no>Stay</button>
        </div>
      </div>
    </div>`;
  root.appendChild(hud);
  const $ = (name) => hud.querySelector(`[data-${name}]`);
  const help$ = hud.querySelector(".fps-pause-help");
  if (help$) help$.textContent = help;
  let bannerTimer = null;
  let hitTimer = null;
  let blinkTimer = null;
  let calloutTimer = null;
  const portraits = new Map();
  const callouts = [];
  let showing = null;
  const CALLOUT_MIN_MS = 1200;
  const showCallout = () => {
    const b = $("callout");
    const item = callouts.shift();
    if (!item) {
      showing = null;
      return b.classList.remove("is-on");
    }
    showing = { ...item, at: performance.now() };
    b.querySelector("strong").textContent = item.title;
    b.querySelector("small").textContent = item.subtitle;
    b.className = "fps-callout";
    void b.offsetWidth;
    b.className = `fps-callout is-on ${item.tone}`;
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(showCallout, callouts.length ? CALLOUT_MIN_MS : item.ms);
  };
  let slotsKey = "";
  const handlers = {};

  const showConfirm = (on) => {
    $("pause-main").hidden = on;
    $("pause-confirm").hidden = !on;
  };
  $("menu-btn").addEventListener("click", () => handlers.menu?.());
  $("resume").addEventListener("click", () => handlers.resume?.());
  $("leave").addEventListener("click", () => showConfirm(true));
  $("leave-no").addEventListener("click", () => showConfirm(false));
  $("leave-yes").addEventListener("click", () => handlers.leave?.());
  $("slots").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.drop !== undefined) handlers.drop?.();
    else handlers.slot?.(btn.dataset.slot);
  });

  // ---------- chat ----------
  const chat = { open: false, all: false };
  const log = $("chat-log");
  const input = $("chat-input");
  const setChannel = (all) => {
    chat.all = all;
    $("chat-channel").textContent = all ? "ALL" : "TEAM";
    $("chat-channel").classList.toggle("is-all", all);
  };
  const closeChat = () => {
    if (!chat.open) return;
    chat.open = false;
    input.value = "";
    input.blur();
    $("chat").classList.remove("is-open");
    handlers.chatClosed?.();
  };
  $("chat-btn").addEventListener("click", () => (chat.open ? closeChat() : hudApi.openChat()));
  $("chat-channel").addEventListener("click", () => setChannel(!chat.all));
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) handlers.chatSend?.(text, chat.all);
    closeChat();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.code === "Tab") {
      e.preventDefault();
      setChannel(!chat.all);
    } else if (e.code === "Escape") {
      e.preventDefault();
      closeChat();
    }
  });
  input.addEventListener("keyup", (e) => e.stopPropagation());

  const feed = $("feed");
  const hudApi = {
    el: hud,
    on(name, fn) {
      handlers[name] = fn;
    },
    get chatOpen() {
      return chat.open;
    },
    openChat() {
      chat.open = true;
      setChannel(false);
      $("chat").classList.add("is-open");
      input.focus({ preventScroll: true });
    },
    closeChat,
    chatMessage({ name, team, all, dead, text }, mine) {
      const row = document.createElement("div");
      row.className = `fps-chat-row${mine ? " is-mine" : ""}`;
      const tag = document.createElement("em");
      tag.textContent = `${all ? "[ALL]" : "[TEAM]"}${dead ? " ☠" : ""}`;
      const who = document.createElement("span");
      who.className = `is-${team}`;
      who.textContent = `${name}:`;
      const body = document.createElement("span");
      body.textContent = ` ${text}`;
      row.append(tag, " ", who, body);
      log.appendChild(row);
      while (log.childElementCount > CHAT_LINES) log.firstElementChild.remove();
      setTimeout(() => row.classList.add("is-old"), CHAT_FADE_MS);
    },
    // Portraits beside the score: lit while alive, dimmed and crossed out when dead, YOU under yours.
    roster(entries) {
      for (const e of entries) {
        let item = portraits.get(e.id);
        if (!item || item.dataset.icon !== e.icon) {
          item?.remove();
          item = document.createElement("div");
          item.className = "fps-portrait";
          item.dataset.icon = e.icon;
          const face = document.createElement("span");
          face.textContent = e.icon;
          item.appendChild(face);
          if (e.me) {
            const you = document.createElement("small");
            you.textContent = "YOU";
            item.appendChild(you);
          }
          item.title = e.name;
          portraits.set(e.id, item);
          const list = $(`roster-${e.team}`);
          // Your own portrait sits next to the score.
          if (e.me && e.team === "red") list.appendChild(item);
          else if (e.me) list.prepend(item);
          else if (e.team === "red") list.prepend(item);
          else list.appendChild(item);
        }
        item.classList.toggle("is-dead", !e.alive);
        item.classList.toggle("is-me", e.me);
        item.classList.toggle("is-red", e.team === "red");
        item.classList.toggle("is-blue", e.team === "blue");
        // Health bars only for your own team (the server hides enemy health).
        item.classList.toggle("no-hp", e.hp === undefined);
        if (e.hp !== undefined) item.style.setProperty("--hp", `${Math.max(0, e.hp)}%`);
      }
    },
    score({ red, blue }, attackTeam) {
      $("score-red").textContent = red;
      $("score-blue").textContent = blue;
      $("side-red").textContent = attackTeam === "red" ? "ATTACK" : "DEFEND";
      $("side-blue").textContent = attackTeam === "blue" ? "ATTACK" : "DEFEND";
    },
    // After the plant there is no countdown: only a blinking bomb icon.
    clock(seconds, phase, planted) {
      const s = Math.max(0, Math.ceil(seconds || 0));
      $("clock").hidden = planted;
      $("bombicon").classList.toggle("is-on", planted);
      if (!planted) $("clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      $("phase").textContent = planted ? "BOMB PLANTED" : { buy: "GET READY", live: "", end: "ROUND OVER" }[phase] ?? "";
    },
    bombBlink() {
      const icon = $("bombicon");
      icon.classList.add("is-lit");
      clearTimeout(blinkTimer);
      blinkTimer = setTimeout(() => icon.classList.remove("is-lit"), 130);
    },
    // Skill cooldown and ultimate charge, on the HUD (desktop) and on the touch buttons.
    abilities({ hero, cd, ult, stealth }) {
      if (!hero) return;
      const skillReady = cd <= 0;
      const ultReady = ult >= 100;
      const set = (slot, icon, ready, label, fill, title) => {
        const box = hud.querySelector(`[data-ab="${slot}"]`);
        if (box.dataset.icon !== icon) {
          box.dataset.icon = icon;
          box.querySelector("span").textContent = icon;
          box.title = title;
        }
        box.classList.toggle("is-ready", ready);
        box.querySelector("small").textContent = label;
        box.style.setProperty("--fill", `${Math.round(fill * 100)}%`);
        const btn = root.querySelector(`[data-ability="${slot}"]`);
        if (btn) {
          btn.classList.toggle("is-ready", ready);
          btn.querySelector("[data-ability-icon]").textContent = icon;
          btn.querySelector("[data-ability-cd]").textContent = ready ? "" : label;
          btn.style.setProperty("--fill", `${Math.round(fill * 100)}%`);
        }
      };
      set("skill", hero.skill.icon, skillReady, skillReady ? "" : `${Math.ceil(cd / 1000)}`, skillReady ? 1 : 1 - cd / (hero.skill.cooldown * 1000), `${hero.skill.name}: ${hero.skill.desc}`);
      set("ult", hero.ult.icon, ultReady, ultReady ? "READY" : `${ult}%`, ult / 100, `${hero.ult.name}: ${hero.ult.desc}`);
      hud.classList.toggle("is-stealth", stealth > 0);
    },
    shield(amount) {
      $("shield").textContent = amount > 0 ? `+${amount}🛡` : "";
    },
    vitals({ hp, weapon, mag, reserve, reloadProgress }) {
      const w = WEAPONS[weapon];
      $("hp").textContent = hp;
      $("hpbar").style.width = `${hp}%`;
      $("hpbar").classList.toggle("is-low", hp <= 30);
      $("weapon").textContent = w?.name ?? "";
      $("ammo-count").hidden = !w?.gun;
      $("mag").textContent = mag;
      $("reserve").textContent = reserve;
      $("mag").classList.toggle("is-low", !!w?.gun && mag <= Math.ceil(w.magazine * 0.2));
      $("reloadbar").style.width = reloadProgress !== null ? `${Math.round(reloadProgress * 100)}%` : "0%";
    },
    // slots: [{id}] in order; current: weapon id; canDrop: what's in hand can be thrown (not the knife)
    slots(list, current, canDrop) {
      const key = `${list.map((s) => s.id).join()}|${current}|${canDrop}`;
      if (key === slotsKey) return;
      slotsKey = key;
      const el = $("slots");
      el.replaceChildren(
        ...list.map((s) => {
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.slot = s.id;
          b.className = `fps-slot${s.id === current ? " is-on" : ""}${s.id === "bomb" ? " is-bomb" : ""}`;
          const icon = document.createElement("span");
          icon.textContent = SLOT_ICONS[s.id];
          const label = document.createElement("small");
          label.textContent = touch ? WEAPONS[s.id].name : `${WEAPONS[s.id].slot} ${WEAPONS[s.id].name}`;
          b.append(icon, label);
          return b;
        })
      );
      if (canDrop) {
        const drop = document.createElement("button");
        drop.type = "button";
        drop.dataset.drop = "";
        drop.className = "fps-slot fps-slot--drop";
        drop.textContent = `${touch ? "Drop" : "G drop"} ${SLOT_ICONS[current] ?? ""}`;
        el.appendChild(drop);
      }
    },
    crosshair(spreadPx, hidden = false) {
      $("crosshair").style.setProperty("--gap", `${Math.round(4 + spreadPx)}px`);
      $("crosshair").classList.toggle("is-melee", hidden);
    },
    // Red X on every hit; bigger for headshots, backstabs and kills.
    hitmarker(big, kill = false) {
      const m = $("hitmarker");
      m.classList.remove("is-on", "is-big", "is-kill");
      void m.offsetWidth;
      m.classList.add("is-on");
      m.classList.toggle("is-big", big);
      m.classList.toggle("is-kill", kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => m.classList.remove("is-on"), kill ? 380 : 240);
    },
    hurt() {
      const v = $("vignette");
      v.classList.remove("is-on");
      void v.offsetWidth;
      v.classList.add("is-on");
    },
    banner(title, subtitle = "", tone = "", ms = 2200) {
      const b = $("banner");
      b.querySelector("strong").textContent = title;
      b.querySelector("small").textContent = subtitle;
      b.className = `fps-banner is-on ${tone}`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => b.classList.remove("is-on"), ms);
    },
    // Second banner line for streaks, aces, clutches and match point, so it never hides the round banner.
    // Callouts queue up: SAVAGE, then ACE, then CLUTCH each get their moment instead of overwriting.
    callout(title, subtitle = "", tone = "", ms = 2200) {
      callouts.push({ title, subtitle, tone, ms });
      if (!showing) return showCallout();
      // Something is waiting: let the current one finish its minimum time, then move on.
      const left = Math.max(0, CALLOUT_MIN_MS - (performance.now() - showing.at));
      clearTimeout(calloutTimer);
      calloutTimer = setTimeout(showCallout, left);
    },
    kill(killer, victim, { head, back, weapon, mine, me, helpers = [], assisted = false }) {
      const row = document.createElement("div");
      row.className = `fps-feed-row${mine ? " is-mine" : ""}${me ? " is-me" : ""}`;
      const k = document.createElement("span");
      k.className = `is-${killer.team}`;
      k.textContent = killer.name;
      const icon = document.createElement("em");
      icon.textContent = `${SLOT_ICONS[weapon] ?? "🎯"}${head ? " 💀" : ""}${back ? " 🗡️" : ""}`;
      const v = document.createElement("span");
      v.className = `is-${victim.team}`;
      v.textContent = victim.name;
      row.append(k);
      if (helpers.length) {
        const help = document.createElement("small");
        help.className = "fps-feed-assist";
        help.textContent = `+ ${helpers.map((h) => h.name).join(", ")}`;
        row.append(help);
      }
      if (assisted) row.classList.add("is-mine");
      row.append(icon, v);
      feed.prepend(row);
      while (feed.childElementCount > 5) feed.lastElementChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    prompt(text, progress) {
      const p = $("prompt");
      p.classList.toggle("is-on", !!text);
      p.querySelector("span").textContent = text ?? "";
      p.querySelector(".fps-progress div").style.width = `${Math.round((progress ?? 0) * 100)}%`;
      p.querySelector(".fps-progress").classList.toggle("hidden", progress === undefined);
    },
    carrier(on, text = "") {
      $("bombtag").classList.toggle("is-on", on);
      $("bombtag").textContent = text;
    },
    dead(on, info = null) {
      $("dead").classList.toggle("is-on", on);
      if (!on) return;
      $("spectate").textContent = info ? `👁 ${info.name} · ${info.hp > 0 ? info.hp : 0} HP · ${info.mode}` : "No teammates left to watch";
      $("spec-help").textContent = !info
        ? ""
        : info.touch
          ? "◀ ▶ switch player · 🎥 change camera"
          : `Scroll: switch player${info.count > 1 ? ` (${info.count})` : ""} · Click: change camera${info.mode === "Free look" ? " · Mouse: look around" : ""}`;
    },
    // Desktop: shown whenever the mouse isn't captured (Esc). Touch: opened from the menu button.
    pause(on, { first = false } = {}) {
      $("pause").classList.toggle("is-on", on);
      $("pause-title").textContent = first ? "Click to play" : "Paused";
      $("resume").textContent = first ? "Play" : "Resume";
      if (!on) showConfirm(false);
    },
    get paused() {
      return $("pause").classList.contains("is-on");
    },
    board(on, players, meId) {
      const board = $("board");
      board.classList.toggle("is-on", on);
      if (!on) return;
      const body = board.querySelector("tbody");
      body.replaceChildren(
        ...[...players]
          .sort((a, b) => (a.team === b.team ? b.kills - a.kills : a.team === "red" ? -1 : 1))
          .map((p) => {
            const tr = document.createElement("tr");
            tr.className = `is-${p.team}${p.id === meId ? " is-me" : ""}`;
            for (const value of [`${p.name}${p.bot ? " 🤖" : ""}`, p.kills, p.deaths, p.assists ?? 0]) {
              const td = document.createElement("td");
              td.textContent = value;
              tr.appendChild(td);
            }
            return tr;
          })
      );
    },
    dispose() {
      clearTimeout(bannerTimer);
      clearTimeout(hitTimer);
      clearTimeout(blinkTimer);
      clearTimeout(calloutTimer);
      hud.remove();
    },
  };
  return hudApi;
}
