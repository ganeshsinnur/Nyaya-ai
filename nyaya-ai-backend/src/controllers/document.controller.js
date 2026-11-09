import { DocumentService } from "../services/document/document.service.js";
import { sendResponse } from "../utils/apiResponse.js";

// ─── POST /api/documents/generate ─────────────────────────────────────────────

/**
 * Generates a structured legal document draft.
 * Returns the draft with placeholders that the user must review and fill.
 * Status starts as "draft" — user must confirm before finalization.
 */
export const generateDocument = async (req, res, next) => {
  try {
    const doc = await DocumentService.generate(req.body);

    return sendResponse(res, 201, {
      success: true,
      message:
        "Document draft generated successfully. " +
        "Review the content and fill any placeholders before confirming.",
      data: {
        documentId: doc._id,
        documentType: doc.documentType,
        title: doc.title,
        status: doc.status,
        content: doc.content,
        sections: doc.sections,
        placeholders: doc.placeholders,
        citations: doc.citations,
        currentVersion: doc.currentVersion,
        disclaimer: doc.disclaimer,
        nextSteps: _buildNextSteps(doc),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/documents/:id ──────────────────────────────────────────────────

/**
 * Retrieves a legal document by id.
 */
export const getDocument = async (req, res, next) => {
  try {
    const doc = await DocumentService.getById(req.params.id);

    return sendResponse(res, 200, {
      success: true,
      message: "Document retrieved successfully",
      data: {
        documentId: doc._id,
        documentType: doc.documentType,
        title: doc.title,
        status: doc.status,
        content: doc.content,
        sections: doc.sections,
        placeholders: doc.placeholders,
        citations: doc.citations,
        currentVersion: doc.currentVersion,
        versions: doc.versions?.map((v) => ({
          versionNumber: v.versionNumber,
          generatedAt: v.generatedAt,
          changes: v.changes,
        })),
        disclaimer: doc.disclaimer,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        nextSteps: _buildNextSteps(doc),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/documents/:id/download ─────────────────────────────────────────

/**
 * Downloads the document as a PDF.
 * Generates a PDF on-the-fly for drafts (preview) or serves the stored PDF
 * for finalized documents.
 */
export const downloadDocument = async (req, res, next) => {
  try {
    const { buffer, title, documentType } = await DocumentService.getPdf(req.params.id);

    const filename = `${(title || documentType).replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_")}.pdf`;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
    });

    return res.send(buffer);
  } catch (error) {
    next(error);
  }
};

// ─── PATCH /api/documents/:id/fill-placeholders ──────────────────────────────

/**
 * Fills placeholders in a draft document with user-supplied values.
 * Creates a new version and updates the content.
 */
export const fillPlaceholders = async (req, res, next) => {
  try {
    const doc = await DocumentService.fillPlaceholders(req.params.id, req.body.fills);

    return sendResponse(res, 200, {
      success: true,
      message: doc.placeholders.length > 0
        ? `Placeholders partially filled. ${doc.placeholders.length} remaining.`
        : "All placeholders filled. You may now confirm the document.",
      data: {
        documentId: doc._id,
        remainingPlaceholders: doc.placeholders,
        currentVersion: doc.currentVersion,
        content: doc.content,
        nextSteps: _buildNextSteps(doc),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/documents/:id/confirm ─────────────────────────────────────────

/**
 * User confirms the draft after reviewing.
 * Only succeeds if all placeholders are filled.
 */
export const confirmDocument = async (req, res, next) => {
  try {
    const doc = await DocumentService.confirmDraft(req.params.id);

    return sendResponse(res, 200, {
      success: true,
      message:
        "Document confirmed. You can now finalize it to generate the downloadable PDF.",
      data: {
        documentId: doc._id,
        status: doc.status,
        nextSteps: _buildNextSteps(doc),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/documents/:id/finalize ────────────────────────────────────────

/**
 * Generates the final PDF and stores it. Document becomes immutable.
 * Requires status = 'confirmed'.
 */
export const finalizeDocument = async (req, res, next) => {
  try {
    const doc = await DocumentService.finalize(req.params.id);

    return sendResponse(res, 200, {
      success: true,
      message:
        "Document finalized and PDF generated. " +
        "Download it at GET /api/v1/documents/:id/download.",
      data: {
        documentId: doc._id,
        status: doc.status,
        pdfGeneratedAt: doc.pdfGeneratedAt,
        downloadUrl: `/api/v1/documents/${doc._id}/download`,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _buildNextSteps(doc) {
  const steps = [];

  if (doc.status === "draft") {
    if (doc.placeholders?.length > 0) {
      steps.push(
        `Fill ${doc.placeholders.length} placeholder(s): PATCH /api/v1/documents/${doc._id}/fill-placeholders`
      );
    }
    steps.push(
      `Review and confirm: POST /api/v1/documents/${doc._id}/confirm`
    );
    steps.push(
      `Preview PDF: GET /api/v1/documents/${doc._id}/download`
    );
  }

  if (doc.status === "confirmed") {
    steps.push(
      `Finalize and generate PDF: POST /api/v1/documents/${doc._id}/finalize`
    );
  }

  if (doc.status === "final") {
    steps.push(
      `Download PDF: GET /api/v1/documents/${doc._id}/download`
    );
  }

  return steps;
}

