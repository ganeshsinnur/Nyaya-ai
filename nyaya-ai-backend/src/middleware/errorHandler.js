import config from "../config/env.js";

/**
 * Centralized error handler middleware.
 * Ensures consistent error shape, masks sensitive stack traces in production,
 * and handles Zod / Mongoose / Operational App errors.
 */
export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || (res.statusCode !== 200 ? res.statusCode : 500);
  const message = err.message || "Internal Server Error";

  // Safe logging without leaking sensitive payloads
  console.error(`[Error] ${req.method} ${req.originalUrl} - ${statusCode}: ${message}`);
  if (config.env === "development" && err.stack) {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(err.details && { details: err.details }),
    ...(config.env === "development" && { stack: err.stack }),
  });
};

/**
 * 404 handler for unrecognized routes.
 */
export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl} - Route not found`,
  });
};
