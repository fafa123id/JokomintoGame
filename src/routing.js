import { playCondition, feedCondition } from "./condition.js";
import { pageTebakKata } from "./Game/tebakKata.js";

function GameMenu() {
  if (playCondition()) {
    document.getElementById("optionButton").style.display = "none";
    pageSelectGame();
  }
}

//Game Menu
function pageSelectGame() {
  //mulai game menu
  document.getElementById("menuGame").style.display = "flex";
  document.getElementById("tebakKata").style.display = "none";
}
function tebakKata() {
  //mulai game tebak kata
  pageTebakKata();
}

//Bath Menu
function bath() {
  let hygiene = parseInt(localStorage.getItem("hygiene"));
  hygiene += 50;
  if (hygiene > 100) {
    hygiene = 100;
  }
  localStorage.setItem("hygiene", hygiene.toString());
}

//Feed Menu
function feed() {
  if (feedCondition()) {
    let hunger = parseInt(localStorage.getItem("hunger"));
    hunger -= 50;
    if (hunger < 0) {
      hunger = 0;
    }
    localStorage.setItem("hunger", hunger.toString());
  }
}

export { GameMenu, pageSelectGame, tebakKata, bath, feed };