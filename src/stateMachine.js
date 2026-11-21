// Gunakan XState dari global scope
const { createMachine, interpret, assign } = XState;
import { updateChar, updateContext, updateStatus } from "./components.js";
import { backToMainMenuFromWord } from "./Game/tebakKata.js";
import { returnToMenuFromImage } from "./Game/tebakGambar.js";

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
        ACTIVITY: {
          target: "idle",
        },
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
          target: "selectGame",
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
          target: "selectGame",
        },
        BACK: {
          actions: [
            {
              type: "resetTimerGame",
            },
          ],
          target: "selectGame",
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
    resetTimerGame: function (context, event) {
        backToMainMenuFromWord();
        returnToMenuFromImage();
        window.leaveTicTacToe?.();
        window.leaveChess?.();
        window.leaveMemory?.();
        window.leaveSimon?.();
        window.leaveVersus?.();
    },
    increaseHunger: () => updateContext(),
    increaseMood: () => updateContext(),
    increaseCoin: () => updateContext(),
    increaseHygiene: () => updateContext(),
    decreaseCoin: () => updateContext(),
    decreaseHunger: () => updateContext(),
  },
});
