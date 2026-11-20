// Offline practice: answers game calls on the device with the same response shapes as the server.
// Nothing is rewarded or saved, so coins, score and stats stay server-authoritative.

export const PRACTICE_TYPES = ["word", "tictactoe", "memory", "simon"];
export const isLocalSession = (id) => typeof id === "string" && id.startsWith("local-");

const WORDS = [
  "apple", "beach", "chair", "dream", "eagle", "flame", "grape", "house", "light", "music",
  "ocean", "piano", "river", "smile", "tiger", "water", "bread", "cloud", "dance", "earth",
  "fruit", "ghost", "happy", "juice", "lemon", "mango", "night", "plant", "queen", "robot",
  "sugar", "train", "under", "voice", "whale", "zebra", "candy", "honey", "pizza", "storm",
];
const MEMORY_FACES = ["biskuit", "roti", "nasigoreng", "pizza", "steak", "normal", "fragrance", "premium"];
const TIME_SEC = { word: 20, tictactoe: 120, memory: 124, simon: 600 };
const MEMORY_PREVIEW_MS = 4000;
const SIMON_START = 2;
const SIMON_WIN_ROUNDS = 6;
const MAX_WRONG = 3;
const NO_REWARD = { coin: 0, mood: 0, score: 0 };

const sessions = new Map();
const randomInt = (max) => Math.floor(Math.random() * max);
const newId = () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const timeLeft = (s) => Math.max(0, Math.ceil((s.expiresAt - Date.now()) / 1000));
const fail = (error) => ({ error, practice: true });
const done = (s) => {
  sessions.delete(s.id);
  return NO_REWARD;
};

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- Tic-tac-toe (same rules and AI as the server) ----
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winnerOf = (b) => {
  for (const line of LINES) {
    const [a, c, d] = line;
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { mark: b[a], line };
  }
  return null;
};
const empty = (b) => b.flatMap((v, i) => (v ? [] : [i]));
function minimax(b, turn, depth) {
  const win = winnerOf(b);
  if (win) return win.mark === "O" ? 10 - depth : depth - 10;
  const cells = empty(b);
  if (!cells.length) return 0;
  const scores = cells.map((i) => {
    b[i] = turn;
    const score = minimax(b, turn === "O" ? "X" : "O", depth + 1);
    b[i] = null;
    return score;
  });
  return turn === "O" ? Math.max(...scores) : Math.min(...scores);
}
function petMove(b) {
  const cells = empty(b);
  if (Math.random() < 0.3) return cells[randomInt(cells.length)];
  let best = { cell: cells[0], score: -Infinity };
  for (const cell of cells) {
    b[cell] = "O";
    const score = minimax(b, "X", 1);
    b[cell] = null;
    if (score > best.score) best = { cell, score };
  }
  return best.cell;
}
function xoxStatus(b) {
  const win = winnerOf(b);
  if (win) return { status: win.mark === "X" ? "win" : "lose", winLine: win.line };
  return { status: empty(b).length ? "playing" : "draw", winLine: null };
}

// ---- Session views ----
function view(s) {
  const base = { sessionId: s.id, type: s.type, timeLeft: timeLeft(s), practice: true };
  if (s.type === "word") {
    return { ...base, masked: s.answer.split("").map((c, i) => (s.revealed.includes(i) ? c : "_")), nextHintCost: 0 };
  }
  if (s.type === "tictactoe") return { ...base, board: [...s.board], rewards: { maxScore: 0, maxCoin: 0 } };
  if (s.type === "memory") {
    const previewMs = Math.max(0, s.previewUntil - Date.now());
    return {
      ...base,
      cards: s.deck.length,
      matched: [],
      open: null,
      moves: 0,
      rewards: { maxScore: 0, maxCoin: 0 },
      ...(previewMs > 0 && { preview: [...s.deck], previewMs }),
    };
  }
  return { ...base, sequence: [...s.sequence], round: s.sequence.length - SIMON_START + 1, rewards: { maxScore: 0, maxCoin: 0, winRounds: SIMON_WIN_ROUNDS } };
}

