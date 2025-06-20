import { sendEvent } from "../stateManager.js";
import { changeCoin } from "./contextHandler.js";
import { showMessage, playSoundEffect } from "../components.js";
let visibleWord = [];
let revealedIndexes = [];
let time = 20;
let gameTimer = null;
const charTebakKata = document.getElementById("charTebakKata");

async function pageTebakKata() {
  // Kirim event XState untuk memulai game
  sendEvent("GAME_SELECTED");
  // Reset character image
  charTebakKata.src = "/asset/char/idle.png";
  //mulai game tebak kata
  document.getElementById("menuGame").style.display = "none";
  document.getElementById("tebakKata").style.display = "flex";
  //disable form saat fetch word api
  document.getElementById("wordDisplay").innerHTML = "Loading word...";
  document.getElementById("inputTebakKata").disabled = true;
  document
    .getElementById("tebakKataForm")
    .querySelector('button[type="submit"]').disabled = true;
  document.querySelector('button[data-action="reveal-hint"]').disabled = true;
  resetTimer(); //reset timer
  document.getElementById("time").innerHTML = "Loading...";
  await fetchWord();
  //nyalakan form lagi
  document.getElementById("inputTebakKata").disabled = false;
  document
    .getElementById("tebakKataForm")
    .querySelector('button[type="submit"]').disabled = false;
  document.querySelector('button[data-action="reveal-hint"]').disabled = false;
  startTimer(); // Mulai timer saat game dimulai
}

const fetchWord = async () => {
  try {
    const response = await fetch(
      "https://random-word-api.vercel.app/api?words=1&length=5"
    );
    const data = await response.json();

    let word = data[0];
    let arrayWord = word.split("");
    visibleWord = Array(word.length).fill("_");

    // Selalu tampilkan huruf pertama
    revealedIndexes = [0];
    visibleWord[0] = arrayWord[0];

    const totalReveal = Math.ceil(word.length * 0.5); // Total huruf yang mau dibuka
    const randomReveal = Math.max(totalReveal - 1, 0); // Kurangi karena index 0 sudah dibuka

    while (revealedIndexes.length < 1 + randomReveal) {
      const index = Math.floor(Math.random() * word.length);
      if (!revealedIndexes.includes(index)) {
        revealedIndexes.push(index);
        visibleWord[index] = arrayWord[index];
      }
    }

    localStorage.setItem("word", word);
    playSoundEffect("ding");
    updateDisplay();
  } catch (error) {
    console.error("Error fetching word:", error);
    // Optional: Show user-friendly error message
    alert("Failed to fetch word. Please try again.");
  }
};

function updateDisplay() {
  document.getElementById("wordDisplay").innerHTML = visibleWord.join(" ");
}
function revealHint() {
  let coin = localStorage.getItem("coin");
  if (coin < 20) {
    showMessage("Insufficient coint to get hint!", "error", 1000, true);
    return;
  }

  const arrayWord = localStorage.getItem("word").split("");
  const hiddenIndexes = arrayWord
    .map((_, idx) => idx)
    .filter((idx) => !revealedIndexes.includes(idx));

  if (hiddenIndexes.length === 0) {
    showMessage("There is no hidden letter to show", "error", 1000, true);
    return;
  }
  showMessage("You've paid 20 coint for hint", "success", 1000);
  playSoundEffect("ding");
  changeCoin(20, "-");
  const randomIndex =
    hiddenIndexes[Math.floor(Math.random() * hiddenIndexes.length)];
  revealedIndexes.push(randomIndex);
  visibleWord[randomIndex] = arrayWord[randomIndex];

  updateDisplay();
}
const resetTimer = () => {
  time = 20;
  document.getElementById("inputTebakKata").value = "";
  // Clear timer yang sedang berjalan jika ada
  stopTimer();
};

const startTimer = () => {
  let word = localStorage.getItem("word");
  // Clear timer sebelumnya jika ada
  stopTimer();
  // Update display dengan nilai awal
  document.getElementById("time").innerHTML = time;

  gameTimer = setInterval(() => {
    time--;
    playSoundEffect("tick");
    if (time <= 0) {
      clearInterval(gameTimer);
      gameTimer = null;
      stopAudio();
      document.getElementById("time").innerHTML = "0";
      showMessage("Time up! The word is " + word + "!", "error", 2000, true);
      charTebakKata.src = "/asset/char/wrong.png";
      setTimeout(() => {
        HomePage();
      }, 2000);
    } else {
      document.getElementById("time").innerHTML = time;
    }
  }, 1000);
};

// Function untuk menghentikan timer
const stopTimer = () => {
  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
    stopAudio();
  }
};

const tebakKataSubmit = () => {
  let word = localStorage.getItem("word");
  const inputWord = document
    .getElementById("inputTebakKata")
    .value.toLowerCase();
  if (inputWord === word) {
    resetTimer(); // Reset timer
    charTebakKata.src = "/asset/char/happy.png";
    // ini kalau bener - kirim event WIN ke XState
    sendEvent("WIN", {
      params: {
        mood: 40,
        coin: 30,
      },
    });
    showMessage(
      "Congratulations! You have successfully guessed the word! (+30 Coin) (+40 mood)",
      "success",
      2000,
      true
    );
  } else {
    // kalau kalah
    charTebakKata.src = "/asset/char/wrong.png";
    setTimeout(() => {
      charTebakKata.src = "/asset/char/idle.png";
    }, 2000);
    showMessage("Sorry, your answer is wrong!", "error", 1000, true);
    document.getElementById("inputTebakKata").value = "";
  }
};

function backToMainMenuFromWord() {
  resetTimer();
}
document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("tebakKataForm");
  form.addEventListener("submit", function (event) {
    event.preventDefault(); // cegah refresh halaman

    const input = document.getElementById("inputTebakKata").value;
    tebakKataSubmit(input); // panggil fungsi submit kamu
  });
});

// Export functions
export { pageTebakKata, backToMainMenuFromWord };

// Expose ke window untuk onclick handlers
window.pageTebakKata = pageTebakKata;
window.submitGuess = tebakKataSubmit; // Map submitGuess to tebakKataSubmit
window.tebakKataSubmit = tebakKataSubmit;
window.revealHint = revealHint;

