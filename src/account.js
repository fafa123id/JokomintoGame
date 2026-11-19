import { api, state, setPet } from "./api.js";
import { updateChar, updateContext, showMessage } from "./components.js";
import { openModal, closeModal, html, ui } from "./modal.js";

let googleClientId = null;
let googleInitialized = false;
let pendingSession = null;

async function applySession(user) {
  state.user = user;
  const { pet } = await api("/api/pet");
  setPet(pet);
  renderAccountBadge();
  updateContext();
  updateChar();
  window.dispatchEvent(new CustomEvent("session:changed"));
}

function finishPending(ok) {
  pendingSession?.(ok);
  pendingSession = null;
}

export function requireSession() {
  if (state.user) return Promise.resolve(true);
  return new Promise((resolve) => {
    pendingSession = resolve;
    showGuestView();
  });
}

async function handleAuthResponse(res, errEl) {
  if (res.error) {
    errEl.textContent = res.error;
    return false;
  }
  await applySession(res.user);
  closeModal({ silent: true });
  finishPending(true);
  if (res.progressKept) showMessage("Progress saved to your account!", "success", 2500, true);
  else if (res.guestDiscarded) showMessage(`Welcome back, ${res.user.name}!`, "success", 2500, true);
  return true;
}

function bindSubmit(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const errEl = form.querySelector("[data-error]");
    btn.disabled = true;
    errEl.textContent = "";
    try {
      await handler(errEl);
    } finally {
      btn.disabled = false;
    }
  });
}

const googleSection = () => `
  <div data-google class="hidden">
    <div class="flex items-center gap-3 my-4 text-gray-400 text-xs">
      <span class="flex-1 h-px bg-gray-200"></span>OR<span class="flex-1 h-px bg-gray-200"></span>
    </div>
    <div data-google-btn class="flex justify-center"></div>
  </div>`;

function showGuestView() {
  const view = html(`
    <div>
      <h2 class="${ui.title}">What's your name?</h2>
      <p class="${ui.subtitle}">Play as a guest. You can save your progress later.</p>
      <form class="space-y-3" novalidate>
        <input name="name" type="text" maxlength="20" placeholder="Your name" class="${ui.input}" autocomplete="nickname">
        <p data-error class="${ui.error}" role="alert"></p>
        <button type="submit" class="${ui.primary}">Play as Guest</button>
      </form>
      ${googleSection()}
      <p class="text-center text-sm text-gray-600 mt-5">
        Already have an account? <button type="button" data-go="login" class="${ui.link}">Login</button>
      </p>
    </div>`);
  const form = view.querySelector("form");
  bindSubmit(form, async (errEl) => {
    const res = await api("/api/auth/guest", { name: form.name.value });
    await handleAuthResponse(res, errEl);
  });
  view.querySelector('[data-go="login"]').addEventListener("click", () => showCredentialsView("login"));
  renderGoogleButton(view);
  openModal(view, { onClose: () => finishPending(false) });
}

function showCredentialsView(mode) {
  const isRegister = mode === "register";
  const isGuest = !!state.user?.isGuest;
  const note = isRegister
    ? isGuest
      ? "Your guest progress will be saved to this account and you'll join the global leaderboard."
      : "Create an account to sync your progress and join the global leaderboard."
    : isGuest
      ? "Logging in loads your account's progress. Your current guest progress will be discarded."
      : "Login to continue your saved progress.";

  const view = html(`
    <div>
      <h2 class="${ui.title}">${isRegister ? "Save Progress" : "Login"}</h2>
      <p data-note class="${ui.subtitle}"></p>
      <form class="space-y-3" novalidate>
        ${isRegister ? `<input name="name" type="text" maxlength="20" placeholder="Name" class="${ui.input}" autocomplete="nickname">` : ""}
        <input name="email" type="email" placeholder="Email" class="${ui.input}" autocomplete="email">
        <input name="password" type="password" maxlength="72" placeholder="${isRegister ? "Password (min 8 chars)" : "Password"}"
          class="${ui.input}" autocomplete="${isRegister ? "new-password" : "current-password"}">
        <p data-error class="${ui.error}" role="alert"></p>
        <button type="submit" class="${ui.primary}">${isRegister ? "Create Account" : "Login"}</button>
      </form>
      ${googleSection()}
      <p class="text-center text-sm text-gray-600 mt-5">
        ${isRegister ? "Already have an account?" : "Don't have an account?"}
        <button type="button" data-switch class="${ui.link}">${isRegister ? "Login" : "Register"}</button>
      </p>
    </div>`);

  view.querySelector("[data-note]").textContent = note;
  const form = view.querySelector("form");
  if (isRegister && state.user?.name) form.name.value = state.user.name;

  bindSubmit(form, async (errEl) => {
    const body = { email: form.email.value, password: form.password.value };
    if (isRegister && form.name.value.trim()) body.name = form.name.value;
    const res = await api(isRegister ? "/api/auth/register" : "/api/auth/login", body);
    if (!(await handleAuthResponse(res, errEl))) form.password.value = "";
  });
  view.querySelector("[data-switch]").addEventListener("click", () => showCredentialsView(isRegister ? "login" : "register"));

  renderGoogleButton(view);
  openModal(view, { onClose: () => finishPending(false) });
}

