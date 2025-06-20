import { showMessage, playSoundEffect, showOverlay } from "../components.js";
import { sendEvent } from "../stateManager.js";

//Bath Menu
// Menu Sabun
function showMenuSabun() {
  // Kirim event XState untuk masuk ke state selectSoap
  sendEvent("BATHE");
}

// Fungsi untuk membeli sabun
function buySabun(jenisSabun) {
  const currentCoin = parseInt(localStorage.getItem("coin")) || 0;
  let harga, hygieneBonus, namaSabun, sound, overlay;

  // Tentukan harga dan bonus berdasarkan jenis sabun
  switch (jenisSabun) {
    case "biasa":
      harga = 0;
      hygieneBonus = 30;
      namaSabun = "Normal Soap";
      sound = "waterSplash";
      overlay = "normal.gif";
      break;
    case "wangi":
      harga = 25;
      hygieneBonus = 50;
      namaSabun = "Fragrance Soap";
      sound = "Bubbles";
      overlay = "fragrance.gif";
      break;
    case "premium":
      harga = 50;
      hygieneBonus = 80;
      namaSabun = "Premium Soap";
      sound = "Sparkling";
      overlay = "premium.gif";
      break;
    default:
      showMessage("Soap doesn't valid!", "error", 2000);
      return;
  }

  // Cek apakah coin cukup
  if (currentCoin < harga) {
    showMessage(
      `Insufficient coin! needs ${harga} coin for ${namaSabun}`,
      "error",
      2000,
      true
    );
    return;
  }
  
  // Menampilkan overlay
  showOverlay(overlay);
  //Play sound
  playSoundEffect(sound);
  
  // Send XState events dengan parameter yang benar
  sendEvent("SOAP_SELECTED");
  
  // Delay untuk animasi, lalu kirim FINISH_BATH
  setTimeout(() => {
    sendEvent("FINISH_BATH", {
      params: {
        hygiene: hygieneBonus,
        cost: harga
      }
    });
  }, 2000);

  // Tampilkan pesan sukses
  showMessage(
    `Byur-byur... ${namaSabun} used (+${hygieneBonus} hygiene, -${harga} coin)`,
    "success",
    2000
  );
  
}

// Export functions
export { showMenuSabun, buySabun };

// Expose ke window untuk onclick handlers
window.showMenuSabun = showMenuSabun;
window.buySabun = buySabun;


