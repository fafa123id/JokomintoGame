import { api } from "../api.js";
import { playPetScene, floatStats } from "../pet.js";
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

  const { cost, hunger } = res.food;
  sendEvent("FOOD_SELECTED");
  const sceneMs = playPetScene("eat", { food: jenisMakanan }, () => {
    sendEvent("FINISH_EAT");
    hideOverlay();
    floatStats("charMain", [
      { text: `-${hunger} 🍽️`, tone: "good" },
      cost > 0 ? { text: `-${cost} 🪙`, tone: "bad" } : { text: "FREE", tone: "gold" },
    ]);
  });
  if (!sceneMs) showOverlay(jenisMakanan + ".gif");
  playSoundEffect("eat");
}

// Export functions
export { showMenuMakanan, buyFood };

// Expose ke window untuk onclick handlers
window.showMenuMakanan = showMenuMakanan;
window.buyFood = buyFood;
window.buyMakanan = buyFood; // Map buyMakanan to buyFood for HTML compatibility