export function practiceStart(type) {
  if (!PRACTICE_TYPES.includes(type)) return fail("Game ini butuh internet 🌐 Coba Tebak Kata, XOX, Kartu Ingatan, atau Ikuti Joko");
  const s = { id: newId(), type, expiresAt: Date.now() + TIME_SEC[type] * 1000 };
  if (type === "word") {
    s.answer = WORDS[randomInt(WORDS.length)];
    s.revealed = [0];
    while (s.revealed.length < Math.ceil(s.answer.length / 2)) {
      const i = randomInt(s.answer.length);
      if (!s.revealed.includes(i)) s.revealed.push(i);
    }
    s.attempts = 0;
  } else if (type === "tictactoe") {
    s.board = Array(9).fill(null);
  } else if (type === "memory") {
    s.deck = shuffle([...MEMORY_FACES, ...MEMORY_FACES]);
    s.matched = [];
    s.open = null;
    s.moves = 0;
    s.previewUntil = Date.now() + MEMORY_PREVIEW_MS;
  } else {
    s.sequence = Array.from({ length: SIMON_START }, () => randomInt(4));
    s.progress = 0;
  }
  sessions.set(s.id, s);
  return view(s);
}

const rounds = (s) => s.sequence.length - SIMON_START;
const simonEnd = (s, status, extra = {}) => {
  const r = rounds(s);
  done(s);
  return { status, outcome: r >= SIMON_WIN_ROUNDS ? "win" : "lose", reward: { ...NO_REWARD, rounds: r }, practice: true, ...extra };
};

const handlers = {
  "/api/game/hint"(s) {
    const hidden = [...s.answer].map((_, i) => i).filter((i) => !s.revealed.includes(i));
    if (!hidden.length) return fail("Nothing left to reveal");
    s.revealed.push(hidden[randomInt(hidden.length)]);
    return { ...view(s), hintPaid: 0 };
  },
  "/api/game/guess"(s, { answer }) {
    if (Date.now() > s.expiresAt) return { result: "timeout", answer: s.answer, reward: done(s), practice: true };
    if (String(answer).trim().toLowerCase() === s.answer) return { result: "win", reward: done(s), practice: true };
    s.attempts += 1;
    if (s.attempts >= MAX_WRONG) return { result: "lose", answer: s.answer, reward: done(s), practice: true };
    return { result: "wrong", attemptsLeft: MAX_WRONG - s.attempts, practice: true };
  },
  "/api/game/end"(s) {
    const expired = Date.now() > s.expiresAt;
    done(s);
    return expired ? { result: "timeout", answer: s.answer, reward: NO_REWARD, practice: true } : { result: "quit", practice: true };
  },
  "/api/game/move"(s, { cell }) {
    if (Date.now() > s.expiresAt) return { status: "timeout", board: s.board, practice: true, reward: done(s) };
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s.board[cell]) return fail("That cell is already taken");
    s.board[cell] = "X";
    let result = xoxStatus(s.board);
    let petCell = null;
    if (result.status === "playing") {
      petCell = petMove(s.board);
      s.board[petCell] = "O";
      result = xoxStatus(s.board);
    }
    const out = { ...result, board: [...s.board], playerCell: cell, petCell, practice: true };
    if (result.status !== "playing") out.reward = done(s);
    return out;
  },
  "/api/game/memory/flip"(s, { index }) {
    if (Date.now() > s.expiresAt) return { status: "timeout", reward: done(s), practice: true };
    if (Date.now() < s.previewUntil) return fail("Memorize the cards first");
    if (s.matched.includes(index) || s.open === index || !(index in s.deck)) return fail("Card is already open");
    const face = s.deck[index];
    if (s.open === null) {
      s.open = index;
      return { status: "open", index, face, moves: s.moves, practice: true };
    }
    const first = s.open;
    const match = s.deck[first] === face;
    s.open = null;
    s.moves += 1;
    if (match) s.matched.push(first, index);
    const out = { status: "playing", index, face, pair: [first, index], match, moves: s.moves, practice: true };
    if (s.matched.length === s.deck.length) return { ...out, status: "win", reward: done(s) };
    return out;
  },
  "/api/game/simon/press"(s, { move }) {
    if (Date.now() > s.expiresAt) return simonEnd(s, "timeout");
    const expected = s.sequence[s.progress];
    if (move !== expected) return simonEnd(s, "over", { expected });
    s.progress += 1;
    if (s.progress < s.sequence.length) return { status: "ok", progress: s.progress, practice: true };
    s.sequence.push(randomInt(4));
    s.progress = 0;
    return { status: "round", sequence: [...s.sequence], round: rounds(s) + 1, practice: true };
  },
  "/api/game/simon/finish"(s) {
    if (rounds(s) < SIMON_WIN_ROUNDS) return fail(`Finish at least ${SIMON_WIN_ROUNDS} rounds first`);
    return simonEnd(s, "finished");
  },
};

export function practiceCall(path, body = {}) {
  const s = sessions.get(body.sessionId);
  const handler = handlers[path];
  if (!s || !handler) return fail("Game session is not active");
  return handler(s, body);
}
