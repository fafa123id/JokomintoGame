// Each rule returns [cleanValue, errorMessage | null].

const string = ({ min = 0, max = 255, required = true, label = "Field" } = {}) => (value) => {
  if (value === undefined || value === null || value === "") {
    return required ? [undefined, `${label} is required`] : [undefined, null];
  }
  if (typeof value !== "string") return [undefined, `${label} must be text`];
  const trimmed = value.trim();
  if (trimmed.length < min) return [undefined, `${label} must be at least ${min} characters`];
  if (trimmed.length > max) return [undefined, `${label} must be at most ${max} characters`];
  return [trimmed, null];
};

const displayName = ({ required = true } = {}) => (value) => {
  const [name, error] = string({ min: 2, max: 20, required, label: "Name" })(value);
  if (error || name === undefined) return [name, error];
  const normalized = name.replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} _.-]+$/u.test(normalized)) {
    return [undefined, "Name can only contain letters, numbers, spaces, _ . -"];
  }
  return [normalized, null];
};

const email = () => (value) => {
  const [str, error] = string({ max: 254, label: "Email" })(value);
  if (error) return [undefined, error];
  const normalized = str.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return [undefined, "Invalid email"];
  return [normalized, null];
};

// bcrypt only uses the first 72 bytes.
const password = () => (value) => {
  if (typeof value !== "string" || value.length < 8 || Buffer.byteLength(value) > 72) {
    return [undefined, "Password must be 8-72 characters"];
  }
  return [value, null];
};

const keyOf = (allowed, label = "Value") => (value) =>
  typeof value === "string" && Object.hasOwn(allowed, value) ? [value, null] : [undefined, `${label} isn't valid`];

const oneOf = (list, label = "Value") => (value) =>
  list.includes(value) ? [value, null] : [undefined, `${label} isn't valid`];

const uuid = (label = "Session") => (value) =>
  typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? [value, null] : [undefined, `${label} isn't valid`];

const integer = ({ min, max, label = "Value" }) => (value) =>
  Number.isInteger(value) && value >= min && value <= max ? [value, null] : [undefined, `${label} isn't valid`];

export const rules = { string, displayName, email, password, keyOf, oneOf, uuid, integer };
