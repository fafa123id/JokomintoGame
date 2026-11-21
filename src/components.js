import { isMuted, getVolume } from "./sound.js";
import { state, refreshPet } from "./api.js";
import { setExpression } from "./pet.js";
const TOAST_LIMIT = 3;
let toastStack = null;

// Toast notifications at the top of the screen, above modals and overlays.
function showMessage(message, type = "success", duration = 2000, needSound = false) {
  if (needSound) playSoundEffect(type === "success" ? "success" : "error");
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    toastStack.setAttribute("role", "status");
    toastStack.setAttribute("aria-live", "polite");
    document.body.appendChild(toastStack);
  }
  // Same text already showing: just restart its timer.
  const existing = [...toastStack.children].find((t) => t.dataset.text === message && !t.classList.contains("is-leaving"));
  if (existing) {
    clearTimeout(existing._timer);
    existing._timer = setTimeout(() => dismissToast(existing), duration);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${type === "success" ? "success" : "error"}`;
  toast.dataset.text = message;
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = type === "success" ? "✓" : "!";
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  toast.append(icon, text);
  toast.addEventListener("click", () => dismissToast(toast));
  toastStack.appendChild(toast);
  while (toastStack.childElementCount > TOAST_LIMIT) toastStack.firstElementChild.remove();
  toast._timer = setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  if (toast.classList.contains("is-leaving")) return;
  clearTimeout(toast._timer);
  toast.classList.add("is-leaving");
  setTimeout(() => toast.remove(), 250);
}
let timeoutId = null;

function stopAudio() {
  const tick = document.getElementById("tick");
  if (tick) tick.pause();
  if (audio && audio.id === "tick") {
    audio.pause();
    audio.currentTime = 0;
  }
}
function playSoundEffect(soundId) {
  if (isMuted()) return;
  const soundEffect = document.getElementById(soundId);

  if (!soundEffect) return;
  soundEffect.volume = getVolume("effects");

  // Ticks play on their own element so they never cut off (or get cut by) feedback sounds.
  if (soundId === "tick") {
    soundEffect.currentTime = 0;
    soundEffect.play().catch(() => {});
    return;
  }

  // Stop sound sebelumnya kalau masih jalan
  if (timeoutId) {
    clearTimeout(timeoutId);
    audio.pause();
    timeoutId = null;
  }

  audio = soundEffect;
  audio.currentTime = 0; // Mulai dari detik ke-0
  audio.play().catch(() => {}).then(() => {
    // Stop setelah 2 detik
    timeoutId = setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
      timeoutId = null;
    }, 2000);
  });
}
let audio = null;

// Fungsi untuk menampilkan overlay mandi
function showOverlay(param = "normal.gif") {
  const overlay = document.getElementById("overlay");
  const gif = document.getElementById("overlaygif");
  gif.src = "/asset/gif/" + param;
  overlay.classList.remove("hidden");
  if (overlayTimeout) {
    clearTimeout(overlayTimeout);
    overlayTimeout = null;
  }
  overlayTimeout = setTimeout(() => {
    hideOverlay();
  }, 2000);
}

// Fungsi untuk menyembunyikan overlay mandi
function hideOverlay() {
  const overlay = document.getElementById("overlay");
  const gif = document.getElementById("overlaygif");
  gif.src = "";
  overlay.classList.add("hidden");
}

let overlayTimeout = null;

function updateContext() {
  //function untuk update context, misal hygiene, hunger, mood, coin dan menampilkan ke halaman
  if (!state.pet) return;
  const { coin, hygiene, hunger, mood } = state.pet;

  // Update nilai teks
  document.getElementById("hygiene-value").innerHTML = hygiene;
  document.getElementById("hunger-value").innerHTML = hunger;
  document.getElementById("mood-value").innerHTML = mood;
  document.getElementById("coin").innerHTML = coin;

  // Update status bar
  document.getElementById("hygiene-bar").style.width = hygiene + "%";
  document.getElementById("hunger-bar").style.width = hunger + "%"; // Hunger bar naik saat lapar
  document.getElementById("mood-bar").style.width = mood + "%";

  // Update warna bar berdasarkan nilai
  updateBarColors(hygiene, hunger, mood);
}

function updateBarColors(hygiene, hunger, mood) {
  // Update warna hygiene bar
  const hygieneBar = document.getElementById("hygiene-bar");
  if (hygiene >= 70) {
    hygieneBar.className =
      "bg-gradient-to-r from-blue-400 to-cyan-500 h-2.5 rounded-full transition-all duration-500";
  } else if (hygiene > 30) {
    hygieneBar.className =
      "bg-gradient-to-r from-yellow-400 to-orange-500 h-2.5 rounded-full transition-all duration-500";
  } else {
    hygieneBar.className =
      "bg-gradient-to-r from-red-500 to-red-600 h-2.5 rounded-full transition-all duration-500";
  }

  // Update warna hunger bar (0 = kenyang/hijau, 100 = sangat lapar/merah)
  const hungerBar = document.getElementById("hunger-bar");
  if (hunger <= 30) {
    hungerBar.className =
      "bg-gradient-to-r from-green-400 to-green-500 h-2.5 rounded-full transition-all duration-500";
  } else if (hunger < 70) {
    hungerBar.className =
      "bg-gradient-to-r from-yellow-400 to-orange-500 h-2.5 rounded-full transition-all duration-500";
  } else {
    hungerBar.className =
      "bg-gradient-to-r from-red-500 to-red-600 h-2.5 rounded-full transition-all duration-500";
  }

  // Update warna mood bar
  const moodBar = document.getElementById("mood-bar");
  if (mood >= 70) {
    moodBar.className =
      "bg-gradient-to-r from-yellow-400 to-green-500 h-2.5 rounded-full transition-all duration-500";
  } else if (mood > 30) {
    moodBar.className =
      "bg-gradient-to-r from-yellow-400 to-orange-500 h-2.5 rounded-full transition-all duration-500";
  } else {
    moodBar.className =
      "bg-gradient-to-r from-red-500 to-red-600 h-2.5 rounded-full transition-all duration-500";
  }
}

function updateChar() {
  if (!state.pet) return;
  const { mood, hygiene, hunger } = state.pet;
  let hungerBubble = document.getElementById("hungerBubble");
  let hygieneBubble = document.getElementById("hygieneBubble");
  let moodBubble = document.getElementById("moodBubble");
  let hungryOverlay = document.getElementById("overlayHunger");
  let hygieneOverlay = document.getElementById("overlayHygiene");

  const charmain = document.getElementById("charMain");
  const gameService = getGameService();

  // Check if in sleep state
  if (gameService && gameService.state.value === "sleep") {
    setExpression(charmain, "sleep");
    return;
  }

  if (mood <= 30) {
    setExpression(charmain, "sad");
    moodBubble.style.display = "block";
  } else {
    setExpression(charmain, "happy");
    moodBubble.style.display = "none";
  }

  if (hygiene <= 30) {
    hygieneBubble.style.display = "block";
    hygieneOverlay.style.display = "block";
  } else {
    hygieneBubble.style.display = "none";
    hygieneOverlay.style.display = "none";
  }

  if (hunger >= 70) {
    hungerBubble.style.display = "block";
    hungryOverlay.style.display = "block";
  } else {
    hungerBubble.style.display = "none";
    hungryOverlay.style.display = "none";
  }
}

const updateStatus = () => {
  
  if (updateStatusRunning) {
    return;
  }
  updateStatusRunning = true;
  // Update character setiap 10ms
  const charInterval = setInterval(() => {
    updateChar();
    updateContext();
  }, 10);

  const degradationInterval = setInterval(() => {
    if (state.user) refreshPet();
  }, 60000);

  // Cleanup function
  return () => {
    clearInterval(charInterval);
    clearInterval(degradationInterval);
  };
};
// Export functions
export {
  showMessage,
  playSoundEffect,
  stopAudio,
  showOverlay,
  hideOverlay,
  updateChar,
  updateContext,
  updateStatus,
};

// Expose to window for global access
window.showMessage = showMessage;
window.playSoundEffect = playSoundEffect;
window.stopAudio = stopAudio;
window.showOverlay = showOverlay;
window.hideOverlay = hideOverlay;

// Enhanced UI Effects
function createFloatingParticles(containerId, count = 5) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Remove existing particles
  container.querySelectorAll('.floating-particle').forEach(p => p.remove());

  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    particle.className = 'floating-particle';
    particle.style.cssText = `
      position: absolute;
      width: 4px;
      height: 4px;
      background: rgba(255, 255, 255, 0.6);
      border-radius: 50%;
      pointer-events: none;
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      animation: floatParticle ${3 + Math.random() * 2}s infinite ease-in-out;
      animation-delay: ${Math.random() * 2}s;
    `;
    container.appendChild(particle);
  }
}

// Enhanced Character Effects
function addCharacterEffects(characterId) {
  const character = document.getElementById(characterId);
  if (!character) return;

  const container = character.parentElement;
  if (!container.classList.contains('character-container')) {
    container.classList.add('character-container');
  }

  // Add floating animation class
  character.classList.remove('animate-bounce');
  character.classList.add('character-float');

  // Add particles if not exist
  if (!container.querySelector('.character-particle')) {
    for (let i = 1; i <= 4; i++) {
      const particle = document.createElement('div');
      particle.className = `character-particle particle-${i}`;
      container.appendChild(particle);
    }

    // Add glow effect
    const glow = document.createElement('div');
    glow.className = 'character-glow';
    container.appendChild(glow);
  }
}

// Enhanced Loading Animation
function enhanceLoadingScreen() {
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (!loadingOverlay) return;

  // Add modern loading class if not present
  if (!loadingOverlay.classList.contains('modern-loading')) {
    loadingOverlay.classList.add('modern-loading');
  }

  // Enhanced typewriter effect
  const loadingText = document.getElementById('loadingText');
  if (loadingText) {
    const text = loadingText.textContent;
    loadingText.textContent = '';
    loadingText.style.borderRight = '2px solid rgba(255, 255, 255, 0.7)';
    
    let i = 0;
    const typewriter = setInterval(() => {
      loadingText.textContent += text.charAt(i);
      i++;
      if (i >= text.length) {
        clearInterval(typewriter);
        setTimeout(() => {
          loadingText.style.borderRight = 'none';
        }, 1000);
      }
    }, 100);
  }
}

// Initialize Modern UI Elements
function initializeModernUI() {
  // Add character effects to home character
  addCharacterEffects('charHome');
  
  // Add character effects to main character
  addCharacterEffects('charMain');
  
  // Create floating particles for status bar
  createFloatingParticles('statusBar', 8);
  
  // Add title gradient class
  const gameTitle = document.querySelector('#gameTitle h1');
  if (gameTitle && !gameTitle.classList.contains('title-gradient')) {
    gameTitle.classList.add('title-gradient', 'title-shadow');
  }

  // Add subtitle glow
  const subtitle = document.querySelector('#gameTitle p');
  if (subtitle && !subtitle.classList.contains('subtitle-glow')) {
    subtitle.classList.add('subtitle-glow');
  }

  // Enhance start button
  const startBtn = document.querySelector('[data-action="start-game"]');
  if (startBtn && !startBtn.classList.contains('premium-start-btn')) {
    startBtn.classList.add('premium-start-btn');
    
    // Add sparkle effect
    const sparkle = document.createElement('span');
    sparkle.className = 'start-sparkle';
    startBtn.appendChild(sparkle);
    
    // Update button text
    const textSpan = startBtn.querySelector('span:last-child');
    if (textSpan && textSpan.textContent.trim() === 'Start') {
      textSpan.textContent = 'Start Adventure';
    }
  }

  console.log('✨ Modern UI elements initialized');
}

// Enhanced Progress Bar Animation
function animateProgressBar(barId, targetWidth, duration = 800) {
  const bar = document.getElementById(barId);
  if (!bar) return;

  // Add enhanced progress classes
  if (!bar.classList.contains('progress-fill')) {
    bar.classList.add('progress-fill');
  }

  // Smooth animation
  bar.style.transition = `width ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
  bar.style.width = targetWidth + '%';

  // Add temporary glow effect
  bar.style.boxShadow = `
    0 0 20px rgba(255, 255, 255, 0.5),
    0 2px 8px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.3)
  `;

  setTimeout(() => {
    bar.style.boxShadow = `
      0 2px 8px rgba(0, 0, 0, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.3)
    `;
  }, duration);
}

// Update existing updateContext function to use enhanced animations
const originalUpdateContext = updateContext;
updateContext = function() {
  // Call original function
  if (originalUpdateContext) originalUpdateContext();
  
  // Add enhanced animations
  if (!state.pet) return;
  const { mood, hygiene, hunger } = state.pet;
  
  animateProgressBar('mood-bar', mood);
  animateProgressBar('hygiene-bar', hygiene);
  animateProgressBar('hunger-bar', hunger);
};

// Export enhanced functions
window.initializeModernUI = initializeModernUI;
window.createFloatingParticles = createFloatingParticles;
window.addCharacterEffects = addCharacterEffects;
window.enhanceLoadingScreen = enhanceLoadingScreen;
window.animateProgressBar = animateProgressBar;
