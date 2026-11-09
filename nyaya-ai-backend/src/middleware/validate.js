import { AppError } from "../utils/apiResponse.js";

/**
 * Higher-order middleware to validate req.body, req.query, or req.params using a Zod schema.
 */
export const validate = (schema, target = "body") => {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const issueDetails = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));

      return next(new AppError("Validation failed", 400, issueDetails));
    }

    // Replace with validated and sanitized data
    req[target] = result.data;
    next();
  };
};
