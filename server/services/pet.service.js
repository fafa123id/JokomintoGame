import { transaction } from "../database/connection.js";
import { Pet } from "../models/pet.model.js";
import { HttpError } from "../utils/httpError.js";
import { DECAY, DECAY_INTERVAL_MS, FOODS, SOAPS } from "../config/game.js";

const clamp = (value) => Math.max(0, Math.min(100, value));

function applyDecay(pet) {
  const ticks = Math.floor((Date.now() - pet.updated_at) / DECAY_INTERVAL_MS);
  if (ticks > 0) {
    pet.hygiene = clamp(pet.hygiene + DECAY.hygiene * ticks);
    pet.hunger = clamp(pet.hunger + DECAY.hunger * ticks);
    pet.mood = clamp(pet.mood + DECAY.mood * ticks);
    pet.updated_at += ticks * DECAY_INTERVAL_MS;
  }
  return pet;
}

export function getCurrentPet(userId) {
  return transaction(() => {
    const pet = Pet.findByUser(userId);
    if (!pet) throw HttpError.notFound("Pet not found");
    applyDecay(pet);
    Pet.save(pet);
    return pet;
  });
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