function showAccountView() {
  const user = state.user;
  const view = html(`
    <div>
      <div class="text-center mb-5">
        <div class="text-5xl mb-2">${user.isGuest ? "👤" : "🧑‍🚀"}</div>
        <h2 data-name class="font-game text-2xl text-gray-800"></h2>
        <p data-status class="text-sm text-gray-500"></p>
      </div>
      <div data-actions class="space-y-3"></div>
    </div>`);
  view.querySelector("[data-name]").textContent = user.name;
  view.querySelector("[data-status]").textContent = user.isGuest
    ? "Guest · progress is only on this device"
    : `Synced · ${user.email ?? ""}`;

  const actions = view.querySelector("[data-actions]");
  const button = (label, cls, onClick) => {
    const b = html(`<button type="button" class="${cls}"></button>`);
    b.textContent = label;
    b.addEventListener("click", onClick);
    actions.appendChild(b);
  };

  if (user.isGuest) {
    button("Save Progress (Register)", ui.primary, () => showCredentialsView("register"));
    button("Login to Existing Account", ui.secondary, () => showCredentialsView("login"));
    button("Reset Guest", ui.danger, () => {
      if (confirm("Your guest progress will be permanently deleted. Continue?")) logout();
    });
  } else {
    button("Logout", ui.danger, logout);
  }
  openModal(view);
}

async function logout() {
  await api("/api/auth/logout", {});
  if (googleInitialized) window.google?.accounts.id.disableAutoSelect();
  location.reload();
}

async function loadGoogle() {
  const { googleClientId: id } = await api("/api/auth/config");
  if (!id) return;
  googleClientId = id;
  await new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = resolve;
    s.onerror = resolve;
    document.head.appendChild(s);
  });
  if (!window.google?.accounts?.id) return;
  google.accounts.id.initialize({
    client_id: googleClientId,
    callback: async ({ credential }) => {
      const errEl = document.querySelector("#appModal [data-error]");
      const res = await api("/api/auth/google", { credential });
      await handleAuthResponse(res, errEl ?? document.createElement("p"));
    },
  });
  googleInitialized = true;
  const openModalRoot = document.getElementById("appModal");
  if (openModalRoot) renderGoogleButton(openModalRoot);
}

function renderGoogleButton(root) {
  const section = root.querySelector("[data-google]");
  if (!googleInitialized || !section) return;
  section.classList.remove("hidden");
  google.accounts.id.renderButton(section.querySelector("[data-google-btn]"), {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "continue_with",
    width: 280,
  });
}

function renderAccountBadge() {
  const label = document.getElementById("accountLabel");
  if (!label) return;
  label.textContent = state.user ? `${state.user.name}${state.user.isGuest ? " (Guest)" : ""}` : "Login";
}

function buildToolbar() {
  const bar = html(`
    <div class="fixed bottom-5 left-5 z-30 flex gap-2">
      <button type="button" data-open-leaderboard aria-label="Leaderboard"
        class="h-12 w-12 rounded-full bg-white/90 text-xl shadow-lg hover:bg-white">🏆</button>
      <button type="button" data-open-account
        class="h-12 px-4 rounded-full bg-white/90 text-sm font-semibold text-gray-700 shadow-lg hover:bg-white flex items-center gap-2">
        <span>👤</span><span id="accountLabel" class="max-w-[9rem] truncate">Login</span>
      </button>
    </div>`);
  bar.querySelector("[data-open-account]").addEventListener("click", () => {
    if (state.user) showAccountView();
    else showCredentialsView("login");
  });
  bar.querySelector("[data-open-leaderboard]").addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("leaderboard:open"));
  });
  document.body.appendChild(bar);
}

export async function initAccount() {
  buildToolbar();
  window.addEventListener("auth:required", () => {
    state.user = null;
    renderAccountBadge();
    requireSession();
  });
  window.addEventListener("account:register", () => showCredentialsView("register"));
  loadGoogle();

  const res = await api("/api/auth/me", undefined, { silent401: true });
  if (res.user) await applySession(res.user);
}
