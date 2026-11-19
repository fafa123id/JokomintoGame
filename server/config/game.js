export const INITIAL_PET = { hunger: 0, hygiene: 100, mood: 100, coin: 50 };

export const DECAY_INTERVAL_MS = 8000;
export const DECAY = { hygiene: -4, hunger: +5, mood: -6 };

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
  hungerOnStart: 10,
  winMood: 40,
  hintCost: 20,
  wrongImageMoodPenalty: 5,
  maxWrongGuesses: 3,
  timeSec: { word: 20, image: 30, tictactoe: 120 },
};

export const TICTACTOE = {
  difficulty: 0.6,
  mistakeRate: 0.3,
  perExtraMovePenalty: 0.1,
  minPerformance: 0.5,
  drawRatio: 0.4,
  mood: { win: 40, draw: 15, lose: -5 },
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

export const COIN = {
  minBase: 100,
  maxBase: 150,
  min: 10,
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
