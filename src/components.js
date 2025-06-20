// Global variable untuk menyimpan timeout reference
let messageTimeout = null;

function showMessage($message, $type, $duration = 2000, needSound = false) {
  //message component

  // Clear timeout sebelumnya jika ada
  if (messageTimeout) {
    clearTimeout(messageTimeout);
    messageTimeout = null;
  }

  if ($type === "success") {
    if (needSound) {
      playSoundEffect("success");
    }
    document.getElementById("message-container").style.backgroundColor =
      "#4BB543";
  } else {
    document.getElementById("message-container").style.backgroundColor =
      "#FF0000";
    if (needSound) {
      playSoundEffect("error");
    }
  }
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
  document.getElementById("message-container").style.display = "flex";
  document.getElementById("message").innerText = $message;

  // Simpan reference timeout yang baru
  messageTimeout = setTimeout(() => {
    document.getElementById("message-container").style.display = "none";
    messageTimeout = null; // Reset reference setelah timeout selesai
  }, $duration);
}
let timeoutId = null;

function stopAudio() {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}
function playSoundEffect(soundId) {
  const soundEffect = document.getElementById(soundId);

  if (!soundEffect) return;

  // Stop sound sebelumnya kalau masih jalan
  if (timeoutId) {
    clearTimeout(timeoutId);
    audio.pause();
    timeoutId = null;
  }

  audio = soundEffect;
  audio.currentTime = 0; // Mulai dari detik ke-0
  audio.play().then(() => {
    // Stop setelah 2 detik
    timeoutId = setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
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
  overlay.classList.add("hidden");
}

let overlayTimeout = null;

function updateContext() {
  //function untuk update context, misal hygiene, hunger, mood, coin dan menampilkan ke halaman
  let coin = parseInt(localStorage.getItem("coin"));
  let hygiene = parseInt(localStorage.getItem("hygiene"));
  let hunger = parseInt(localStorage.getItem("hunger"));
  let mood = parseInt(localStorage.getItem("mood"));

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
  let mood = parseInt(localStorage.getItem("mood"));
  let hygiene = parseInt(localStorage.getItem("hygiene"));
  let hunger = parseInt(localStorage.getItem("hunger"));
  let hungerBubble = document.getElementById("hungerBubble");
  let hygieneBubble = document.getElementById("hygieneBubble");
  let moodBubble = document.getElementById("moodBubble");
  let hungryOverlay = document.getElementById("overlayHunger");
  let hygieneOverlay = document.getElementById("overlayHygiene");

  const charmain = document.getElementById("charMain");
  const gameService = getGameService();

  // Check if in sleep state
  if (gameService && gameService.state.value === "sleep") {
    charmain.src = "/asset/char/sleep.png";
    // Add click listener to wake up
    charmain.onclick = () => {
      wakeUp();
      charmain.onclick = null; // Remove listener
    };
    return;
  }

  if (mood <= 30) {
    charmain.src = "/asset/char/sad.png";
    moodBubble.style.display = "block";
  } else {
    charmain.src = "/asset/char/happy.png";
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

  // Degradasi stats setiap 5 detik
  const degradationInterval = setInterval(() => {
    let hygiene = parseInt(localStorage.getItem("hygiene") ?? "100");
    let hunger = parseInt(localStorage.getItem("hunger") ?? "0");
    let mood = parseInt(localStorage.getItem("mood") ?? "100");

    // Degradasi hygiene
    if (hygiene > 0) {
      hygiene -= 4;
      localStorage.setItem(
        "hygiene",
        Math.max(0, Math.min(100, hygiene)).toString()
      );
    }

    // Degradasi hunger (naik karena semakin lapar)
    if (hunger < 100) {
      hunger += 5;
      localStorage.setItem(
        "hunger",
        Math.max(0, Math.min(100, hunger)).toString()
      );
    }

    // Degradasi mood
    if (mood > 0) {
      mood -= 6;
      localStorage.setItem("mood", Math.max(0, Math.min(100, mood)).toString());
    }
  }, 5000);

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
