// Game Tebak Gambar - Simple Version
let gameImages = [];
let currentImage = null;
let revealedTiles = [];
let imageTimer = null;
let timeLeft = 30;
const charTebakGambar = document.getElementById("charTebakGambar");
import { sendEvent } from "../stateManager.js";
import { showMessage, playSoundEffect, stopAudio } from "../components.js";
import { changeCoin } from "./contextHandler.js";

async function pageTebakGambar() {
  // Kirim event XState untuk memulai game
  sendEvent("GAME_SELECTED");
  // Reset character image
  charTebakGambar.src = "/asset/char/idle.png";
  // Mulai game tebak gambar
  document.getElementById("menuGame").style.display = "none";
  document.getElementById("tebakGambar").style.display = "flex";

  // Disable form saat loading gambar
  document.getElementById("inputTebakGambar").disabled = true;
  document
    .getElementById("tebakGambarForm")
    .querySelector('button[type="submit"]').disabled = true;
  document.getElementById("revealImageBtn").disabled = true;

  // Show loading state
  document.getElementById("gameImage").src = "";
  document.getElementById("gameImage").alt = "Loading image...";
  document.getElementById("imageTime").innerHTML = "Loading...";

  // Reset timer
  resetImageTimer();

  // Load game images dan mulai game
  try {
    await loadGameImages();
    await startImageGame();

    // Enable form setelah loading selesai
    document.getElementById("inputTebakGambar").disabled = false;
    document
      .getElementById("tebakGambarForm")
      .querySelector('button[type="submit"]').disabled = false;
    document.getElementById("revealImageBtn").disabled = false;
    startImageTimer(); // Mulai timer setelah gambar loaded
  } catch (error) {
    console.error("Failed to load game:", error);
    showMessage("Failed to load game. Please try again.", "error");
    sendEvent("BACK"); // Kembali ke idle jika error
  }
}

// Load game images data
async function loadGameImages() {
  try {
    const response = await fetch("/asset/gameImages.json");
    const data = await response.json();
    gameImages = data.images;
  } catch (error) {
    console.error("Error loading game images:", error);
    throw new Error("Failed to load game images");
  }
}

// Start the image guessing game
async function startImageGame() {
  if (gameImages.length === 0) {
    throw new Error("No images available!");
  }

  // Pick random image
  const randomIndex = Math.floor(Math.random() * gameImages.length);
  currentImage = gameImages[randomIndex];

  // Reset game state
  revealedTiles = [...currentImage.revealPattern];
  timeLeft = 30;

  // Update UI
  await updateImageDisplay();
  resetImageForm();

  // Pastikan container terlihat
  document.getElementById("tebakGambar").style.display = "flex";
  document.getElementById("tebakGambar").classList.remove("hidden");
  document.getElementById("optionButton").classList.add("hidden");
  document.getElementById("menuGame").style.display = "none";

  playSoundEffect("ding");
}

// Reset timer function
const resetImageTimer = () => {
  timeLeft = 30;
  document.getElementById("inputTebakGambar").value = "";
  // Clear timer yang sedang berjalan jika ada
  clearTimer();
};

// Update image display and grid overlay
async function updateImageDisplay() {
  const imageElement = document.getElementById("gameImage");

  // Pastikan currentImage ada dan memiliki path
  if (!currentImage || !currentImage.path) {
    throw new Error("Error loading image!");
  }

  // Return promise untuk memastikan gambar loaded
  return new Promise((resolve, reject) => {
    // Set image source
    imageElement.src = currentImage.path;
    imageElement.alt = "Guess this image";

    // Add error handler
    imageElement.onerror = function () {
      reject(new Error("Image failed to load!"));
    };

    imageElement.onload = function () {
      // Update grid overlay setelah gambar loaded
      const overlayTiles = document.querySelectorAll(".overlay-tile");
      overlayTiles.forEach((tile, index) => {
        if (revealedTiles.includes(index)) {
          tile.style.opacity = "0";
        } else {
          tile.style.opacity = "1";
        }
      });

      resolve();
    };
  });
}

