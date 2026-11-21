import crypto from "node:crypto";

// Public 8-character player ID, without look-alike characters (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const UID_PATTERN = /^[A-HJKMNP-Z2-9]{8}$/;

export const newUid = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
