import { Router } from "express";
import { evaluateQuery } from "../controllers/evaluation.controller.js";
import { validate } from "../middleware/validate.js";
import { analyzeSchema } from "../validators/legal.validator.js";

const router = Router();
router.post("/analyze", validate(analyzeSchema, "body"), evaluateQuery);
export default router;
