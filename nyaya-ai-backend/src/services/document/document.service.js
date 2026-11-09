import { LegalDocument } from "../../models/document.model.js";
import { DocumentDraftingService } from "./drafting.service.js";
import { generateDocumentPdf } from "./pdfGenerator.service.js";
import { RetrievalService } from "../rag/retrieval.service.js";
import { CitationValidator } from "../rag/citationValidator.service.js";
import { LegalCase } from "../../models/case.model.js";
import { AppError } from "../../utils/apiResponse.js";

export class DocumentService {
  /**
   * Full document generation pipeline:
   *   1. Load case data (if caseId provided)
   *   2. Retrieve relevant legal provisions via RAG
   *   3. Validate citations
   *   4. Generate structured document via Gemini
   *   5. Store as draft in MongoDB
   *
   * @param {object} params
   * @param {string} params.documentType
   * @param {string} [params.caseId]     Link to an extracted case
   * @param {object} [params.caseData]   Inline case data (alternative to caseId)
   * @param {string} [params.additionalInstructions]
   * @returns {Promise<import('mongoose').Document>}
   */
  static async generate(params) {
    const { documentType, caseId, caseData: inlineCaseData, additionalInstructions } = params;

    // ── Step 1: Resolve case data ──────────────────────────────────────────
    let caseData = inlineCaseData || {};
    if (caseId) {
      const caseDoc = await LegalCase.findById(caseId).lean();
      if (!caseDoc) {
        throw new AppError(`Case ${caseId} not found`, 404);
      }
      caseData = caseDoc;
    }

    // ── Step 2: RAG retrieval ──────────────────────────────────────────────
    let retrievedChunks = [];
    let citationResults = { verified: [], unverified: [], warnings: [] };

    // Build a retrieval query from the case + document type
    const retrievalQuery = _buildRetrievalQuery(documentType, caseData);

    if (!retrievalQuery) {
      throw new AppError("Unable to build a legal-source query for this document", 422);
    }
    try {
      const retrieval = await RetrievalService.retrieve(retrievalQuery, { topK: 8 });
      retrievedChunks = (retrieval.chunks ?? []).filter(
        (chunk) =>
          chunk.text &&
          chunk.actName &&
          chunk.sourceUrl &&
          chunk.lastVerifiedDate &&
          ["legislation", "rules", "notification"].includes(chunk.sourceType)
      );
    } catch (err) {
      throw new AppError(`Verified legal-source retrieval failed: ${err.message}`, 503);
    }
    if (retrievedChunks.length === 0) {
      throw new AppError(
        "No verified legal sources were found. Add verified provisions to the legal knowledge base and try again.",
        422
      );
    }

    // ── Step 3: Generate draft via Gemini ─────────────────────────────────
    const { title, sections, content, placeholders, citationKeysUsed, raw } =
      await DocumentDraftingService.generateDraft({
        documentType,
        caseData,
        retrievedChunks,
        additionalInstructions,
      });

    // ── Step 4: Validate citations ─────────────────────────────────────────
    const citationsInText = CitationValidator.extractCitationsFromText(sections.legalGrounds ?? "");
    const citationsToValidate = [...new Set([...citationKeysUsed, ...citationsInText])];
    citationResults = CitationValidator.validate(citationsToValidate, retrievedChunks);
    if (citationResults.unverified.length > 0) {
      throw new AppError(
        "Document generation returned citations that could not be verified. Please retry.",
        502,
        citationResults.unverified
      );
    }
    if (citationResults.verified.length === 0) {
      throw new AppError(
        "No legal provision could be verified for this draft. Please try again after the relevant source is available.",
        422
      );
    }

    const verifiedCitations = citationResults.verified?.map((v) => ({
      citationKey: v.citation,
      actName: v.chunk.actName,
      sectionNumber: v.chunk.sectionNumber,
      sourceType: v.chunk.sourceType,
      sourceUrl: v.chunk.sourceUrl,
      lastVerifiedDate: v.chunk.lastVerifiedDate,
    })) ?? [];

    // ── Step 5: Persist draft ──────────────────────────────────────────────
    const doc = await LegalDocument.create({
      documentType,
      title,
      status: "draft",
      content,
      sections,
      caseId: caseId || null,
      caseSnapshot: caseData,
      citations: verifiedCitations,
      placeholders,
      currentVersion: 1,
      versions: [
        {
          versionNumber: 1,
          content,
          sections,
          generatedAt: new Date(),
          changes: "Initial draft generated",
        },
      ],
      rawGeminiResponse: raw,
    });

    return doc;
  }

