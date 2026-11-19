import crypto from "node:crypto";
import { WORD_API, FALLBACK_WORDS } from "../config/game.js";

export async function randomWord() {
  try {
    const res = await fetch(WORD_API, { signal: AbortSignal.timeout(3000) });
    const [word] = await res.json();
    if (typeof word === "string" && /^[a-z]{5}$/.test(word)) return word;
  } catch {
    // fall through to local list
  }
  return FALLBACK_WORDS[crypto.randomInt(FALLBACK_WORDS.length)];
}
