function init() {
  let hygiene = localStorage.getItem("hygiene");
  if (hygiene === null) {
    localStorage.setItem("hygiene", "100");
  }
  let hunger = localStorage.getItem("hunger");
  if (hunger === null) {
    localStorage.setItem("hunger", "0");
  }
  let mood = localStorage.getItem("mood");
  if (mood === null) {
    localStorage.setItem("mood", "100");
  }
  let coin = localStorage.getItem("coin");
  if (coin === null) {
    localStorage.setItem("coin", "0");
  }
}
init(); //inisialisasi context

function updateContext() {
  //function untuk update context, misal hygiene, hunger, mood, coin dan menampilkan ke halaman
  let coin = parseInt(localStorage.getItem("coin"));
  let hygiene = parseInt(localStorage.getItem("hygiene"));
  let hunger = parseInt(localStorage.getItem("hunger"));
  let mood = parseInt(localStorage.getItem("mood"));

  document.getElementById("hygiene").innerHTML = hygiene;
  document.getElementById("hunger").innerHTML = hunger;
  document.getElementById("mood").innerHTML = mood;
  document.getElementById("coin").innerHTML = coin;
}

document.addEventListener("DOMContentLoaded", function () {
  //function untuk mengupdate context ketika halaman pertama kali dimuat
  updateContext();
});

//interval untuk mengurangi context per 5
setInterval(() => {
  let hygiene = parseInt(localStorage.getItem("hygiene"));
  let hunger = parseInt(localStorage.getItem("hunger"));
  let mood = parseInt(localStorage.getItem("mood"));

  if (hygiene > 0) {
    hygiene -= 2;
    localStorage.setItem("hygiene", hygiene.toString());
  }
  if (hunger < 100) {
    hunger += 3;
    localStorage.setItem("hunger", hunger.toString());
  }
  if (mood > 0) {
    mood -= 5;
    localStorage.setItem("mood", mood.toString());
  }
  if (hygiene < 0) {
    hygiene = 0;
    localStorage.setItem("hygiene", hygiene.toString());
  }
  if (hunger > 100) {
    hunger = 100;
    localStorage.setItem("hunger", hunger.toString());
  }
  if (mood < 0) {
    mood = 0;
    localStorage.setItem("mood", mood.toString());
  }
}, 5000);

//interval untuk update context per 1 detik
setInterval(() => {
  updateContext();
}, 1000);


