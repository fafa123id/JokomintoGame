const base64url = (max) => (value) =>
  typeof value === "string" && value.length <= max && /^[A-Za-z0-9_-]+=*$/.test(value) ? [value, null] : [undefined, "Invalid key"];

const subscription = (value) => {
  if (!value || typeof value !== "object") return [undefined, "Subscription is required"];
  const { endpoint, keys } = value;
  if (typeof endpoint !== "string" || endpoint.length > 1000 || !endpoint.startsWith("https://")) {
    return [undefined, "Invalid endpoint"];
  }
  const [p256dh, e1] = base64url(200)(keys?.p256dh);
  const [auth, e2] = base64url(100)(keys?.auth);
  if (e1 || e2) return [undefined, "Invalid subscription keys"];
  return [{ endpoint, keys: { p256dh, auth } }, null];
};

export const subscribeSchema = { subscription };

export const unsubscribeSchema = {
  endpoint: (value) =>
    typeof value === "string" && value.length <= 1000 ? [value, null] : [undefined, "Invalid endpoint"],
};
