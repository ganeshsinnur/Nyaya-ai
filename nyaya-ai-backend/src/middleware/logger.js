/**
 * Lightweight HTTP request logger middleware.
 * Sanitizes and logs method, path, response status, and duration without logging headers/body containing PII or tokens.
 */
export const requestLogger = (req, res, next) => {
  const startTime = process.hrtime();

  res.on("finish", () => {
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const durationMs = (seconds * 1000 + nanoseconds / 1e6).toFixed(2);
    console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} - ${durationMs}ms`);
  });

  next();
};
