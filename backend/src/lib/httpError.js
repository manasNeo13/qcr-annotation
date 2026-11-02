export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
