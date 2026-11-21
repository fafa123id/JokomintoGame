import { api, state } from "./api.js";
import { html, openModal, isOpen, ui, confirmDialog } from "./modal.js";
import { showMessage } from "./components.js";

const STATUS = {
  online: { label: "Online", cls: "is-online" },
  playing: { label: "In a match", cls: "is-playing" },
  offline: { label: "Offline", cls: "is-offline" },
};

let view = null;
let badge = null;
let pending = 0;

export const formatUid = (uid = "") => `${uid.slice(0, 4)}-${uid.slice(4)}`;

// Read-only UID card with a copy button; used here and in the account view.
export function uidCard(uid) {
  const card = html(`
    <div class="uid-card">
      <div>
        <small>Your player ID</small>
        <strong data-uid></strong>
      </div>
      <button type="button" class="uid-copy">Copy</button>
    </div>`);
  card.querySelector("[data-uid]").textContent = formatUid(uid);
  const button = card.querySelector("button");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(uid);
      button.textContent = "Copied ✓";
    } catch {
      button.textContent = uid;
    }
    setTimeout(() => (button.textContent = "Copy"), 1600);
  });
  return card;
}

function setBadge(count) {
  pending = count;
  if (!badge) return;
  badge.textContent = count > 9 ? "9+" : String(count);
  badge.hidden = count === 0;
}

function personRow(person, actions) {
  const row = html(`
    <div class="friend-row">
      <span class="friend-avatar" aria-hidden="true">🐰</span>
      <span class="friend-info"><strong></strong><small></small></span>
      <span class="friend-actions"></span>
    </div>`);
  row.querySelector("strong").textContent = person.name;
  const status = STATUS[person.status];
  const meta = row.querySelector("small");
  if (status) {
    meta.innerHTML = `<i class="friend-dot ${status.cls}"></i>`;
    meta.append(` ${status.label} · ${formatUid(person.uid)}`);
  } else {
    meta.textContent = formatUid(person.uid);
  }
  row.querySelector(".friend-actions").append(...actions);
  return row;
}

function actionButton(label, title, onClick, cls = "") {
  const b = html(`<button type="button" class="friend-btn ${cls}"></button>`);
  b.textContent = label;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", onClick);
  return b;
}

function section(title, items, empty) {
  const box = html(`<div class="mb-4"><h3 class="friend-heading"></h3><div class="space-y-2" data-items></div></div>`);
  box.querySelector("h3").textContent = title;
  const list = box.querySelector("[data-items]");
  if (items.length) list.append(...items);
  else list.append(html(`<p class="text-sm text-gray-400 text-center py-2">${empty}</p>`));
  return box;
}

async function render() {
  if (!view) return;
  const body = view.querySelector("[data-body]");
  const res = await api("/api/friends");
  if (res.error) {
    showMessage(res.error, "error", 2500);
    body.replaceChildren(html(`<p class="text-sm text-gray-400 text-center">Couldn't load your friends. Try again later.</p>`));
    return;
  }
  setBadge(res.incoming.length);

  const invite = (type, friend) => () => window.dispatchEvent(new CustomEvent("versus:invite", { detail: { type, friendId: friend.id, name: friend.name } }));
  const friends = res.friends
    .sort((a, b) => (a.status === "offline") - (b.status === "offline"))
    .map((f) =>
      personRow(f, [
        actionButton("❌⭕", `Invite ${f.name} to tic-tac-toe`, invite("tictactoe", f), f.status === "online" ? "" : "is-hidden"),
        actionButton("♟️", `Invite ${f.name} to chess`, invite("chess", f), f.status === "online" ? "" : "is-hidden"),
        actionButton("✕", `Remove ${f.name}`, () => remove(f), "is-subtle"),
      ])
    );
  const incoming = res.incoming.map((p) =>
    personRow({ ...p, status: null }, [
      actionButton("✓", `Accept ${p.name}`, () => respond(p, true), "is-good"),
      actionButton("✕", `Decline ${p.name}`, () => respond(p, false), "is-subtle"),
    ])
  );
  const outgoing = res.outgoing.map((p) => personRow({ ...p, status: null }, [html(`<span class="text-xs text-gray-400">Pending</span>`)]));

  body.replaceChildren(
    ...(incoming.length ? [section("Friend requests", incoming, "")] : []),
    section(`Friends (${res.friends.length})`, friends, "No friends yet. Share your ID or add someone's!"),
    ...(outgoing.length ? [section("Sent requests", outgoing, "")] : [])
  );
}

