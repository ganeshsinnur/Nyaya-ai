import { PdfExtractor } from "./pdfExtractor.service.js";
import { chunkDocument } from "./chunker.service.js";
import { EmbeddingService, EMBEDDING_MODEL } from "./embeddings.service.js";
import { VectorStoreService } from "./vectorStore.service.js";
import { AppError } from "../../utils/apiResponse.js";

/**
 * Orchestrates the full document ingestion pipeline:
 *   1. Validate source trustworthiness
 *   2. Extract text (PDF or plain text)
 *   3. Chunk with overlap
 *   4. Generate Gemini embeddings
 *   5. Store in MongoDB
 *
 * This pipeline is intentionally synchronous per-document so errors
 * surface clearly. For bulk ingestion, call it in a background worker.
 */
export class IngestionService {
  /**
   * Ingests a document from a Buffer (PDF bytes).
   *
   * @param {Buffer} pdfBuffer
   * @param {object} docMeta  Document-level metadata (all required by LegalChunk schema)
   * @returns {Promise<IngestionResult>}
   */
  static async ingestPdf(pdfBuffer, docMeta) {
    _validateMeta(docMeta);

    const { text, pageCount, sha256 } = await PdfExtractor.extractFromBuffer(pdfBuffer);

    if (!text || text.trim().length < 100) {
      throw new AppError(
        "PDF text extraction produced insufficient content. The file may be scanned/image-only.",
        422
      );
    }

    return IngestionService._runPipeline(text, pageCount, sha256, docMeta);
  }

  /**
   * Ingests a document from plain text (pre-extracted or non-PDF sources).
   *
   * @param {string} text
   * @param {object} docMeta
   * @returns {Promise<IngestionResult>}
   */
  static async ingestText(text, docMeta) {
    _validateMeta(docMeta);

    const { text: normalisedText, pageCount, sha256 } = PdfExtractor.extractFromText(text);

    if (!normalisedText || normalisedText.trim().length < 100) {
      throw new AppError("Text content is too short to ingest meaningfully.", 422);
    }

    return IngestionService._runPipeline(normalisedText, pageCount, sha256, docMeta);
  }

  // ── Private pipeline steps ─────────────────────────────────────────────────

  static async _runPipeline(text, pageCount, documentSha256, docMeta) {
    // Step 1: Chunk
    const rawChunks = chunkDocument(text, docMeta);

    if (rawChunks.length === 0) {
      throw new AppError("Document produced no chunks after text extraction.", 422);
    }

    // Step 2: Generate embeddings in one batched call
    const texts = rawChunks.map((c) => c.text);
    let embeddings;
    try {
      embeddings = await EmbeddingService.embedDocuments(texts);
    } catch (err) {
      throw new AppError(`Embedding generation failed: ${err.message}`, 502);
    }

    if (embeddings.length !== rawChunks.length) {
      throw new AppError(
        `Embedding count mismatch: ${embeddings.length} vs ${rawChunks.length} chunks`,
        502
      );
    }

    // Step 3: Merge embeddings into chunks
    const chunksWithEmbeddings = rawChunks.map((chunk, i) => ({
      ...chunk,
      embedding: embeddings[i],
      embeddingModel: EMBEDDING_MODEL,
    }));

    // Step 4: Persist
    const { inserted, skipped } = await VectorStoreService.upsertChunks(
      chunksWithEmbeddings
    );

    return {
      documentTitle: docMeta.documentTitle,
      actName: docMeta.actName,
      pageCount,
      totalChunks: rawChunks.length,
      inserted,
      skipped,
      documentSha256,
    };
  }
}

/**
 * @typedef {object} IngestionResult
 * @property {string} documentTitle
 * @property {string} actName
 * @property {number} pageCount
 * @property {number} totalChunks
 * @property {number} inserted
 * @property {number} skipped
 * @property {string} documentSha256
 */

// ─── Meta validation ──────────────────────────────────────────────────────────

function _validateMeta(meta) {
  const required = [
    "documentTitle",
    "actName",
    "sourceType",
    "sourceUrl",
    "lastVerifiedDate",
  ];
  for (const field of required) {
    if (!meta[field]) {
      throw new AppError(`Missing required metadata field: ${field}`, 400);
    }
  }

  // Reject non-trusted sources
  if (!PdfExtractor.isTrustedSource(meta.sourceUrl)) {
    throw new AppError(
      `Source URL is not from a trusted domain: ${meta.sourceUrl}. ` +
        "Only official government and recognised legal portals are permitted.",
      403
    );
  }
}

