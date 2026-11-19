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
  error: "text-red-600 text-sm min-h-[1.25rem]",
};
