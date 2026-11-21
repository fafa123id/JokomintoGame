let overlay = null;
let card = null;
let onCloseCallback = null;

function ensure() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.id = "appModal";
  overlay.className = "fixed inset-0 z-40 hidden items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
  overlay.innerHTML = `
    <div class="relative w-full max-w-sm max-h-[90vh] overflow-y-auto bg-white rounded-3xl p-6 shadow-2xl">
      <button type="button" data-modal-close aria-label="Close"
        class="absolute top-3 right-4 text-2xl leading-none text-gray-400 hover:text-gray-700">&times;</button>
      <div data-modal-body></div>
    </div>`;
  card = overlay.querySelector("[data-modal-body]");
  overlay.querySelector("[data-modal-close]").addEventListener("click", () => closeModal());
  overlay.addEventListener("click", (e) => e.target === overlay && closeModal());
  document.addEventListener("keydown", (e) => e.key === "Escape" && isOpen() && closeModal());
  document.body.appendChild(overlay);
}

export function openModal(content, { onClose } = {}) {
  ensure();
  card.replaceChildren(content);
  onCloseCallback = onClose ?? null;
  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
  content.querySelector("input")?.focus();
}

export function closeModal({ silent = false } = {}) {
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.classList.remove("flex");
  const cb = onCloseCallback;
  onCloseCallback = null;
  if (!silent) cb?.();
}

const escapeText = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Styled replacement for window.confirm(); resolves true only when the action is confirmed.
export function confirmDialog({ title, message, confirmText = "Yes", cancelText = "Cancel", image, icon = "❓", tone = "danger" } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value) => {
      if (answered) return;
      answered = true;
      closeModal({ silent: true });
      resolve(value);
    };
    const art = image
      ? `<img src="${escapeText(image)}" alt="" class="confirm-art-img" draggable="false">`
      : `<span class="confirm-art-icon">${escapeText(icon)}</span>`;
    const view = html(`
      <div class="confirm-dialog confirm-dialog--${tone}" role="alertdialog" aria-labelledby="confirmTitle" aria-describedby="confirmMessage">
        <div class="confirm-art">${art}</div>
        <h2 id="confirmTitle" class="font-game text-2xl text-center text-gray-800 mb-1">${escapeText(title)}</h2>
        <p id="confirmMessage" class="text-center text-gray-500 text-sm mb-6">${escapeText(message)}</p>
        <div class="grid grid-cols-2 gap-3">
          <button type="button" data-confirm-cancel class="confirm-btn confirm-btn--cancel">${escapeText(cancelText)}</button>
          <button type="button" data-confirm-ok class="confirm-btn confirm-btn--ok">${escapeText(confirmText)}</button>
        </div>
      </div>`);
    view.querySelector("[data-confirm-cancel]").addEventListener("click", () => answer(false));
    view.querySelector("[data-confirm-ok]").addEventListener("click", () => answer(true));
    openModal(view, { onClose: () => answer(false) });
    view.querySelector("[data-confirm-cancel]").focus();
  });
}

export function isOpen() {
  return !!overlay && !overlay.classList.contains("hidden");
}

export function html(markup) {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

export const ui = {
  input: "w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400",
  primary: "w-full bg-gradient-to-r from-blue-400 to-blue-600 text-white py-3 rounded-2xl font-bold btn-hover disabled:opacity-60",
  secondary: "w-full bg-gray-100 text-gray-700 py-3 rounded-2xl font-semibold hover:bg-gray-200",
  danger: "w-full bg-red-50 text-red-600 py-3 rounded-2xl font-semibold hover:bg-red-100",
  link: "text-blue-600 font-semibold hover:underline",
  title: "font-game text-2xl text-center text-gray-800 mb-1",
  subtitle: "text-center text-gray-500 text-sm mb-5",
};
