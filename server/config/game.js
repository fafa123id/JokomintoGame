export const INITIAL_PET = { hunger: 0, hygiene: 100, mood: 100, coin: 50 };

// Pou-style needs: a server job lowers every pet's stats on a fixed schedule while the server runs.
export const NEEDS = {
  decayEveryHours: Number(process.env.NEEDS_DECAY_HOURS) || 2,
  step: { hygiene: -10, hunger: +10, mood: -10 },
  alert: { hunger: 70, hygiene: 30, mood: 30 },
  remindEveryHours: Number(process.env.NEEDS_REMIND_HOURS) || 6,
};

// Petting raises mood a little, capped per hour so it can't be farmed.
export const PETTING = {
  moodPerStroke: 2,
  maxMoodPerHour: 20,
  minIntervalMs: 1200,
};

export const FOODS = {
  biskuit: { name: "Cookies", cost: 0, hunger: 10 },
  roti: { name: "Bread", cost: 5, hunger: 25 },
  nasigoreng: { name: "Nasi Goreng", cost: 15, hunger: 40 },
  pizza: { name: "Pizza", cost: 30, hunger: 60 },
  steak: { name: "Premium Steak", cost: 60, hunger: 80 },
};

export const SOAPS = {
  biasa: { name: "Normal Soap", cost: 0, hygiene: 30 },
  wangi: { name: "Fragrance Soap", cost: 25, hygiene: 50 },
  premium: { name: "Premium Soap", cost: 50, hygiene: 80 },
};

export const GAME = {
  playCost: { hunger: 1, hygiene: 1 },
  mood: {
    word: { win: 20, lose: 10 },
    image: { win: 25, lose: 10 },
    memory: { win: 25, lose: 10 },
    simon: { win: 30, lose: 10 },
  },
  hintCost: { base: 80, step: 20 },
  maxWrongGuesses: 3,
  timeSec: { word: 20, image: 30, tictactoe: 120, chess: 1200, memory: 124, simon: 600 },
};

// Online matches between players (tic-tac-toe and chess).
export const MULTIPLAYER = {
  turnSec: 300,
  inviteSec: 5,
  inviteGraceSec: 2,
  drawRatio: 0.4,
  difficulty: { tictactoe: 0.6, chess: 0.9 },
  mood: { win: 30, draw: 20, lose: 10 },
};

export const MEMORY = {
  // Every card is shown face up this long at the start; the round clock runs after it.
  previewSec: 4,
  faces: ["biskuit", "roti", "nasigoreng", "pizza", "steak", "normal", "fragrance", "premium"],
  difficulty: 0.55,
  parMoves: 12,
  parSec: 40,
  perExtraMovePenalty: 0.03,
  perExtraSecPenalty: 0.004,
  minPerformance: 0.4,
};

export const SIMON = {
  moves: 4,
  startLength: 2,
  winRounds: 6,
  // Rounds are unlimited; the score stops growing here so long runs can't inflate it.
  fullScoreRounds: 14,
  difficulty: 0.65,
  loseScoreRatio: 0.4,
};

export const CHESS = {
  difficulty: 0.9,
  searchDepth: 2,
  mistakeRate: 0.15,
  parMoves: 25,
  perExtraMovePenalty: 0.01,
  minPerformance: 0.5,
  drawRatio: 0.5,
  mood: { win: 30, draw: 20, lose: 10 },
};

export const TICTACTOE = {
  difficulty: 0.6,
  mistakeRate: 0.3,
  perExtraMovePenalty: 0.1,
  minPerformance: 0.5,
  drawRatio: 0.4,
  mood: { win: 20, draw: 15, lose: 10 },
};

export const SCORE = {
  minBase: 100,
  maxBase: 200,
  timeStepSec: 5,
  timeStepPenalty: 0.08,
  wrongPenalty: 0.15,
  hintPenalty: 0.2,
  floorRatio: 0.2,
  word: { rarity: 0.45, distance: 0.35, length: 0.2, calibration: { low: 0.15, high: 0.55 } },
  image: { detailWeight: 0.7, areaWeight: 0.3 },
};

// Every win pays COIN.base; the algorithm only scales the bonus on top.
export const COIN = {
  base: 100,
  bonusMin: 20,
  bonusMax: 100,
  fatigueRate: 0.1,
  fatigueFloor: 0.3,
  fatigueWindowMs: 24 * 60 * 60 * 1000,
  wealthThreshold: 500,
  wealthRange: 1000,
  wealthFloor: 0.25,
};

// Relative English letter frequency (%).
export const LETTER_FREQUENCY = {
  e: 12.7, t: 9.06, a: 8.17, o: 7.51, i: 6.97, n: 6.75, s: 6.33, h: 6.09, r: 5.99,
  d: 4.25, l: 4.03, c: 2.78, u: 2.76, m: 2.41, w: 2.36, f: 2.23, g: 2.02, y: 1.97,
  p: 1.93, b: 1.49, v: 0.98, k: 0.77, j: 0.15, x: 0.15, q: 0.095, z: 0.074,
};

export const IMAGE_REVEAL_TILES = 2;

export const IMAGE_WORDS = [
  "apple", "banana", "strawberry", "orange", "pineapple", "watermelon", "carrot", "tomato", "bread", "pizza",
  "cake", "coffee", "cat", "dog", "horse", "cow", "elephant", "giraffe", "lion", "tiger",
  "zebra", "monkey", "panda", "rabbit", "penguin", "owl", "parrot", "butterfly", "fish", "turtle",
  "car", "bicycle", "motorcycle", "bus", "train", "airplane", "boat", "helicopter", "truck", "rocket",
  "house", "bridge", "castle", "lighthouse", "tree", "flower", "sunflower", "rose", "mountain", "beach",
  "waterfall", "volcano", "moon", "rainbow", "snowman", "guitar", "piano", "violin", "drum", "camera",
  "clock", "umbrella", "chair", "lamp", "book", "glasses", "shoe", "hat", "balloon", "kite",
  "ball", "key", "candle", "laptop", "phone", "bottle", "cup", "pencil", "robot", "tent",
];

export const IMAGES = [
  { file: "car.jpg", answer: "car", revealPattern: [2, 6, 8] },
  { file: "house.jpg", answer: "house", revealPattern: [1, 5, 8] },
  { file: "bird.jpg", answer: "bird", revealPattern: [4, 7] },
  { file: "tree.jpg", answer: "tree", revealPattern: [3, 5, 8] },
  { file: "flower.jpg", answer: "flower", revealPattern: [2, 3] },
  { file: "sun.jpg", answer: "sun", revealPattern: [2, 6] },
  { file: "moon.jpg", answer: "moon", revealPattern: [1, 3, 5] },
];

export const WORD_API = "https://random-word-api.vercel.app/api?words=1&length=5";
export const FALLBACK_WORDS = [
  "apple", "beach", "chair", "dream", "eagle", "flame", "grape", "house",
  "light", "music", "ocean", "piano", "river", "smile", "tiger", "water",
];
