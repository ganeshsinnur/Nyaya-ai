import { Router } from "express";
import { ingestDocument, searchLegal, analyzeQuery } from "../controllers/legal.controller.js";
import { validate } from "../middleware/validate.js";
import {
  ingestDocumentSchema,
  searchSchema,
  analyzeSchema,
} from "../validators/legal.validator.js";

const router = Router();

/**
 * POST /api/v1/legal/ingest
 *
 * Ingests a legal document into the RAG knowledge base.
 *
 * Body (JSON — plain text):
 *   { documentTitle, actName, sourceType, sourceUrl, lastVerifiedDate, text, ...meta }
 *
 * Body (multipart/form-data — PDF):
 *   { file: <PDF>, documentTitle, actName, sourceType, sourceUrl, lastVerifiedDate }
 *
 * Only documents from trusted government domains are accepted.
 */
router.post(
  "/ingest",
  validate(ingestDocumentSchema, "body"),
  ingestDocument
);

/**
 * POST /api/v1/legal/search
 *
 * Runs hybrid semantic + keyword retrieval.
 * Returns ranked legal chunks with metadata and scores.
 * Does NOT call Gemini — use /analyze for AI-generated answers.
 */
router.post(
  "/search",
  validate(searchSchema, "body"),
  searchLegal
);

/**
 * POST /api/v1/legal/analyze
 *
 * Full RAG pipeline:
 *   1. Retrieves relevant legal chunks (hybrid)
 *   2. Generates a grounded, cited legal analysis via Gemini
 *   3. Validates all citations against retrieved sources
 *   4. Returns structured answer with verified citations and safety warnings
 */
router.post(
  "/analyze",
  validate(analyzeSchema, "body"),
  analyzeQuery
);

export default router;

