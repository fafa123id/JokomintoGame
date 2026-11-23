import { api } from "../api.js";
import { formatUid } from "../friends.js";
import { MAPS } from "./shared/maps.js";

// Party bar, invite sheet, incoming invite popup and the custom lobby screens for Jokoman.
// Pure view builders: every action goes out through the callbacks; the server answers with state.
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

const MODE_NAMES = { bomb: "💣 Bomb", tdm: "⚔️ Team Deathmatch", hostage: "🧑‍🤝‍🧑 Hostage" };
const SLOT_NAMES = { red: "Red", blue: "Blue", spec: "Spectators" };
const SLOT_MAX = { red: 5, blue: 5, spec: 4 };
const mapName = (id) => (id === "random" ? "🎲 Random" : MAPS[id]?.name ?? id);

function personRow(p, { leader, me }) {
  const row = el(`<div class="fps-person"><span class="fps-person-name"></span><span class="fps-person-tags"></span></div>`);
  row.querySelector(".fps-person-name").textContent = p.name;
  row.querySelector(".fps-person-tags").textContent = [leader ? "👑" : "", p.id === me ? "YOU" : "", p.online ? "" : "📴"].filter(Boolean).join(" ");
  row.classList.toggle("is-me", p.id === me);
  row.classList.toggle("is-offline", !p.online);
  return row;
}

function smallButton(text, title, onClick) {
  const b = el(`<button type="button" class="fps-mini"></button>`);
  b.textContent = text;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", onClick);
  return b;
}

// ---------- party ----------

export function partyBar(party, me, { onInvite, onLeave, onKick, onPromote }) {
  const bar = el(`
    <section class="fps-party">
      <header><strong></strong><div class="fps-party-actions"></div></header>
      <div class="fps-party-list"></div>
    </section>`);
  const actions = bar.querySelector(".fps-party-actions");
  const invite = el(`<button type="button" class="fps-pill">+ Invite</button>`);
  invite.addEventListener("click", onInvite);
  actions.append(invite);
  if (!party) {
    bar.querySelector("strong").textContent = "👥 Play with friends";
    bar.querySelector(".fps-party-list").append(el(`<p class="fps-party-hint">Invite friends to a party: you queue together and always land on the same team.</p>`));
    return bar;
  }
  bar.querySelector("strong").textContent = `👥 Party ${party.members.length}/5`;
  const leave = el(`<button type="button" class="fps-pill is-ghost">Leave</button>`);
  leave.addEventListener("click", onLeave);
  actions.append(leave);
  const leader = party.leader === me;
  bar.querySelector(".fps-party-list").append(
    ...party.members.map((p) => {
      const row = personRow(p, { leader: p.id === party.leader, me });
      if (leader && p.id !== me) row.append(smallButton("👑", `Make ${p.name} leader`, () => onPromote(p.id)), smallButton("✕", `Remove ${p.name}`, () => onKick(p.id)));
      return row;
    })
  );
  return bar;
}

// ---------- invite sheet ----------

export function inviteSheet(root, kind, send) {
  root.querySelector(".fps-sheet")?.remove();
  const sheet = el(`
    <div class="fps-sheet" role="dialog" aria-modal="true">
      <div class="fps-sheet-card">
        <header><h2></h2><button type="button" class="fps-mini" data-close aria-label="Close">✕</button></header>
        <form class="fps-uid" data-uid>
          <input type="text" maxlength="9" placeholder="Player ID (e.g. ABCD-1234)" autocomplete="off" spellcheck="false" aria-label="Player ID" />
          <button type="submit" class="fps-pill">Invite</button>
        </form>
        <small>Online friends</small>
        <div class="fps-friends"><p class="fps-party-hint">Loading…</p></div>
      </div>
    </div>`);
  sheet.querySelector("h2").textContent = kind === "lobby" ? "Invite to lobby" : "Invite to party";
  const close = () => sheet.remove();
  sheet.querySelector("[data-close]").addEventListener("click", close);
  sheet.addEventListener("click", (e) => e.target === sheet && close());
  sheet.querySelector("[data-uid]").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = sheet.querySelector("input");
    const uid = input.value.trim();
    if (!uid) return;
    send({ t: "invite", kind, uid });
    input.value = "";
  });
  root.append(sheet);
  api("/api/friends").then((res) => {
    const list = sheet.querySelector(".fps-friends");
    const friends = (res.friends ?? []).filter((f) => f.status !== "offline");
    if (res.error) return (list.innerHTML = `<p class="fps-party-hint">Register an account to invite friends from your list. You can still invite by Player ID.</p>`);
    if (!friends.length) return (list.innerHTML = `<p class="fps-party-hint">No friends online right now.</p>`);
    list.replaceChildren(
      ...friends.map((f) => {
        const row = el(`<div class="fps-person"><span class="fps-person-name"></span><span class="fps-person-tags"></span></div>`);
        row.querySelector(".fps-person-name").textContent = f.name;
        row.querySelector(".fps-person-tags").textContent = f.status === "online" ? "🟢" : f.status === "away" ? "🌙" : "🎮";
        const button = el(`<button type="button" class="fps-pill">Invite</button>`);
        button.addEventListener("click", () => {
          send({ t: "invite", kind, friendId: f.id });
          button.disabled = true;
          button.textContent = "Sent";
        });
        row.append(button);
        return row;
      })
    );
  });
  return sheet;
}

