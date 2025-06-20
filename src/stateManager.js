// Gunakan XState dari global scope
const { interpret } = XState;

import { machine } from "./stateMachine.js";
import { updateStatus } from "./components.js";

// Global state service
let gameService = null;

// Initialize state machine
export function initializeStateMachine() {
  if (gameService) {
    gameService.stop();
  }

  gameService = interpret(machine)
    .onTransition((state) => {
    addDebugLog(`State: ${state.value}`);
      
      updateUIBasedOnState(state.value);
    })
    .start();

  return gameService;
}

// Get current service
export function getGameService() {
  return gameService;
}

// Send events to state machine
export function sendEvent(eventType, eventData = {}) {
  if (gameService) {
    gameService.send({ type: eventType, ...eventData });
  }
}

// Update UI based on current state
function updateUIBasedOnState(state) {
  // Hide all menus first
  document.getElementById("menuGame").style.display = "none";
  document.getElementById("tebakKata").style.display = "none";
  document.getElementById("tebakGambar").style.display = "none";
  document.getElementById("menuSabun").style.display = "none";
  document.getElementById("menuMakanan").style.display = "none";
  document.getElementById("MainCharDiv").style.display = "none";
  document.getElementById("sleepOverlay").style.display = "none";
  document.getElementById("optionButton").style.display = "none";
  document.getElementById("statusBar").style.display = "block";
  // Show appropriate UI based on state
  switch (state) {
    case "home":
      document.getElementById("gameTitle").style.display = "block";
      document.getElementById("statusBar").style.display = "none";
      break;
    case "idle":
      updateStatus(); //mulai update status
      document.getElementById("gameTitle").style.display = "none";
      document.getElementById("optionButton").style.display = "flex";
      document.getElementById("MainCharDiv").style.display = "flex";
      break;
    case "selectGame":
      document.getElementById("optionButton").style.display = "none";
      document.getElementById("gameTitle").style.display = "none";
      document.getElementById("menuGame").style.display = "flex";
      break;
    case "selectSoap":
      document.getElementById("optionButton").style.display = "none";
      document.getElementById("gameTitle").style.display = "none";
      document.getElementById("menuSabun").style.display = "flex";
      break;
    case "selectFood":
      document.getElementById("optionButton").style.display = "none";
      document.getElementById("gameTitle").style.display = "none";
      document.getElementById("menuMakanan").style.display = "flex";
      break;
    case "playing":
      // Game UI will be handled by individual game functions
      break;
    case "sleep":
      document.getElementById("sleepOverlay").style.display = "flex";
      break;
    case "bathing":
    case "eating":
      // Show char animation
      document.getElementById("MainCharDiv").style.display = "flex";
      break;
  }
}

// Wake up from sleep
export function wakeUp() {
  sendEvent("WAKE");
  document.getElementById("charMain").src = "/asset/char/idle.png";
}
window.wakeUp = wakeUp;
