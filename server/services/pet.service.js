import { transaction, getDb } from "../database/connection.js";
import { Pet } from "../models/pet.model.js";
import { HttpError } from "../utils/httpError.js";
import { FOODS, SOAPS, PETTING } from "../config/game.js";

const clamp = (value) => Math.max(0, Math.min(100, value));
const HOUR_MS = 60 * 60 * 1000;

export function getCurrentPet(userId) {
  const pet = Pet.findByUser(userId);
  if (!pet) throw HttpError.notFound("Pet not found");
  return pet;
}

// The mutator may throw an HttpError to abort and roll back.
export function mutatePet(userId, mutator) {
  return transaction(() => {
    const pet = getCurrentPet(userId);
    mutator(pet);
    pet.hunger = clamp(pet.hunger);
    pet.hygiene = clamp(pet.hygiene);
    pet.mood = clamp(pet.mood);
    pet.coin = Math.max(0, pet.coin);
    pet.updated_at = Date.now();
    Pet.save(pet);
    return pet;
  });
}

export function playBlocker(pet) {
  if (pet.hygiene <= 30) return "Your hygiene is low, please bath your pet";
  if (pet.hunger >= 70) return "Your hunger is high, please feed your pet";
  return null;
}

export function feed(userId, foodKey) {
  const food = FOODS[foodKey];
  const pet = mutatePet(userId, (p) => {
    if (p.hygiene <= 30) throw HttpError.badRequest("Your hygiene is low, please bath your pet");
    if (p.coin < food.cost) throw HttpError.badRequest(`Insufficient coin, needs ${food.cost} coin for ${food.name}`);
    p.coin -= food.cost;
    p.hunger -= food.hunger;
  });
  return { pet, food };
}

export function bathe(userId, soapKey) {
  const soap = SOAPS[soapKey];
  const pet = mutatePet(userId, (p) => {
    if (p.coin < soap.cost) throw HttpError.badRequest(`Insufficient coin, needs ${soap.cost} coin for ${soap.name}`);
    p.coin -= soap.cost;
    p.hygiene += soap.hygiene;
  });
  return { pet, soap };
}

// Petting: small mood gain per stroke, capped per rolling hour and rate-limited server side.
export function strokePet(userId) {
  return transaction(() => {
    const now = Date.now();
    const pet = getCurrentPet(userId);
    if (now - pet.last_petted_at < PETTING.minIntervalMs) {
      return { pet, gained: 0, capped: false };
    }
    const windowStart = now - pet.petting_window_start > HOUR_MS ? now : pet.petting_window_start;
    const windowGain = windowStart === now ? 0 : pet.petting_window_gain;
    const room = Math.max(0, PETTING.maxMoodPerHour - windowGain);
    const gained = Math.min(PETTING.moodPerStroke, room, 100 - pet.mood);

    pet.mood = clamp(pet.mood + gained);
    Pet.save(pet);
    getDb()
      .prepare("UPDATE pets SET petting_window_start = ?, petting_window_gain = ?, last_petted_at = ? WHERE user_id = ?")
      .run(windowStart, windowGain + gained, now, userId);
    return { pet, gained, capped: room === 0 };
  });
}
