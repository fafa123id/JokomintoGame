import { rules } from "./rules.js";

export const guestSchema = {
  name: rules.displayName(),
};

export const registerSchema = {
  name: rules.displayName({ required: false }),
  email: rules.email(),
  password: rules.password(),
};

export const loginSchema = {
  email: rules.email(),
  password: rules.string({ max: 200, label: "Password" }),
};

export const googleLoginSchema = {
  credential: rules.string({ max: 4096, label: "Credential" }),
};
