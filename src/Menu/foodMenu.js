import { sendEvent } from "../stateManager.js";
import { feedCondition } from "../condition.js";
import { showMessage, playSoundEffect, showOverlay } from "../components.js";

// Menu Makanan
function showMenuMakanan() {
  if (feedCondition()) {
    // Kirim event XState untuk masuk ke state selectFood
    sendEvent("FEED");
  }
}

// Fungsi untuk membeli makanan
function buyFood(jenisMakanan) {
  if (!feedCondition()) {
    sendEvent("BACK");
    return;
  }
  
  const currentCoin = parseInt(localStorage.getItem("coin")) || 0;
  let harga, hungerReduction, namaMakanan;
  
  // Tentukan harga dan pengurangan hunger berdasarkan jenis makanan
  switch (jenisMakanan) {
    case "biskuit":
      harga = 0;
      hungerReduction = 10;
      namaMakanan = "Cookies";
      break;
    case "roti":
      harga = 5;
      hungerReduction = 25;
      namaMakanan = "Bread";
      break;
    case "nasigoreng":
      harga = 15;
      hungerReduction = 40;
      namaMakanan = "Nasi Goreng";
      break;
    case "pizza":
      harga = 30;
      hungerReduction = 60;
      namaMakanan = "Pizza";
      break;
    case "steak":
      harga = 60;
      hungerReduction = 80;
      namaMakanan = "Premium Steak";
      break;
    default:
      showMessage("Food does't valid", "error", 2000);
      return;
  }

  // Cek apakah coin cukup
  if (currentCoin < harga) {
    showMessage(
      `Insufficient coint, needs ${harga} coin for ${namaMakanan}`,
      "error",
      2000,
      true
    );
    return;
  }
  
  showOverlay(jenisMakanan+".gif");
  playSoundEffect("eat");
  
  // Send XState event dengan parameter yang benar
  sendEvent("FOOD_SELECTED");
  
  // Delay untuk animasi, lalu kirim FINISH_EAT
  setTimeout(() => {
    sendEvent("FINISH_EAT", {
      params: {
        hunger: hungerReduction,
        cost: harga
      }
    });
  }, 2000);
  
  // Tampilkan pesan sukses
  const coinMessage = harga > 0 ? `, -${harga} coin` : " (free!)";
  showMessage(
    `Nyam nyam... I eat ${namaMakanan} (-${hungerReduction} hunger${coinMessage})`,
    "success",
    2000
  );
}

// Export functions
export { showMenuMakanan, buyFood };

// Expose ke window untuk onclick handlers
window.showMenuMakanan = showMenuMakanan;
window.buyFood = buyFood;
window.buyMakanan = buyFood; // Map buyMakanan to buyFood for HTML compatibility
