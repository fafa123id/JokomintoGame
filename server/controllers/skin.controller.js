import * as skinService from "../services/skin.service.js";

export function index(req, res) {
  res.json(skinService.listSkins(req.user.id));
}

export function buy(req, res) {
  res.json(skinService.buySkin(req.user.id, req.validated.skinId));
}

export function equip(req, res) {
  res.json(skinService.equipSkin(req.user.id, req.validated.skinId));
}
