import { getGeminiClient } from "../../config/gemini.js";
import config from "../../config/env.js";
import { AppError } from "../../utils/apiResponse.js";

/**
 * Gemini embedding model.
 * Defaults to "gemini-embedding-001" with 768-dim output to match vector index.
 */
export const EMBEDDING_MODEL = config.gemini.embeddingModel || "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Maximum number of texts to embed in a single batch call.
 * Gemini's batchEmbedContents supports up to 100 inputs.
 */
const BATCH_SIZE = 50;

/**
 * Free-tier limit is 30k embedding tokens/min. Keep each request well under it
 * (rough estimate: ~3 chars/token) and pace requests; 429s are retried below.
 */
const MAX_BATCH_TOKENS = 8000;
const MAX_RETRIES = 8;
const estTokens = (t) => Math.ceil(t.length / 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryDelayMs = (err) => {
  const m = /retry in ([\d.]+)s/i.exec(err?.message ?? "") || /"retryDelay":"(\d+)s"/.exec(err?.message ?? "");
  return (m ? Number(m[1]) : 30) * 1000 + 2000;
};
const isRateLimit = (err) =>
  err?.status === 429 || err?.code === 429 || /RESOURCE_EXHAUSTED|"code":429/.test(err?.message ?? "");

/**
 * Task types that improve embedding quality by telling the model
 * what the embedding will be used for.
 */
export const TASK_TYPES = {
  DOCUMENT: "RETRIEVAL_DOCUMENT", // used when ingesting chunks
  QUERY: "RETRIEVAL_QUERY", // used when embedding a search query
};

export class EmbeddingService {
  /**
   * Generates a single embedding vector for a query string.
   *
   * @param {string} text
   * @returns {Promise<number[]>} 768-dimensional float array
   */
  static async embedQuery(text) {
    const vectors = await EmbeddingService._embed([text], TASK_TYPES.QUERY);
    return vectors[0];
  }

  /**
   * Generates embedding vectors for an array of document texts.
   * Automatically batches to respect API limits.
   *
   * @param {string[]} texts
   * @returns {Promise<number[][]>}
   */
  static async embedDocuments(texts) {
    return EmbeddingService._embed(texts, TASK_TYPES.DOCUMENT);
  }

  static _call(client, batch, taskType) {
    return client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
      config: {
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
        httpOptions: { apiVersion: "v1beta" },
      },
    });
  }

  /**
   * Core embedding call — batched, with retry on transient errors.
   *
   * @param {string[]} texts
   * @param {string} taskType
   * @returns {Promise<number[][]>}
   */
  static async _embed(texts, taskType) {
    const client = getGeminiClient();
    const allVectors = [];

    // Build batches bounded by both count and estimated tokens
    const batches = [];
    let cur = [], curTokens = 0;
    for (const t of texts) {
      const n = estTokens(t);
      if (cur.length && (cur.length >= BATCH_SIZE || curTokens + n > MAX_BATCH_TOKENS)) {
        batches.push(cur); cur = []; curTokens = 0;
      }
      cur.push(t); curTokens += n;
    }
    if (cur.length) batches.push(cur);

    for (const batch of batches) {
      let result;
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            result = await EmbeddingService._call(client, batch, taskType);
            break;
          } catch (err) {
            if (!isRateLimit(err) || attempt >= MAX_RETRIES) throw err;
            const wait = retryDelayMs(err);
            console.warn(`[Embeddings] Rate limited; waiting ${Math.round(wait / 1000)}s (retry ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(wait);
          }
        }
      } catch (err) {
        throw new AppError(
          `Embedding generation failed: ${err.message}`,
          502
        );
      }
      if (batches.length > 1) await sleep(15000); // pace under tokens/min

      // Handle both single and batch response shapes
      const responses =
        result.embeddings ??
        result.inlinedEmbedContentResponses ??
        (result.embedding ? [result] : []);

      if (!responses.length) {
        throw new AppError("Gemini returned an empty embedding response", 502);
      }

      for (const r of responses) {
        const values =
          r.values ??
          r.embedding?.values ??
          r.embeddings?.[0]?.values;

        if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
          throw new AppError(
            `Unexpected embedding dimensions: got ${values?.length}, expected ${EMBEDDING_DIMENSIONS}`,
            502
          );
        }
        allVectors.push(values);
      }
    }

    return allVectors;
  }

  /**
   * Computes cosine similarity between two equal-length vectors.
   * Returns a value in [-1, 1]; 1 = identical direction.
   *
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number}
   */
  static cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}