// ---------- incoming invite (anywhere in the app) ----------

let popup = null;

export function showInvitePopup(invite, { onAccept, onDecline }) {
  closeInvitePopup();
  const view = el(`
    <div class="fps-invite" role="alertdialog" aria-live="assertive">
      <div class="fps-invite-card">
        <span class="fps-invite-icon">🔫</span>
        <h2></h2>
        <p></p>
        <div class="fps-invite-bar"><span></span></div>
        <div class="fps-invite-actions">
          <button type="button" class="fps-pill is-ghost" data-decline>Decline</button>
          <button type="button" class="fps-pill" data-accept>Join</button>
        </div>
      </div>
    </div>`);
  view.querySelector("h2").textContent = `${invite.from.name} invites you`;
  view.querySelector("p").textContent = `${invite.kind === "lobby" ? "Custom lobby" : "Party"} · Jokoman 5v5 · ${MODE_NAMES[invite.mode] ?? ""} · ID ${formatUid(invite.from.uid)}`;
  view.querySelector(".fps-invite-bar span").style.animationDuration = `${invite.expiresInSec}s`;
  const timer = setTimeout(() => answer(false), invite.expiresInSec * 1000);
  const answer = (accept) => {
    if (popup?.id !== invite.id) return;
    closeInvitePopup();
    (accept ? onAccept : onDecline)(invite);
  };
  view.querySelector("[data-accept]").addEventListener("click", () => answer(true));
  view.querySelector("[data-decline]").addEventListener("click", () => answer(false));
  document.body.append(view);
  popup = { id: invite.id, view, timer };
}

export function closeInvitePopup(id = null) {
  if (!popup || (id && popup.id !== id)) return;
  clearTimeout(popup.timer);
  popup.view.remove();
  popup = null;
}

// ---------- ranked ----------

// Tier badge with the level and progress to the next one.
export function rankCard(profile, { onLadder }) {
  const r = profile?.rank;
  const card = el(`
    <section class="fps-rank">
      <div class="fps-rank-badge"><span class="fps-rank-icon"></span><div><strong></strong><small></small></div></div>
      <div class="fps-rank-bar"><span></span></div>
      <div class="fps-rank-row"><small class="fps-rank-mode">🎲 Mode is random each match: 💣 Bomb or 🧑‍🤝‍🧑 Hostage</small><button type="button" class="fps-pill is-ghost" data-ladder>🏆 Ladder</button></div>
      <p class="fps-party-hint"></p>
    </section>`);
  card.style.setProperty("--rank", r?.color ?? "#94a3b8");
  card.querySelector(".fps-rank-icon").textContent = r?.icon ?? "❔";
  card.querySelector("strong").textContent = r?.label ?? "Unranked";
  card.querySelector("small").textContent = r ? `${r.points} RP${r.next ? ` · ${r.next - r.points} to go` : ""}${profile.position ? ` · #${profile.position}` : ""}` : "";
  card.querySelector(".fps-rank-bar span").style.width = `${Math.round((r?.progress ?? 0) * 100)}%`;
  card.querySelector("[data-ladder]").addEventListener("click", onLadder);
  card.querySelector("p").textContent = profile?.bannedMs > 0 ? `You left a ranked match: ranked opens again in ${Math.ceil(profile.bannedMs / 60_000)} min` : "Parties up to 3 · bots fill empty slots at your level · Joko Emperor = top 10 Joko Masters";
  return card;
}

