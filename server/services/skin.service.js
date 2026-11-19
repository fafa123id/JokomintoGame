import { transaction } from "../database/connection.js";
import { UserSkin } from "../models/userSkin.model.js";
import { User } from "../models/user.model.js";
import { Pet } from "../models/pet.model.js";
import { HttpError } from "../utils/httpError.js";
import { getCurrentPet, mutatePet } from "./pet.service.js";
import { SKINS, DEFAULT_SKIN } from "../config/skins.js";

const isOwned = (owned, id) => SKINS[id].price === 0 || owned.includes(id);

export function listSkins(userId) {
  const owned = UserSkin.ownedBy(userId);
  const { equipped_skin: equipped } = User.find(userId);
  return {
    equipped: SKINS[equipped] ? equipped : DEFAULT_SKIN,
    coin: getCurrentPet(userId).coin,
    skins: Object.entries(SKINS).map(([id, skin]) => ({
      id,
      name: skin.name,
      price: skin.price,
      owned: isOwned(owned, id),
      equipped: id === equipped,
    })),
  };
}

export function buySkin(userId, skinId) {
  const skin = SKINS[skinId];
  return transaction(() => {
    if (isOwned(UserSkin.ownedBy(userId), skinId)) throw HttpError.conflict("You already own this skin");
    const pet = mutatePet(userId, (p) => {
      if (p.coin < skin.price) throw HttpError.badRequest(`Not enough coins, needs ${skin.price} coin`);
      p.coin -= skin.price;
    });
    UserSkin.add(userId, skinId);
    UserSkin.equip(userId, skinId);
    return { ...listSkins(userId), pet: Pet.toPublic(pet) };
  });
}

export function equipSkin(userId, skinId) {
  if (!isOwned(UserSkin.ownedBy(userId), skinId)) throw HttpError.badRequest("Buy this skin first");
  UserSkin.equip(userId, skinId);
  return listSkins(userId);
}
