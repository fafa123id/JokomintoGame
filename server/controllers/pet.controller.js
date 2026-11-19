import * as petService from "../services/pet.service.js";
import { Pet } from "../models/pet.model.js";

export function show(req, res) {
  res.json({ pet: Pet.toPublic(petService.getCurrentPet(req.user.id)) });
}

export function feed(req, res) {
  const { pet, food } = petService.feed(req.user.id, req.validated.food);
  res.json({ pet: Pet.toPublic(pet), food });
}

export function bathe(req, res) {
  const { pet, soap } = petService.bathe(req.user.id, req.validated.soap);
  res.json({ pet: Pet.toPublic(pet), soap });
}