export function ladderSheet(root, { top, me }) {
  root.querySelector(".fps-sheet")?.remove();
  const sheet = el(`
    <div class="fps-sheet" role="dialog" aria-modal="true">
      <div class="fps-sheet-card fps-ladder">
        <header><h2>🏆 Ranked ladder</h2><button type="button" class="fps-mini" data-close aria-label="Close">✕</button></header>
        <div class="fps-ladder-me"></div>
        <ol></ol>
      </div>
    </div>`);
  const close = () => sheet.remove();
  sheet.querySelector("[data-close]").addEventListener("click", close);
  sheet.addEventListener("click", (e) => e.target === sheet && close());
  const mine = sheet.querySelector(".fps-ladder-me");
  mine.textContent = `You: ${me.rank.icon} ${me.rank.label} · ${me.points} RP${me.position ? ` · #${me.position}` : ""} · ${me.wins}/${me.games} wins`;
  const list = sheet.querySelector("ol");
  if (!top.length) list.append(el(`<p class="fps-party-hint">Nobody on the ladder yet. Registered players appear here after a ranked match.</p>`));
  for (const row of top) {
    const li = el(`<li><span class="fps-ladder-pos"></span><span class="fps-ladder-icon"></span><span class="fps-person-name"></span><span class="fps-ladder-rp"></span></li>`);
    li.querySelector(".fps-ladder-pos").textContent = `#${row.position}`;
    li.querySelector(".fps-ladder-icon").textContent = row.rank.icon;
    li.querySelector(".fps-ladder-icon").title = row.rank.label;
    li.querySelector(".fps-person-name").textContent = row.name;
    li.querySelector(".fps-ladder-rp").textContent = `${row.points} RP`;
    li.classList.toggle("is-emperor", row.rank.id === "emperor");
    list.append(li);
  }
  root.append(sheet);
}

// End of a ranked match: the RP change, what it was made of, and any promotion.
export function rpSummary(change) {
  const box = el(`<div class="fps-rp"><strong></strong><div class="fps-rp-rank"></div><div class="fps-rp-parts"></div></div>`);
  const sign = change.delta >= 0 ? "+" : "";
  box.classList.toggle("is-down", change.delta < 0);
  box.querySelector("strong").textContent = `${sign}${change.delta} RP`;
  const a = change.rankBefore;
  const b = change.rankAfter;
  const moved = a.label !== b.label;
  box.querySelector(".fps-rp-rank").textContent = moved ? `${a.icon} ${a.label} → ${b.icon} ${b.label}${b.index > a.index || (b.index === a.index && b.points > a.points) ? " · PROMOTED!" : ""}` : `${b.icon} ${b.label} · ${b.points} RP`;
  if (change.left) box.querySelector(".fps-rp-parts").textContent = "Left the match early";
  else {
    const labels = { kills: "Kills", assists: "Assists", objectives: "Objectives", deaths: "Deaths", cost: "Entry cost" };
    for (const [key, value] of Object.entries(change.parts ?? {})) {
      if (!value) continue;
      const chip = el(`<span></span>`);
      chip.textContent = `${labels[key]} ${value > 0 ? "+" : ""}${value}`;
      box.querySelector(".fps-rp-parts").append(chip);
    }
  }
  return box;
}

// ---------- custom lobby ----------

export function customEntry({ inParty, onCreate, onJoin, onBack }) {
  const view = el(`
    <div class="fps-lobby fps-custom-entry">
      <div class="fps-lobby-head"><h1>🛠️ Custom <span>lobby</span></h1><p>Private match: pick the teams, the map and the rules</p></div>
      <button type="button" class="fps-cta" data-create>Create lobby</button>
      <form class="fps-uid fps-code" data-join>
        <input type="text" maxlength="6" placeholder="Lobby code" autocomplete="off" spellcheck="false" aria-label="Lobby code" />
        <button type="submit" class="fps-pill">Join</button>
      </form>
      <p class="fps-party-hint" data-warn></p>
      <button type="button" class="fps-back" data-back>← Back</button>
    </div>`);
  view.querySelector("[data-warn]").textContent = inParty ? "Creating or joining a lobby takes you out of your party (invite them to the lobby instead)." : "";
  view.querySelector("[data-create]").addEventListener("click", onCreate);
  view.querySelector("[data-join]").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = view.querySelector("input").value.trim();
    if (code) onJoin(code);
  });
  view.querySelector("input").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase()));
  view.querySelector("[data-back]").addEventListener("click", onBack);
  return view;
}

function settingField(label, control) {
  const field = el(`<label class="fps-setting"><small></small></label>`);
  field.querySelector("small").textContent = label;
  field.append(control);
  return field;
}

function select(options, value, onChange, disabled) {
  const s = el(`<select class="fps-select"></select>`);
  for (const [v, text] of options) {
    const o = document.createElement("option");
    o.value = String(v);
    o.textContent = text;
    o.selected = v === value;
    s.append(o);
  }
  s.disabled = disabled;
  s.addEventListener("change", () => onChange(options.find(([v]) => String(v) === s.value)[0]));
  return s;
}

