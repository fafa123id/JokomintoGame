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

// Export functions
export { playCondition, feedCondition, mustHygiene, mustFeed };

// Expose to window for global access
window.playCondition = playCondition;
window.feedCondition = feedCondition;
window.mustHygiene = mustHygiene;
window.mustFeed = mustFeed;