// Start timer
function startImageTimer() {
  // Clear existing timer
  if (imageTimer) {
    clearInterval(imageTimer);
  }

  // Update timer display
  document.getElementById("imageTime").textContent = timeLeft;

  imageTimer = setInterval(() => {
    timeLeft--;
    document.getElementById("imageTime").textContent = timeLeft;
    playSoundEffect("tick");
    if (timeLeft <= 0) {
      clearInterval(imageTimer);
      stopAudio();
      timeUp();
    }
  }, 1000);
}

// Handle time up
function timeUp() {
  showMessage(
    `Time up! The answer is ${currentImage.answer}`,
    "error",
    3000,
    true
  );

  // Kirim event LOSE ke XState
  sendEvent("LOSE");

  // Disable form
  document.getElementById("inputTebakGambar").disabled = true;
  document.getElementById("revealImageBtn").disabled = true;
  charTebakGambar.src = "/asset/char/wrong.png";
}

// Reveal a random hidden tile
function revealImageTile() {
  const currentCoin = parseInt(localStorage.getItem("coin")) || 0;

  if (currentCoin < 20) {
    showMessage("Not enough coins! Need 20 coins", "error", 2000, true);
    return;
  }

  // Find hidden tiles
  const hiddenTiles = [];
  for (let i = 0; i < 9; i++) {
    if (!revealedTiles.includes(i)) {
      hiddenTiles.push(i);
    }
  }

  if (hiddenTiles.length === 0) {
    showMessage("All tail have been opened!", "error", 2000, true);
    return;
  }

  // Reveal random hidden tile
  const randomIndex = Math.floor(Math.random() * hiddenTiles.length);
  const tileToReveal = hiddenTiles[randomIndex];
  revealedTiles.push(tileToReveal);

  // Deduct coin
  localStorage.setItem("coin", currentCoin - 20);

  // Update display
  updateImageDisplay();
  showMessage("Tail opened! -20 coin", "success", 1500);
  playSoundEffect("ding");
}

// Handle form submission
document
  .getElementById("tebakGambarForm")
  .addEventListener("submit", function (e) {
    e.preventDefault();
    checkImageAnswer();
  });

// Check player's answer
function checkImageAnswer() {
  const playerAnswer = document
    .getElementById("inputTebakGambar")
    .value.toLowerCase()
    .trim();
  const correctAnswer = currentImage.answer.toLowerCase();

  if (playerAnswer === correctAnswer) {
    charTebakGambar.src = "/asset/char/happy.png";
    // Clear timer and audio
    clearTimer();
    showMessage(`Correct! +30 coin, +40 mood`, "success", 2000, true);
    // Kirim event WIN ke XState
    sendEvent("WIN", {
      params: {
        mood: 40,
        coin: 30,
      },
    });
  } else {
    // Wrong answer - can continue
    const currentMood = parseInt(localStorage.getItem("mood")) || 0;
    localStorage.setItem("mood", Math.max(0, currentMood - 5));

    showMessage("Wrong! try again. -5 mood", "error", 2000, true);

    charTebakGambar.src = "/asset/char/wrong.png";
    setTimeout(() => {
      charTebakGambar.src = "/asset/char/idle.png";
    }, 2000);
    // Clear input for retry
    document.getElementById("inputTebakGambar").value = "";
    return;
  }
}

// Return to main menu
// Hapus function returnToMenu yang kedua (baris 311-323)
// Hanya gunakan yang pertama di baris 286

function returnToMenu() {
  // Clear timer
  clearTimer();

  // Hide game, show menu
  document.getElementById("tebakGambar").classList.add("hidden");
  document.getElementById("optionButton").classList.remove("hidden");

  // Reset form
  resetImageForm();
  sendEvent("BACK");
}

// Reset form
function resetImageForm() {
  document.getElementById("inputTebakGambar").value = "";
  document.getElementById("inputTebakGambar").disabled = false;
  document.getElementById("revealImageBtn").disabled = false;
}

// Modifikasi function tebakGambar untuk menggunakan pageTebakGambar
function tebakGambar() {
  pageTebakGambar();
}

// Hapus function returnToMenu yang duplikat di sini

function clearTimer() {
  if (imageTimer) {
    clearInterval(imageTimer);
    imageTimer = null;
    stopAudio();
  }
}

// Export functions yang diperlukan
export { pageTebakGambar, revealImageTile, returnToMenu };

// Expose ke window untuk onclick handlers
window.revealImageTile = revealImageTile;
window.returnToMenu = returnToMenu;
