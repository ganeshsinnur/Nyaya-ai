import { Router } from "express";
import { getHealth, testGemini } from "../controllers/health.controller.js";
import { validate } from "../middleware/validate.js";
import { geminiTestSchema } from "../validators/gemini.validator.js";

const router = Router();

// GET /api/v1/health - System and dependency health status
router.get("/health", getHealth);

// POST /api/v1/test-gemini - Gemini connectivity test with Zod body validation
router.post("/test-gemini", validate(geminiTestSchema, "body"), testGemini);

// Also support GET /api/v1/test-gemini with default prompt for easy browser / cURL testing
router.get("/test-gemini", (req, res, next) => {
  req.body = {};
  return validate(geminiTestSchema, "body")(req, res, () => testGemini(req, res, next));
});

export default router;
