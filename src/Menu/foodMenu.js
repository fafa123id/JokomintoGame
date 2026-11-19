import { api } from "../api.js";
import { sendEvent } from "../stateManager.js";
import { feedCondition } from "../condition.js";
import { showMessage, playSoundEffect, showOverlay, hideOverlay } from "../components.js";

// Menu Makanan
function showMenuMakanan() {
  if (feedCondition()) {
    // Kirim event XState untuk masuk ke state selectFood
    sendEvent("FEED");
  }
}

// Fungsi untuk membeli makanan
let buying = false;
async function buyFood(jenisMakanan) {
  if (buying) return;
  if (!feedCondition()) {
    sendEvent("BACK");
    return;
  }

  buying = true;
  const res = await api("/api/pet/feed", { food: jenisMakanan });
  buying = false;
  if (res.error) {
    showMessage(res.error, "error", 2000, true);
    return;
  }

  const { name, cost, hunger } = res.food;
  showOverlay(jenisMakanan + ".gif");
  playSoundEffect("eat");
  sendEvent("FOOD_SELECTED");

  setTimeout(() => {
    sendEvent("FINISH_EAT");
    hideOverlay();
  }, 2000);

  const coinMessage = cost > 0 ? `, -${cost} coin` : " (free!)";
  showMessage(`Nyam nyam... I eat ${name} (-${hunger} hunger${coinMessage})`, "success", 2000);
}

// Export functions
export { showMenuMakanan, buyFood };

// Expose ke window untuk onclick handlers
window.showMenuMakanan = showMenuMakanan;
window.buyFood = buyFood;
window.buyMakanan = buyFood; // Map buyMakanan to buyFood for HTML compatibility
