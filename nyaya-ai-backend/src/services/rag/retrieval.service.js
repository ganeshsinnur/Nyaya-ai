import { EmbeddingService } from "./embeddings.service.js";
import { VectorStoreService, DEFAULT_TOP_K } from "./vectorStore.service.js";

/**
 * Retrieval service — combines semantic + keyword search, fuses results with
 * RRF, and formats chunks into the citation objects used by the analysis layer.
 */
export class RetrievalService {
  /**
   * Runs the full hybrid retrieval pipeline for a user query.
   *
   * @param {string} query         Natural language legal question
   * @param {object} [options={}]
   * @param {number} [options.topK=8]
   * @param {object} [options.filters={}]  MongoDB filter to restrict by sourceType, actName, etc.
   * @returns {Promise<RetrievedContext>}
   */
  static async retrieve(query, options = {}) {
    const { topK = DEFAULT_TOP_K, filters = {} } = options;

    // Run semantic and keyword searches in parallel
    const [queryEmbedding, keywordResults] = await Promise.all([
      EmbeddingService.embedQuery(query),
      VectorStoreService.keywordSearch(query, filters),
    ]);

    const semanticResults = await VectorStoreService.semanticSearch(
      queryEmbedding,
      filters,
      topK * 3 // over-fetch for RRF
    );

    // Fuse with RRF
    const fused = VectorStoreService.fuseResults(
      semanticResults,
      keywordResults,
      topK
    );

    return {
      chunks: fused.map((r) => _formatChunk(r)),
      queryEmbedding, // returned so callers can pass to analysis without re-embedding
      totalSemanticCandidates: semanticResults.length,
      totalKeywordCandidates: keywordResults.length,
    };
  }
}

/**
 * @typedef {object} RetrievedContext
 * @property {FormattedChunk[]} chunks
 * @property {number[]} queryEmbedding
 * @property {number} totalSemanticCandidates
 * @property {number} totalKeywordCandidates
 */

/**
 * @typedef {object} FormattedChunk
 * @property {string} id           MongoDB ObjectId string
 * @property {string} text         Verbatim source text
 * @property {string} documentTitle
 * @property {string} actName
 * @property {string|null} sectionNumber
 * @property {string|null} subSection
 * @property {string|null} chapterTitle
 * @property {string} sourceType
 * @property {string} sourceUrl
 * @property {string|null} publicationDate
 * @property {string} lastVerifiedDate
 * @property {string} jurisdiction
 * @property {number} semanticScore
 * @property {number} keywordScore
 * @property {number} rrfScore
 * @property {string} citationKey   Short human-readable reference e.g. "CPA2019 §35"
 */

function _formatChunk(fusedEntry) {
  const { chunk, semanticScore, keywordScore, rrfScore } = fusedEntry;
  const section = chunk.subSection ?? chunk.sectionNumber;
  const citationKey = section
    ? `${_abbreviate(chunk.actName)} §${section}`
    : _abbreviate(chunk.actName);

  return {
    id: String(chunk._id),
    text: chunk.text,
    documentTitle: chunk.documentTitle,
    actName: chunk.actName,
    sectionNumber: chunk.sectionNumber,
    subSection: chunk.subSection,
    chapterTitle: chunk.chapterTitle,
    sourceType: chunk.sourceType,
    sourceUrl: chunk.sourceUrl,
    publicationDate: chunk.publicationDate,
    lastVerifiedDate: chunk.lastVerifiedDate,
    jurisdiction: chunk.jurisdiction,
    semanticScore: Number(semanticScore.toFixed(4)),
    keywordScore: Number(keywordScore.toFixed(4)),
    rrfScore: Number(rrfScore.toFixed(6)),
    citationKey,
  };
}

/** Produces a short abbreviation from an Act name, e.g. "Consumer Protection Act, 2019" → "CPA2019" */
function _abbreviate(actName) {
  const yearMatch = actName.match(/\b(\d{4})\b/);
  const year = yearMatch ? yearMatch[1] : "";
  // Non-statute sources (e.g. "General contract / tenancy practice") keep a readable name
  if (!yearMatch) return actName.length > 40 ? `${actName.slice(0, 37)}...` : actName;
  const acronym = actName
    .replace(/[,\d\s]+$/, "")
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w) && !["of", "the", "and", "or", "Act"].includes(w))
    .map((w) => w[0].toUpperCase())
    .join("");
  return acronym + year || actName.slice(0, 8);
}

