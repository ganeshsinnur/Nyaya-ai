/**
 * Operational Application Error for predictable HTTP responses.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Standard API JSON response formatter.
 */
export const sendResponse = (res, statusCode, { success = true, message = "", data = null }) => {
  return res.status(statusCode).json({
    success,
    message,
    ...(data !== null && { data }),
  });
};