async function respond(person, accept) {
  const res = await api("/api/friends/respond", { userId: person.id, accept });
  if (res.error) showMessage(res.error, "error", 2000, true);
  else if (accept) showMessage(`You and ${person.name} are now friends 🎉`, "success", 2000, true);
  render();
}

async function remove(friend) {
  const ok = await confirmDialog({
    title: "Remove friend?",
    message: `${friend.name} will be removed from your friend list.`,
    confirmText: "Remove",
    cancelText: "Keep",
    image: "/asset/char/sad.png",
  });
  if (ok) await api("/api/friends/remove", { userId: friend.id });
  openFriends();
}

export async function addFriend({ uid, userId, name }) {
  const res = await api("/api/friends/request", uid ? { uid } : { userId });
  if (res.error) {
    showMessage(res.error, "error", 2200, true);
    return false;
  }
  const who = res.friend?.name ?? name ?? "them";
  showMessage(res.status === "accepted" ? `You and ${who} are now friends 🎉` : `Friend request sent to ${who} ✉️`, "success", 2200, true);
  return true;
}

function openFriends() {
  if (!state.user) return;
  view = html(`
    <div class="friends-panel">
      <h2 class="font-game text-2xl text-center text-gray-800 mb-3">👥 Friends</h2>
      <div data-uid class="mb-3"></div>
      <div data-content></div>
    </div>`);
  view.querySelector("[data-uid]").append(uidCard(state.user.uid));
  const content = view.querySelector("[data-content]");

  if (state.user.isGuest) {
    content.append(
      html(`<p class="text-sm text-gray-500 text-center mb-4">Friends need a registered account. Guests can still be invited to a match with the ID above.</p>`)
    );
    const register = html(`<button type="button" class="${ui.primary}">Register to add friends</button>`);
    register.addEventListener("click", () => window.dispatchEvent(new CustomEvent("account:register")));
    content.append(register);
  } else {
    const form = html(`
      <form class="friend-add mb-4" novalidate>
        <input name="uid" class="${ui.input}" placeholder="Friend's player ID" maxlength="9" autocomplete="off" autocapitalize="characters">
        <button type="submit" class="friend-add-btn">Add</button>
      </form>`);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const uid = form.uid.value.trim();
      if (!uid) return;
      if (await addFriend({ uid })) form.uid.value = "";
      render();
    });
    content.append(form, html(`<div data-body><p class="text-sm text-gray-400 text-center">Loading...</p></div>`));
    render();
  }
  openModal(view, { onClose: () => (view = null) });
}

export function initFriends() {
  const toolbar = document.querySelector("[data-open-leaderboard]")?.parentElement;
  const account = toolbar?.querySelector("[data-open-account]");
  if (!toolbar) return;
  const button = html(`<button type="button" aria-label="Friends" title="Friends"
    class="relative h-12 w-12 rounded-full bg-white/90 text-xl shadow-lg hover:bg-white">👥<span class="dock-badge" hidden></span></button>`);
  badge = button.querySelector(".dock-badge");
  button.addEventListener("click", openFriends);
  toolbar.insertBefore(button, account ?? null);

  const refresh = () => (view && isOpen() ? render() : refreshBadge());
  window.addEventListener("rt:friends:changed", refresh);
  window.addEventListener("rt:friends:presence", refresh);
  window.addEventListener("rt:friends:request", (e) => {
    setBadge(pending + 1);
    showMessage(`${e.detail.from.name} wants to be your friend 👋`, "success", 3000, true);
    refresh();
  });
  window.addEventListener("rt:friends:accepted", (e) => showMessage(`${e.detail.by.name} accepted your friend request 🎉`, "success", 2500, true));
  window.addEventListener("session:changed", refreshBadge);
}

async function refreshBadge() {
  if (!state.user || state.user.isGuest) return setBadge(0);
  const res = await api("/api/friends");
  if (!res.error) setBadge(res.incoming.length);
}
