//kondisi untuk bermain
function playCondition() {
  let hygiene = parseInt(localStorage.getItem("hygiene"));
  let hunger = parseInt(localStorage.getItem("hunger"));

  if (hygiene < 30) {
    showMessage("Your hygiene is low, please bath your pet");
    return false;
  }
  if (hunger > 80) {
    showMessage("Your hunger is high, please feed your pet");
    return false;
  }
  return true;
}

//kondisi untuk makan 
function feedCondition() {
  let hygiene = parseInt(localStorage.getItem("hygiene"));

  if (hygiene < 30) {
    showMessage("Your hygiene is low, please bath your pet");
    return false;
  }
  return true;
}
