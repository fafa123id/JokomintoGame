// Gunakan XState dari global scope
const { createMachine, interpret, assign } = XState;
import { updateChar, updateContext, updateStatus } from "./components.js";

export const machine = createMachine({
  context: {
    mood: 100,
    coins: 50,
    hunger: 0,
    hygiene: 100,
  },
  id: "jokomintov2",
  initial: "home",
  states: {
    home: {
      on: {
        START: {
          target: "idle",
        },
      },
    },
    idle: {
      on: {
        PLAY: {
          target: "selectGame",
        },
        BATHE: {
          target: "selectSoap",
        },
        FEED: {
          target: "selectFood",
        },
      },
      after: {
        20000: {
          target: "sleep",
        },
      },
    },
    selectGame: {
      on: {
        GAME_SELECTED: {
          target: "playing",
        },
        BACK: {
          target: "idle",
        },
      },
    },
    selectSoap: {
      on: {
        BACK: {
          target: "idle",
        },
        SOAP_SELECTED: {
          target: "bathing",
        },
      },
    },
    selectFood: {
      on: {
        FOOD_SELECTED: {
          target: "eating",
        },
        BACK: {
          target: "idle",
        },
      },
    },
    sleep: {
      on: {
        WAKE: {
          target: "idle",
        },
      },
    },
    playing: {
      on: {
        WIN: {
          target: "idle",
          actions: [
            {
              type: "increaseMood",
              params: {
                mood: 40,
              },
            },
            {
              type: "increaseCoin",
              params: {
                coin: 30,
              },
            },
          ],
        },
        LOSE: {
          target: "idle",
        },
        BACK: {
          target: "idle",
        },
      },
      entry: {
        type: "increaseHunger",
      },
    },
    bathing: {
      on: {
        FINISH_BATH: {
          target: "idle",
          actions: [
            {
              type: "increaseHygiene",
            },
            {
              type: "decreaseCoin",
            },
          ],
        },
      },
    },
    eating: {
      on: {
        FINISH_EAT: {
          target: "idle",
          actions: [
            {
              type: "decreaseHunger",
            },
            {
              type: "decreaseCoin",
            },
          ],
        },
      },
    },
  },
}).withConfig({
  actions: {
    increaseHunger: function (context, event) {
      const currentHunger = parseInt(localStorage.getItem("hunger")) || 0;
      const newHunger = Math.min(currentHunger + 10, 100);
      localStorage.setItem("hunger", newHunger.toString());
      updateContext();
    },
    increaseMood: function (context, event) {
      const moodIncrease = event.params?.mood || 40;
      const currentMood = parseInt(localStorage.getItem("mood")) || 0;
      const newMood = Math.min(currentMood + moodIncrease, 100);
      localStorage.setItem("mood", newMood.toString());
      updateContext();
    },
    increaseCoin: function (context, event) {
      const coinIncrease = event.params?.coin || 30;
      const currentCoin = parseInt(localStorage.getItem("coin")) || 0;
      const newCoin = currentCoin + coinIncrease;
      localStorage.setItem("coin", newCoin.toString());
      updateContext();
    },
    increaseHygiene: function (context, event) {
      const hygieneIncrease = event.params?.hygiene || 50;
      const currentHygiene = parseInt(localStorage.getItem("hygiene")) || 0;
      const newHygiene = Math.min(currentHygiene + hygieneIncrease, 100);
      localStorage.setItem("hygiene", newHygiene.toString());
      updateContext();
    },
    decreaseCoin: function (context, event) {
      const cost = event.params?.cost || 0;
      const currentCoin = parseInt(localStorage.getItem("coin")) || 0;
      const newCoin = Math.max(currentCoin - cost, 0);
      localStorage.setItem("coin", newCoin.toString());
      updateContext();
    },
    decreaseHunger: function (context, event) {
      const hungerDecrease = event.params?.hunger || 30;
      const currentHunger = parseInt(localStorage.getItem("hunger")) || 0;
      const newHunger = Math.max(currentHunger - hungerDecrease, 0);
      localStorage.setItem("hunger", newHunger.toString());
      updateContext();
    },
  },
});
