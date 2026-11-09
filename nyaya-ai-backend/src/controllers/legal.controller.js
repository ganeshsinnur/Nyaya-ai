import { IngestionService } from "../services/rag/ingestion.service.js";
import { RetrievalService } from "../services/rag/retrieval.service.js";
import { LegalAnalysisService } from "../services/rag/legalAnalysis.service.js";
import { sendResponse, AppError } from "../utils/apiResponse.js";

// ─── POST /api/legal/ingest ───────────────────────────────────────────────────

/**
 * Ingests a legal document into the RAG knowledge base.
 *
 * Accepts:
 *  - JSON body with `text` field (plain text ingestion)
 *  - multipart/form-data with a `file` field (PDF ingestion — requires multer middleware)
 *
 * All metadata fields are validated by the Zod middleware before this runs.
 */
export const ingestDocument = async (req, res, next) => {
  try {
    const meta = req.body;

    let result;

    if (req.file) {
      // PDF upload path (multer populates req.file)
      result = await IngestionService.ingestPdf(req.file.buffer, meta);
    } else if (meta.text) {
      // Plain text path
      const { text, ...docMeta } = meta;
      result = await IngestionService.ingestText(text, docMeta);
    } else {
      throw new AppError(
        "Either a PDF file (multipart upload) or a `text` field in the request body is required.",
        400
      );
    }

    return sendResponse(res, 201, {
      success: true,
      message: `Document ingested successfully: ${result.inserted} new chunks, ${result.skipped} duplicates skipped`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/legal/search ───────────────────────────────────────────────────

/**
 * Runs hybrid (semantic + keyword) retrieval against the legal knowledge base.
 * Returns ranked chunks with their source metadata and relevance scores.
 * Does NOT generate an AI answer — use /analyze for that.
 */
export const searchLegal = async (req, res, next) => {
  try {
    const { query, topK, filters, mode } = req.body;

    let result;

    if (mode === "keyword") {
      // Keyword-only
      const { VectorStoreService } = await import(
        "../services/rag/vectorStore.service.js"
      );
      const raw = await VectorStoreService.keywordSearch(query, filters, topK);
      result = {
        chunks: raw.map((r) => r.chunk),
        totalSemanticCandidates: 0,
        totalKeywordCandidates: raw.length,
      };
    } else if (mode === "semantic") {
      // Semantic-only
      const { EmbeddingService } = await import(
        "../services/rag/embeddings.service.js"
      );
      const { VectorStoreService } = await import(
        "../services/rag/vectorStore.service.js"
      );
      const qv = await EmbeddingService.embedQuery(query);
      const raw = await VectorStoreService.semanticSearch(qv, filters, topK);
      result = {
        chunks: raw.map((r) => r.chunk),
        totalSemanticCandidates: raw.length,
        totalKeywordCandidates: 0,
      };
    } else {
      // Default: hybrid
      result = await RetrievalService.retrieve(query, { topK, filters });
    }

    return sendResponse(res, 200, {
      success: true,
      message: `Retrieved ${result.chunks.length} legal chunks`,
      data: {
        query,
        mode,
        chunks: result.chunks,
        stats: {
          returned: result.chunks.length,
          semanticCandidates: result.totalSemanticCandidates,
          keywordCandidates: result.totalKeywordCandidates,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/legal/analyze ──────────────────────────────────────────────────

/**
 * Full RAG pipeline — retrieves relevant legal provisions and generates a
 * grounded, cited, validated legal analysis.
 *
 * SAFETY: Every citation in the response is verified against retrieved chunks.
 * Any unverified citation is stripped before the response is returned.
 */
export const analyzeQuery = async (req, res, next) => {
  try {
    const { query, caseContext, topK } = req.body;

    const result = await LegalAnalysisService.analyze(query, caseContext, {
      topK,
    });

    const statusCode = result.abstain ? 200 : 200;

    return sendResponse(res, statusCode, {
      success: true,
      message: result.abstain
        ? "Insufficient legal sources — answer abstained"
        : "Legal analysis completed",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

