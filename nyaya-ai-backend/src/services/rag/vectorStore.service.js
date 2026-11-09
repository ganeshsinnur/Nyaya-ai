import mongoose from "mongoose";
import { LegalChunk } from "../../models/legalChunk.model.js";
import { EmbeddingService } from "./embeddings.service.js";
import { AppError } from "../../utils/apiResponse.js";

/** Number of results to return from each retrieval strategy */
const TOP_K_VECTOR = 20;
const TOP_K_KEYWORD = 15;
/** Final fused result count */
export const DEFAULT_TOP_K = 8;

export class VectorStoreService {
  /**
   * Stores an array of chunk objects (with pre-computed embeddings) into MongoDB.
   * Skips chunks whose `contentHash` already exists (idempotent ingestion).
   *
   * @param {Array<object>} chunksWithEmbeddings
   * @returns {Promise<{ inserted: number, skipped: number }>}
   */
  static async upsertChunks(chunksWithEmbeddings) {
    let inserted = 0;
    let skipped = 0;

    for (const chunk of chunksWithEmbeddings) {
      try {
        await LegalChunk.create(chunk);
        inserted++;
      } catch (err) {
        // E11000 = duplicate key — content already ingested
        if (err.code === 11000) {
          skipped++;
        } else {
          throw new AppError(`Chunk storage failed: ${err.message}`, 500);
        }
      }
    }

    return { inserted, skipped };
  }

  /**
   * Semantic (vector) retrieval.
   *
   * Tries Atlas Vector Search first (requires Atlas cluster + index named
   * "legal_vector_index"). Falls back to in-process cosine similarity
   * search over all active chunks when Atlas is unavailable.
   *
   * @param {number[]} queryEmbedding
   * @param {object} [filters={}]   Optional MongoDB match filters
   * @param {number} [topK]
   * @returns {Promise<Array<{chunk: object, score: number}>>}
   */
  static async semanticSearch(queryEmbedding, filters = {}, topK = TOP_K_VECTOR) {
    // ── Attempt Atlas Vector Search ────────────────────────────────────────
    if (mongoose.connection.readyState === 1) {
      try {
        const pipeline = [
          {
            $vectorSearch: {
              index: "legal_vector_index",
              path: "embedding",
              queryVector: queryEmbedding,
              numCandidates: topK * 10,
              limit: topK,
              filter: { isActive: true, ...filters },
            },
          },
          {
            $addFields: { vectorScore: { $meta: "vectorSearchScore" } },
          },
          {
            $project: { embedding: 0 }, // exclude the large vector from results
          },
        ];

        const results = await LegalChunk.aggregate(pipeline);
        if (results.length > 0) {
          return results.map((r) => ({ chunk: r, score: r.vectorScore ?? 0 }));
        }
        // If Atlas returned 0 results (index might not exist yet), fall through
      } catch (atlasErr) {
        // $vectorSearch stage not supported on local MongoDB — use fallback
        if (
          !atlasErr.message?.includes("$vectorSearch") &&
          !atlasErr.message?.includes("PlanExecutor")
        ) {
          throw new AppError(`Vector search failed: ${atlasErr.message}`, 500);
        }
        // else: fall through to cosine fallback
      }
    }

    // ── Local cosine similarity fallback ──────────────────────────────────
    return VectorStoreService._cosineSearch(queryEmbedding, filters, topK);
  }

  /**
   * Full-text keyword search using MongoDB's $text index.
   * Works on both local MongoDB and Atlas.
   *
   * @param {string} queryText
   * @param {object} [filters={}]
   * @param {number} [topK]
   * @returns {Promise<Array<{chunk: object, score: number}>>}
   */
  static async keywordSearch(queryText, filters = {}, topK = TOP_K_KEYWORD) {
    try {
      const results = await LegalChunk.find(
        {
          $text: { $search: queryText },
          isActive: true,
          ...filters,
        },
        { score: { $meta: "textScore" }, embedding: 0 }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(topK)
        .lean();

      return results.map((r) => ({ chunk: r, score: r.score ?? 0 }));
    } catch (err) {
      // Text index might not exist yet in a fresh DB — degrade gracefully
      console.warn("[VectorStore] Keyword search unavailable:", err.message);
      return [];
    }
  }

  /**
   * Fuses semantic and keyword results using Reciprocal Rank Fusion (RRF).
   * RRF score = Σ 1/(k + rank_i) across all retrieval lists.
   *
   * @param {Array<{chunk: object, score: number}>} semanticResults
   * @param {Array<{chunk: object, score: number}>} keywordResults
   * @param {number} [topK]
   * @param {number} [k=60]  RRF constant
   * @returns {Array<{chunk: object, semanticScore: number, keywordScore: number, rrfScore: number}>}
   */
  static fuseResults(semanticResults, keywordResults, topK = DEFAULT_TOP_K, k = 60) {
    const scores = new Map(); // chunkId → {chunk, semanticRank, keywordRank}

    // Index semantic results by rank
    for (let i = 0; i < semanticResults.length; i++) {
      const id = String(semanticResults[i].chunk._id);
      scores.set(id, {
        chunk: semanticResults[i].chunk,
        semanticScore: semanticResults[i].score,
        semanticRank: i + 1,
        keywordScore: 0,
        keywordRank: null,
      });
    }

    // Merge keyword results
    for (let i = 0; i < keywordResults.length; i++) {
      const id = String(keywordResults[i].chunk._id);
      if (scores.has(id)) {
        scores.get(id).keywordScore = keywordResults[i].score;
        scores.get(id).keywordRank = i + 1;
      } else {
        scores.set(id, {
          chunk: keywordResults[i].chunk,
          semanticScore: 0,
          semanticRank: null,
          keywordScore: keywordResults[i].score,
          keywordRank: i + 1,
        });
      }
    }

    // Compute RRF score
    const fused = [...scores.values()].map((entry) => ({
      ...entry,
      rrfScore:
        (entry.semanticRank ? 1 / (k + entry.semanticRank) : 0) +
        (entry.keywordRank ? 1 / (k + entry.keywordRank) : 0),
    }));

    return fused
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, topK);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * In-process cosine similarity search over all active chunks.
   * O(n) over the entire collection — only suitable for dev/small datasets.
   */
  static async _cosineSearch(queryEmbedding, filters = {}, topK = TOP_K_VECTOR) {
    const query = { isActive: true, ...filters };
    // Fetch all chunks with their embeddings (embedding is select:false by default)
    const chunks = await LegalChunk.find(query)
      .select("+embedding")
      .lean();

    if (chunks.length === 0) return [];

    const scored = chunks
      .filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0)
      .map((c) => ({
        chunk: { ...c, embedding: undefined }, // don't return vectors to callers
        score: EmbeddingService.cosineSimilarity(queryEmbedding, c.embedding),
      }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

