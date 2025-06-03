let visibleWord = [];
let revealedIndexes = [];
let time = 20;
let gameTimer = null; // Tambahkan variabel untuk menyimpan timer

async function pageTebakKata() {
  //mulai game tebak kata
  document.getElementById("menuGame").style.display = "none";
  document.getElementById("tebakKata").style.display = "flex";
  //disable form saat fetch word api
  document.getElementById("wordDisplay").innerHTML = "Loading word...";
  document.getElementById("inputTebakKata").disabled = true;
  document
    .getElementById("tebakKataForm")
    .querySelector('button[type="submit"]').disabled = true;
  document.querySelector('button[onclick="revealHint()"]').disabled = true;
  resetTimer(); //reset timer
  document.getElementById("time").innerHTML = "Loading...";
  await fetchWord();
  //nyalakan form lagi
  document.getElementById("inputTebakKata").disabled = false;
  document
    .getElementById("tebakKataForm")
    .querySelector('button[type="submit"]').disabled = false;
  document.querySelector('button[onclick="revealHint()"]').disabled = false;
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
    showMessage("Coin kurang untuk mendapatkan hint!", "error", 1000);
    return;
  }
  showMessage("Kamu membayar 20 coin untuk hint", "success", 1000);
  changeCoin(20, "-");
  const arrayWord = localStorage.getItem("word").split("");
  const hiddenIndexes = arrayWord
    .map((_, idx) => idx)
    .filter((idx) => !revealedIndexes.includes(idx));

  if (hiddenIndexes.length === 0) {
    showMessage(
      "Tidak ada huruf tersembunyi untuk ditampilkan.",
      "error",
      1000
    );
    return;
  }

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
  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
  }
};

const startTimer = () => {
  let word = localStorage.getItem("word");
  // Clear timer sebelumnya jika ada
  if (gameTimer) {
    clearInterval(gameTimer);
  }

  // Update display dengan nilai awal
  document.getElementById("time").innerHTML = time;

  gameTimer = setInterval(() => {
    time--;

    if (time <= 0) {
      clearInterval(gameTimer);
      gameTimer = null;
      document.getElementById("time").innerHTML = "0";
      showMessage("Waktu habis! katanya adalah " + word + "!");
      pageSelectGame();
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
  }
};

const tebakKataSubmit = () => {
  let word = localStorage.getItem("word");
  const inputWord = document
    .getElementById("inputTebakKata")
    .value.toLowerCase();
  if (inputWord === word) {
    // ini kalau bener
    showMessage(
      "Selamat! Anda berhasil menebak kata! (+20 Coin) (+10 Hunger) (+40 mood)",
      "success",
      2000
    );
    stopTimer(); // Hentikan timer saat jawaban benar
    resetTimer(); // Reset timer
    plays();
    rewards();
    pageSelectGame();
  } else {
    // kalau kalah
    showMessage("Maaf, jawaban Anda salah!", "error", 1000);
  }
};
function plays() {
  changeContext("hunger", 10, "+"); // Tambahi hunger 10 setelah main
  changeContext("mood", 40, "+"); // Tambahi mood 40 setelah main
}
function rewards() {
  changeContext("coin", 20, "+"); // Tambahi coin 20 setelah main
}

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("tebakKataForm");
  form.addEventListener("submit", function (event) {
    event.preventDefault(); // cegah refresh halaman

    const input = document.getElementById("inputTebakKata").value;
    tebakKataSubmit(input); // panggil fungsi submit kamu
  });
});