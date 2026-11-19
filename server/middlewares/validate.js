import { HttpError } from "../utils/httpError.js";

// Only fields declared in the schema reach the controller (req.validated).
export function validate(schema) {
  return (req, res, next) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const validated = {};
    const errors = {};

    for (const [field, rule] of Object.entries(schema)) {
      const [value, error] = rule(body[field]);
      if (error) errors[field] = error;
      else if (value !== undefined) validated[field] = value;
    }

    const failed = Object.keys(errors);
    if (failed.length) return next(HttpError.unprocessable(errors[failed[0]], errors));
    req.validated = validated;
    next();
  };
}
