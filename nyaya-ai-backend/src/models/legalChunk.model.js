import mongoose from "mongoose";

// ─── Legal Chunk Schema ───────────────────────────────────────────────────────
// Each chunk represents a semantically coherent segment of a legal document.
// The `embedding` field holds the Gemini text-embedding-004 vector (768 dims).
// For production: create an Atlas Vector Search index on `embedding`.
// For local dev: cosine similarity is computed in-process as a fallback.

const LegalChunkSchema = new mongoose.Schema(
  {
    // ── Source metadata ────────────────────────────────────────────────────
    /** Human-readable title of the source document */
    documentTitle: { type: String, required: true, index: true },

    /** Formal name of the act, rule, or notification */
    actName: { type: String, required: true, index: true },

    /** Section/clause/article identifier extracted from the text, e.g. "Section 35" */
    sectionNumber: { type: String, default: null },

    /** Sub-section or clause, e.g. "35(1)(a)" */
    subSection: { type: String, default: null },

    /** Chapter heading if applicable */
    chapterTitle: { type: String, default: null },

    /** Jurisdiction — almost always "India" for this corpus */
    jurisdiction: { type: String, default: "India" },

    /**
     * Type of source — drives how answers cite and caveat this chunk.
     * "legislation"  = Acts of Parliament / State Legislatures
     * "rules"        = Statutory Rules under an Act
     * "notification" = Official Gazette notifications
     * "guidance"     = Non-binding guidance / FAQs / helpline docs
     * "circular"     = Official circulars / orders
     */
    sourceType: {
      type: String,
      enum: ["legislation", "rules", "notification", "guidance", "circular"],
      required: true,
    },

    /** Official URL of the original document */
    sourceUrl: { type: String, required: true },

    /** ISO 8601 date the document was published / came into effect */
    publicationDate: { type: String, default: null },

    /** ISO 8601 date this chunk was last verified against the source */
    lastVerifiedDate: { type: String, required: true },

    // ── Content ────────────────────────────────────────────────────────────
    /** Verbatim text of this chunk — never modified from the source */
    text: { type: String, required: true },

    /** Character offset of this chunk within the full document */
    charOffset: { type: Number, default: 0 },

    /** Sequential index of this chunk within its document */
    chunkIndex: { type: Number, required: true },

    /** Total number of chunks in the parent document */
    totalChunks: { type: Number, required: true },

    // ── Vector embedding ───────────────────────────────────────────────────
    /**
     * Gemini text-embedding-004 vector (768 dimensions).
     * Production: define an Atlas Vector Search index on this field.
     * Dev fallback: in-process cosine similarity search.
     */
    embedding: { type: [Number], default: undefined, select: false },

    // ── Ingestion audit ────────────────────────────────────────────────────
    /** SHA-256 hash of `text` to prevent duplicate ingestion */
    contentHash: { type: String, required: true, unique: true },

    /** Model used to generate the embedding */
    embeddingModel: { type: String, default: "gemini-embedding-001" },

    /** Whether this chunk is active (soft-delete for superseded versions) */
    isActive: { type: Boolean, default: true, index: true },

    /** Free-form tags for filtering (e.g. ["consumer", "refund", "deficiency"]) */
    tags: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: "legal_chunks",
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

// Full-text index for keyword search (works on local MongoDB)
LegalChunkSchema.index(
  { text: "text", actName: "text", documentTitle: "text" },
  { name: "legal_text_search", weights: { text: 10, actName: 5, documentTitle: 3 } }
);

LegalChunkSchema.index({ actName: 1, sectionNumber: 1 });
LegalChunkSchema.index({ sourceType: 1, isActive: 1 });
LegalChunkSchema.index({ tags: 1 });

/*
  ── Atlas Vector Search index (create once in Atlas UI / CLI) ────────────────
  Name: "legal_vector_index"
  Collection: legal_chunks
  Definition:
  {
    "fields": [{
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    }]
  }
*/

export const LegalChunk = mongoose.model("LegalChunk", LegalChunkSchema);

