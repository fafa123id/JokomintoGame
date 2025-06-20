import { sendEvent } from "./stateManager.js";
import { pageTebakKata } from "./Game/tebakKata.js";
import { pageTebakGambar } from "./Game/tebakGambar.js";
import { showMenuMakanan } from "./Menu/foodMenu.js";
import { showMenuSabun } from "./Menu/soapMenu.js";
import { playCondition, feedCondition } from "./condition.js";

function GameMenu() {
  if (playCondition()) {
    sendEvent("PLAY");
  }
}

function tebakKata() {
  if (playCondition()) {
    pageTebakKata();
  } else {
    sendEvent("BACK");
  }
}

function tebakGambar() {
  if (playCondition()) {
    pageTebakGambar();
  } else {
    sendEvent("BACK");
  }
}

function HomePage() {
  sendEvent("BACK");
}

function pageSelectGame() {
  // UI update will be handled by XState state manager
}
function startGame() {
  sendEvent("START");
}
// Export functions dan expose ke global scope
export {
  GameMenu,
  tebakKata,
  tebakGambar,
  HomePage,
  pageSelectGame,
  showMenuMakanan,
  showMenuSabun,
  startGame,
};

// Expose ke window untuk onclick handlers
window.GameMenu = GameMenu;
window.tebakKata = tebakKata;
window.tebakGambar = tebakGambar;
window.HomePage = HomePage;
window.pageSelectGame = pageSelectGame;
window.showMenuMakanan = showMenuMakanan;
window.showMenuSabun = showMenuSabun;
window.startGame = startGame;