  /**
   * Retrieves a document by id.
   */
  static async getById(id) {
    const doc = await LegalDocument.findById(id);
    if (!doc) throw new AppError(`Document ${id} not found`, 404);
    return doc;
  }

  /**
   * Confirms a draft, changing its status from 'draft' → 'confirmed'.
   * User must explicitly confirm before generating the final PDF.
   */
  static async confirmDraft(id) {
    const doc = await LegalDocument.findById(id);
    if (!doc) throw new AppError(`Document ${id} not found`, 404);

    if (doc.status !== "draft") {
      throw new AppError(
        `Document is already ${doc.status}. Only drafts can be confirmed.`,
        400
      );
    }

    // Check for unfilled placeholders and warn
    if (doc.placeholders.length > 0) {
      throw new AppError(
        "Cannot confirm: this document still has unfilled placeholders. " +
          "Please fill them using PATCH /api/documents/:id/fill-placeholders first.",
        400,
        doc.placeholders
      );
    }

    doc.status = "confirmed";
    await doc.save();
    return doc;
  }

  /**
   * Generates the final PDF, stores it in the document, and sets status → 'final'.
   * Requires status = 'confirmed' (user must have reviewed first).
   */
  static async finalize(id) {
    const doc = await LegalDocument.findById(id);
    if (!doc) throw new AppError(`Document ${id} not found`, 404);

    if (doc.status === "draft") {
      throw new AppError(
        "Cannot finalize a draft. Confirm the document first via POST /api/documents/:id/confirm.",
        400
      );
    }

    // Generate PDF
    const pdfBuffer = generateDocumentPdf(doc);
    doc.pdfBuffer = pdfBuffer;
    doc.pdfGeneratedAt = new Date();
    doc.status = "final";

    await doc.save();
    return doc;
  }

  /**
   * Returns the PDF buffer for download (generates on-demand if not stored).
   */
  static async getPdf(id) {
    const doc = await LegalDocument.findById(id).select("+pdfBuffer");
    if (!doc) throw new AppError(`Document ${id} not found`, 404);

    // Generate PDF on-demand (works even for drafts — for preview)
    const pdfBuffer = doc.pdfBuffer ?? generateDocumentPdf(doc);
    return { buffer: pdfBuffer, title: doc.title, documentType: doc.documentType };
  }

  /**
   * Fills placeholders in the document content and sections.
   *
   * @param {string} id
   * @param {Record<string, string>} fills  Map of placeholder text → replacement value
   * @returns {Promise<import('mongoose').Document>}
   */
  static async fillPlaceholders(id, fills) {
    const doc = await LegalDocument.findById(id);
    if (!doc) throw new AppError(`Document ${id} not found`, 404);
    if (doc.status === "final") {
      throw new AppError("Cannot modify a finalized document.", 400);
    }

    let content = doc.content;
    const remainingPlaceholders = [];

    for (const placeholder of doc.placeholders) {
      const marker = `[PLACEHOLDER: ${placeholder}]`;
      const fill = fills[placeholder];
      if (fill) {
        content = content.replaceAll(marker, fill);
        // Also replace in sections
        for (const key of Object.keys(doc.sections)) {
          if (typeof doc.sections[key] === "string") {
            doc.sections[key] = doc.sections[key].replaceAll(marker, fill);
          }
        }
      } else {
        remainingPlaceholders.push(placeholder);
      }
    }

    doc.content = content;
    doc.placeholders = remainingPlaceholders;
    doc.currentVersion += 1;
    doc.versions.push({
      versionNumber: doc.currentVersion,
      content,
      sections: doc.sections,
      generatedAt: new Date(),
      changes: `Filled ${Object.keys(fills).length} placeholder(s)`,
    });

    doc.markModified("sections");
    await doc.save();
    return doc;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a natural-language retrieval query from the case data and document type.
 */
function _buildRetrievalQuery(documentType, caseData) {
  const parts = [];

  const typeQueries = {
    consumer_complaint: "consumer complaint filing procedure jurisdiction consumer protection act",
    refund_request: "refund consumer rights deficiency in service consumer protection",
    legal_notice: "legal notice consumer complaint pre-litigation demand notice",
    legal_notice_reply: "reply to legal notice consumer dispute response",
    grievance_application: "grievance application consumer redressal forum",
  };

  parts.push(typeQueries[documentType] ?? "consumer protection legal rights India");

  if (caseData.category) parts.push(caseData.category);
  if (caseData.subCategory) parts.push(caseData.subCategory);
    if (caseData.userClaims?.length) parts.push(...caseData.userClaims.slice(0, 2));

  return parts.join(" ").slice(0, 500);
}

