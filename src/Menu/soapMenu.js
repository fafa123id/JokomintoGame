import { api } from "../api.js";
import { showMessage, playSoundEffect, showOverlay, hideOverlay } from "../components.js";

import { sendEvent } from "../stateManager.js";

//Bath Menu
// Menu Sabun
function showMenuSabun() {
  // Kirim event XState untuk masuk ke state selectSoap
  sendEvent("BATHE");
}

const SOAP_FX = {
  biasa: { sound: "waterSplash", overlay: "normal.gif" },
  wangi: { sound: "Bubbles", overlay: "fragrance.gif" },
  premium: { sound: "Sparkling", overlay: "premium.gif" },
};

let buying = false;
async function buySabun(jenisSabun) {
  const fx = SOAP_FX[jenisSabun];
  if (!fx) {
    showMessage("Soap doesn't valid!", "error", 2000);
    return;
  }
  if (buying) return;

  buying = true;
  const res = await api("/api/pet/bathe", { soap: jenisSabun });
  buying = false;
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    return;
  }

  const { name, cost, hygiene } = res.soap;
  showOverlay(fx.overlay);
  playSoundEffect(fx.sound);
  sendEvent("SOAP_SELECTED");

  setTimeout(() => {
    sendEvent("FINISH_BATH");
    hideOverlay();
  }, 2000);

  showMessage(`Byur-byur... ${name} used (+${hygiene} hygiene, -${cost} coin)`, "success", 2000);
}

// Export functions
export { showMenuSabun, buySabun };

// Expose ke window untuk onclick handlers
window.showMenuSabun = showMenuSabun;
window.buySabun = buySabun;


