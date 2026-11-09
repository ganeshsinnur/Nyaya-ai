import { Router } from "express";
import { extractCase, getCase, correctCase } from "../controllers/case.controller.js";
import { validate } from "../middleware/validate.js";
import { extractCaseSchema, correctCaseSchema } from "../validators/case.validator.js";

const router = Router();

/**
 * POST /api/cases/extract
 * Extract a structured legal case from a conversation.
 * Pass `caseId` in the body to perform an incremental update.
 */
router.post(
  "/extract",
  validate(extractCaseSchema, "body"),
  extractCase
);

/**
 * GET /api/cases/:id
 * Retrieve a full legal case document by MongoDB ObjectId.
 */
router.get("/:id", getCase);

/**
 * PATCH /api/cases/:id/correct
 * Apply user corrections to an extracted case.
 */
router.patch(
  "/:id/correct",
  validate(correctCaseSchema, "body"),
  correctCase
);

export default router;

