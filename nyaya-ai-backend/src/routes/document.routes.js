import { Router } from "express";
import {
  generateDocument,
  getDocument,
  downloadDocument,
  fillPlaceholders,
  confirmDocument,
  finalizeDocument,
} from "../controllers/document.controller.js";
import { validate } from "../middleware/validate.js";
import {
  generateDocumentSchema,
  fillPlaceholdersSchema,
  documentIdParamSchema,
} from "../validators/document.validator.js";

const router = Router();

/**
 * POST /api/v1/documents/generate
 *
 * Generate a structured legal document draft.
 * Returns the draft content with placeholders and citation references.
 * Status starts as "draft" — the user MUST confirm before finalization.
 */
router.post(
  "/generate",
  validate(generateDocumentSchema, "body"),
  generateDocument
);

/**
 * GET /api/v1/documents/:id
 *
 * Retrieve a legal document by its MongoDB ObjectId.
 */
router.get(
  "/:id",
  validate(documentIdParamSchema, "params"),
  getDocument
);

/**
 * GET /api/v1/documents/:id/download
 *
 * Download the document as a PDF.
 * For drafts: generates a preview PDF on-the-fly.
 * For finalized documents: serves the stored PDF.
 */
router.get(
  "/:id/download",
  validate(documentIdParamSchema, "params"),
  downloadDocument
);

/**
 * PATCH /api/v1/documents/:id/fill-placeholders
 *
 * Fill in missing information placeholders with user-supplied values.
 * Creates a new document version.
 */
router.patch(
  "/:id/fill-placeholders",
  validate(documentIdParamSchema, "params"),
  validate(fillPlaceholdersSchema, "body"),
  fillPlaceholders
);

/**
 * POST /api/v1/documents/:id/confirm
 *
 * User confirms the draft after reviewing. All placeholders must be filled.
 * Moves status from 'draft' → 'confirmed'.
 */
router.post(
  "/:id/confirm",
  validate(documentIdParamSchema, "params"),
  confirmDocument
);

/**
 * POST /api/v1/documents/:id/finalize
 *
 * Generates the final PDF and stores it. Document becomes immutable.
 * Moves status from 'confirmed' → 'final'.
 */
router.post(
  "/:id/finalize",
  validate(documentIdParamSchema, "params"),
  finalizeDocument
);

export default router;

