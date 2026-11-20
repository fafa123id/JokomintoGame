export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true;
  }

  static badRequest(message, details) {
    return new HttpError(400, message, details);
  }

  static unauthorized(message = "Not logged in") {
    return new HttpError(401, message);
  }

  static forbidden(message = "Forbidden") {
    return new HttpError(403, message);
  }

  static notFound(message = "Not found") {
    return new HttpError(404, message);
  }

  static conflict(message) {
    return new HttpError(409, message);
  }

  static unprocessable(message, details) {
    return new HttpError(422, message, details);
  }

  static unavailable(message) {
    return new HttpError(503, message);
  }
}
