import { api } from "./api.js";
import { openModal, html, ui } from "./modal.js";

const MEDALS = ["🥇", "🥈", "🥉"];

function row({ rank, name, score, wins, isMe }) {
  const el = html(`
    <li class="flex items-center gap-3 px-3 py-2 rounded-xl">
      <span data-rank class="w-8 text-center font-bold text-gray-500"></span>
      <span data-name class="flex-1 truncate text-gray-800"></span>
      <span class="text-right">
        <span data-score class="block font-bold text-gray-800"></span>
        <span data-wins class="block text-xs text-gray-400"></span>
      </span>
    </li>`);
  el.querySelector("[data-rank]").textContent = MEDALS[rank - 1] ?? `#${rank}`;
  el.querySelector("[data-name]").textContent = isMe ? `${name} (You)` : name;
  el.querySelector("[data-score]").textContent = score.toLocaleString();
  el.querySelector("[data-wins]").textContent = `${wins} wins`;
  if (isMe) el.classList.add("bg-blue-50", "ring-1", "ring-blue-300");
  return el;
}

function myCard(me) {
  if (!me) {
    return html(`<p class="text-center text-sm text-gray-500">Start playing to see how you compare.</p>`);
  }

  const card = html(`
    <div class="rounded-2xl p-4 bg-gradient-to-r from-blue-50 to-purple-50">
      <div class="flex items-center justify-between mb-2">
        <span data-name class="font-semibold text-gray-800 truncate"></span>
        <span data-badge class="text-xs px-2 py-0.5 rounded-full"></span>
      </div>
      <div class="grid grid-cols-3 text-center">
        <div><div data-score class="font-bold text-gray-800"></div><div class="text-xs text-gray-500">Score</div></div>
        <div><div data-wins class="font-bold text-gray-800"></div><div class="text-xs text-gray-500">Wins</div></div>
        <div><div data-rank class="font-bold text-gray-800"></div><div data-rank-label class="text-xs text-gray-500"></div></div>
      </div>
    </div>`);

  card.querySelector("[data-name]").textContent = me.name;
  const badge = card.querySelector("[data-badge]");
  badge.textContent = me.isGuest ? "Local" : "Synced";
  badge.classList.add(...(me.isGuest ? ["bg-yellow-100", "text-yellow-700"] : ["bg-green-100", "text-green-700"]));
  card.querySelector("[data-score]").textContent = me.score.toLocaleString();
  card.querySelector("[data-wins]").textContent = me.wins;
  card.querySelector("[data-rank]").textContent = `#${me.rank}`;
  card.querySelector("[data-rank-label]").textContent = me.isGuest ? "If synced" : "Global";

  if (me.isGuest) {
    const cta = html(`<button type="button" class="${ui.primary} mt-4">Register to join the leaderboard</button>`);
    cta.addEventListener("click", () => window.dispatchEvent(new CustomEvent("account:register")));
    card.appendChild(cta);
  }
  return card;
}

async function openLeaderboard() {
  const view = html(`
    <div>
      <h2 class="${ui.title}">🏆 Leaderboard</h2>
      <p data-subtitle class="${ui.subtitle}">Loading...</p>
      <div data-me class="mb-4"></div>
      <ol data-list class="space-y-1"></ol>
    </div>`);
  openModal(view);

  const data = await api("/api/leaderboard", undefined, { silent401: true });
  if (data.error) {
    view.querySelector("[data-subtitle]").textContent = data.error;
    return;
  }

  view.querySelector("[data-subtitle]").textContent = `Global top ${data.top.length} · ${data.totalPlayers} synced players`;
  view.querySelector("[data-me]").replaceChildren(myCard(data.me));
  const list = view.querySelector("[data-list]");
  if (data.top.length === 0) {
    list.replaceChildren(html(`<li class="text-center text-sm text-gray-500">No synced players yet.</li>`));
  } else {
    list.replaceChildren(...data.top.map(row));
  }
}

export function initLeaderboard() {
  window.addEventListener("leaderboard:open", openLeaderboard);
}
