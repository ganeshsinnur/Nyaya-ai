import { CaseExtractionService } from "../services/ai/caseExtraction.service.js";
import { CaseService } from "../services/case.service.js";
import { sendResponse } from "../utils/apiResponse.js";

/**
 * POST /api/cases/extract
 *
 * Converts a conversation into a structured legal case file.
 * If `caseId` is supplied, performs an incremental update on the existing case.
 */
export const extractCase = async (req, res, next) => {
  try {
    const { conversation, caseId } = req.body;

    // 1. Run extraction via Gemini
    const { extracted, raw } = await CaseExtractionService.extractFromConversation(
      conversation
    );

    // 2. Persist to MongoDB (create or update)
    let caseDoc;
    if (caseId) {
      caseDoc = await CaseService.updateCase(caseId, conversation, extracted, raw);
    } else {
      caseDoc = await CaseService.createCase(conversation, extracted, raw);
    }

    return sendResponse(res, caseId ? 200 : 201, {
      success: true,
      message: caseId
        ? "Case updated with new conversation data"
        : "Legal case extracted and stored successfully",
      data: {
        caseId: caseDoc._id,
        extractionVersion: caseDoc.extractionVersion,
        caseCompleteness: caseDoc.caseCompleteness,
        urgency: caseDoc.urgency,
        missingInformation: caseDoc.missingInformation,
        contradictions: caseDoc.contradictions,
        case: caseDoc,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/cases/:id
 *
 * Returns the full structured case document.
 */
export const getCase = async (req, res, next) => {
  try {
    const doc = await CaseService.getCase(req.params.id);

    return sendResponse(res, 200, {
      success: true,
      message: "Case retrieved successfully",
      data: doc,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/cases/:id/correct
 *
 * Applies user-supplied fact corrections to an extracted case.
 * Original Gemini values are preserved in `userCorrections` for audit.
 */
export const correctCase = async (req, res, next) => {
  try {
    const { corrections } = req.body;

    const doc = await CaseService.correctCase(req.params.id, corrections);

    return sendResponse(res, 200, {
      success: true,
      message: "Corrections applied successfully",
      data: {
        caseId: doc._id,
        userCorrections: doc.userCorrections,
        case: doc,
      },
    });
  } catch (error) {
    next(error);
  }
};

