//kondisi untuk bermain
function playCondition() {
  if (mustHygiene() && mustFeed()) {
    return true;
  }
  return false;
}

//kondisi untuk makan
function feedCondition() {
  if (mustHygiene()) {
    return true;
  }
  return false;
}

function mustHygiene() {
  let hygiene = parseInt(localStorage.getItem("hygiene"));
  if (hygiene <= 30) {
    showMessage(
      "Your hygiene is low, please bath your pet",
      "error",
      2000,
      true
    );
    return false;
  }
  return true;
}

function mustFeed() {
  let hunger = parseInt(localStorage.getItem("hunger"));
  if (hunger >= 70) {
    showMessage(
      "Your hunger is high, please feed your pet",
      "error",
      2000,
      true
    );
    return false;
  }
  return true;
}
function plays() {
  changeContext("hunger", 10, "+"); // Tambahi hunger 10 saat main
}
function rewards() {
  changeCoin(30, "+"); // Tambahi coin 20 setelah main
  changeContext("mood", 40, "+"); // Tambahi mood 40 setelah main
}

// Export functions
export { playCondition, feedCondition, mustHygiene, mustFeed, plays, rewards };

// Expose to window for global access
window.playCondition = playCondition;
window.feedCondition = feedCondition;
window.mustHygiene = mustHygiene;
window.mustFeed = mustFeed;
window.plays = plays;
window.rewards = rewards;
