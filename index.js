let updateStatusRunning = false;
import {
  initializeStateMachine,
  getGameService,
  sendEvent,
  wakeUp,
} from "./src/stateManager.js";

import { updateChar, updateContext } from "./src/components.js";
import { initializeEventHandler } from "./src/eventHandler.js";

function init() {
  let hygiene = localStorage.getItem("hygiene");
  if (hygiene === null) {
    localStorage.setItem("hygiene", "100");
  }
  let hunger = localStorage.getItem("hunger");
  if (hunger === null) {
    localStorage.setItem("hunger", "0");
  }
  let mood = localStorage.getItem("mood");
  if (mood === null) {
    localStorage.setItem("mood", "100");
  }
  let coin = localStorage.getItem("coin");
  if (coin === null) {
    localStorage.setItem("coin", "50");
  }

  // Initialize XState machine
  initializeStateMachine();
}

init(); //inisialisasi context

document.addEventListener("DOMContentLoaded", function () {
  //function untuk mengupdate context ketika halaman pertama kali dimuat
  updateChar();
  updateContext();
  
  // Initialize RxJS Event Handler
  initializeEventHandler();
  console.log('🎮 RxJS Event System Ready!');
  
  setTimeout(() => {
    document.getElementById("loadingOverlay").classList.add("hidden");
  }, 100);
});

// Export functions for global access
window.sendEvent = sendEvent;
window.getGameService = getGameService;
window.updateStatusRunning = updateStatusRunning;
