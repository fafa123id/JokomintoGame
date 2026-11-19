import { rules } from "./rules.js";
import { SKINS } from "../config/skins.js";

export const skinSchema = {
  skinId: rules.keyOf(SKINS, "Skin"),
};