export function customLobby(lobby, me, { onSettings, onSlot, onKick, onPromote, onInvite, onStart, onLeave }) {
  const host = lobby.host === me;
  const s = lobby.settings;
  const o = lobby.options;
  const view = el(`
    <div class="fps-lobby fps-custom">
      <div class="fps-custom-head">
        <h1>🛠️ Custom lobby</h1>
        <button type="button" class="fps-code-chip" title="Copy code"><small>CODE</small><strong></strong></button>
      </div>
      <div class="fps-settings"></div>
      <div class="fps-teams"></div>
      <div class="fps-custom-actions"></div>
      <p class="fps-party-hint" data-note></p>
    </div>`);
  const chip = view.querySelector(".fps-code-chip");
  chip.querySelector("strong").textContent = lobby.code;
  chip.addEventListener("click", () => {
    navigator.clipboard?.writeText(lobby.code).catch(() => {});
    chip.classList.add("is-copied");
    setTimeout(() => chip.classList.remove("is-copied"), 1200);
  });

  const settings = view.querySelector(".fps-settings");
  settings.append(
    settingField("Mode", select(o.modes.map((m) => [m, MODE_NAMES[m] ?? m]), s.mode, (mode) => onSettings({ mode }), !host)),
    settingField("Map", select(o.maps.map((m) => [m, mapName(m)]), s.map, (map) => onSettings({ map }), !host)),
    s.mode === "tdm"
      ? settingField("Kill target", select(o.killTarget.map((k) => [k, `${k} kills`]), s.killTarget, (killTarget) => onSettings({ killTarget }), !host))
      : settingField("Rounds to win", select(o.roundsToWin.map((r) => [r, `First to ${r}`]), s.roundsToWin, (roundsToWin) => onSettings({ roundsToWin }), !host)),
    settingField("Empty slots", select([[true, "🤖 Fill with bots"], [false, "Leave empty"]], s.bots, (bots) => onSettings({ bots }), !host))
  );

  const mySlot = lobby.players.find((p) => p.id === me)?.slot;
  const slots = view.querySelector(".fps-teams");
  for (const slot of ["red", "blue", "spec"]) {
    const people = lobby.players.filter((p) => p.slot === slot);
    const col = el(`<section class="fps-team-col is-${slot}"><header><strong></strong></header><div></div></section>`);
    col.querySelector("strong").textContent = `${SLOT_NAMES[slot]} ${people.length}/${SLOT_MAX[slot]}`;
    if (mySlot !== slot && people.length < SLOT_MAX[slot]) {
      const join = el(`<button type="button" class="fps-pill">${slot === "spec" ? "Watch" : "Join"}</button>`);
      join.addEventListener("click", () => onSlot(me, slot));
      col.querySelector("header").append(join);
    }
    const list = col.querySelector("div");
    for (const p of people) {
      const row = personRow(p, { leader: p.id === lobby.host, me });
      if (host && p.id !== me) {
        const move = select(["red", "blue", "spec"].map((x) => [x, `→ ${SLOT_NAMES[x]}`]), p.slot, (to) => onSlot(p.id, to), false);
        move.classList.add("is-mini");
        move.setAttribute("aria-label", `Move ${p.name}`);
        row.append(move, smallButton("👑", `Make ${p.name} host`, () => onPromote(p.id)), smallButton("✕", `Remove ${p.name}`, () => onKick(p.id)));
      }
      list.append(row);
    }
    if (slot !== "spec" && s.bots) {
      const bots = SLOT_MAX[slot] - people.length;
      if (bots > 0) list.append(el(`<p class="fps-party-hint">+ ${bots} bot${bots > 1 ? "s" : ""}</p>`));
    }
    slots.append(col);
  }

  const actions = view.querySelector(".fps-custom-actions");
  const invite = el(`<button type="button" class="fps-back">+ Invite</button>`);
  invite.addEventListener("click", onInvite);
  const start = el(`<button type="button" class="fps-cta"></button>`);
  const playing = lobby.status === "playing";
  start.textContent = playing ? "Match in progress…" : host ? "Start match" : "Waiting for the host";
  start.disabled = !host || playing;
  start.addEventListener("click", onStart);
  const leave = el(`<button type="button" class="fps-back">Leave lobby</button>`);
  leave.addEventListener("click", onLeave);
  actions.append(start, invite, leave);
  view.querySelector("[data-note]").textContent = "Custom matches don't give coins or leaderboard points.";
  return view;
}
