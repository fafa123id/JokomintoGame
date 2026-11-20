let updateStatusRunning = false;
import {
  initializeStateMachine,
  getGameService,
  sendEvent,
  wakeUp,
} from "./src/stateManager.js";

import { initializeEventHandler } from "./src/eventHandler.js";

import { initAccount } from "./src/account.js";
import { initLeaderboard } from "./src/leaderboard.js";
import { initPet } from "./src/pet.js";
import { initPetting } from "./src/petting.js";
import { registerServiceWorker } from "./src/notifications.js";
import { initMusic } from "./src/music.js";
import { initOffline } from "./src/offline.js";
import { applyMotionClass, initMotionToggle } from "./src/motion.js";
import { initSoundToggle } from "./src/sound.js";
import { initUi3d } from "./src/ui3d.js";
import { initSkins } from "./src/skins.js";
import { initTicTacToe } from "./src/Game/tictactoe.js";
import { initChess } from "./src/Game/chess.js";
import { initMemory } from "./src/Game/memory.js";
import { initSimon } from "./src/Game/simon.js";

function init() {
  ["hygiene", "hunger", "mood", "coin", "word"].forEach((k) => localStorage.removeItem(k));

  // Initialize XState machine
  initializeStateMachine();
}

init(); //inisialisasi context

document.addEventListener("DOMContentLoaded", function () {
  applyMotionClass();
  initPet();
  initPetting();
  registerServiceWorker();
  initMusic();
  initOffline();
  initAccount();
  initLeaderboard();
  initSkins();
  initMotionToggle();
  initSoundToggle();
  initUi3d();
  initTicTacToe();
  initChess();
  initMemory();
  initSimon();
  
  // Initialize RxJS Event Handler
  initializeEventHandler();
  console.log('🎮 RxJS Event System Ready!');
  
  // Initialize Modern UI Elements
  setTimeout(() => {
    // Enhance loading screen first
    if (window.enhanceLoadingScreen) {
      window.enhanceLoadingScreen();
    }
    
    // Initialize modern UI after a short delay for loading effect
    setTimeout(() => {
      if (window.initializeModernUI) {
        window.initializeModernUI();
      }
      
      // Hide loading overlay with fade effect
      const loadingOverlay = document.getElementById("loadingOverlay");
      if (loadingOverlay) {
        loadingOverlay.style.transition = 'opacity 0.5s ease-out';
        loadingOverlay.style.opacity = '0';
        
        setTimeout(() => {
          loadingOverlay.classList.add("hidden");
          loadingOverlay.style.opacity = '1'; // Reset for next time
        }, 500);
      }
      
      console.log('✨ Modern UI Enhanced & Ready!');
    }, 2000); // Show loading for 2 seconds to showcase the modern loading screen
  }, 100);
});

// Export functions for global access
window.sendEvent = sendEvent;
window.getGameService = getGameService;
window.updateStatusRunning = updateStatusRunning;
