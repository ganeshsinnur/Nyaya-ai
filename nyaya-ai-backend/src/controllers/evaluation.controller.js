import { timingSafeEqual } from "node:crypto";
import { LegalAnalysisService } from "../services/rag/legalAnalysis.service.js";
import { sendResponse, AppError } from "../utils/apiResponse.js";

export const evaluateQuery = async (req, res, next) => {
  try {
    const configuredToken = process.env.NYAYAI_EVALUATION_TOKEN;
    const suppliedToken = req.get("x-evaluation-token") ?? "";
    const expected = Buffer.from(configuredToken ?? "");
    const supplied = Buffer.from(suppliedToken);
    if (
      process.env.NYAYAI_EVALUATION_MODE !== "true" ||
      !configuredToken ||
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      throw new AppError("Evaluation endpoint is disabled or unauthorized", 404);
    }

    const { query, caseContext, topK } = req.body;
    const result = await LegalAnalysisService.analyze(query, caseContext, {
      topK,
      includeRawModelOutput: true,
    });
    return sendResponse(res, 200, {
      success: true,
      message: result.abstain ? "Analysis abstained" : "Analysis completed",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
