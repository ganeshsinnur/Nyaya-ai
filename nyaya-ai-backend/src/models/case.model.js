import mongoose from "mongoose";

/**
 * Sub-schema for a jurisdiction (state + city).
 */
const JurisdictionSchema = new mongoose.Schema(
  {
    state: { type: String, default: null },
    city: { type: String, default: null },
  },
  { _id: false }
);

/**
 * Sub-schema for a timeline event.
 */
const EventSchema = new mongoose.Schema(
  {
    date: { type: String, default: null }, // ISO 8601 string or null
    description: { type: String, required: true },
    peopleInvolved: { type: [String], default: [] },
  },
  { _id: false }
);

/**
 * Sub-schema for financial details.
 */
const FinancialDetailsSchema = new mongoose.Schema(
  {
    amount: { type: Number, default: null },
    currency: { type: String, default: "INR" },
  },
  { _id: false }
);

/**
 * Sub-schema to track field-level corrections made by the user.
 * Preserves original Gemini-extracted value alongside the user override.
 */
const CorrectionSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    originalValue: { type: mongoose.Schema.Types.Mixed },
    correctedValue: { type: mongoose.Schema.Types.Mixed },
    correctedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * Main LegalCase schema.
 * Extracted fields are populated by Gemini; they should NEVER be treated as
 * independently verified facts — use `assumptions` and `userClaims` for that
 * distinction.
 */
const LegalCaseSchema = new mongoose.Schema(
  {
    // ── Identification ─────────────────────────────────────────────────────
    /** Raw conversation text that was last used for extraction. */
    conversationText: { type: String, required: true },

    // ── Extracted Fields (Gemini-generated) ────────────────────────────────
    category: { type: String, default: null },
    subCategory: { type: String, default: null },
    jurisdiction: { type: JurisdictionSchema, default: () => ({}) },
    parties: { type: [String], default: [] },
    events: { type: [EventSchema], default: [] },
    financialDetails: {
      type: FinancialDetailsSchema,
      default: () => ({ amount: null, currency: "INR" }),
    },
    evidence: { type: [String], default: [] },

    /**
     * Statements the user has made in first-person — preserved verbatim.
     * These are allegations, not verified facts.
     */
    userClaims: { type: [String], default: [] },

    /** Information the model identifies as missing for complete legal analysis. */
    missingInformation: { type: [String], default: [] },

    /**
     * Reasonable inferences the model had to make because the user did not
     * state something explicitly. NOT established facts.
     */
    assumptions: { type: [String], default: [] },

    /** Urgency classification inferred from the conversation. */
    urgency: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "low",
    },

    /**
     * 0–100 score representing how complete the extracted case file is.
     * Determined by Gemini based on how many required fields are populated.
     */
    caseCompleteness: { type: Number, min: 0, max: 100, default: 0 },

    // ── Contradictions ─────────────────────────────────────────────────────
    /** Any contradictions Gemini detected within the user's narrative. */
    contradictions: { type: [String], default: [] },

    // ── Audit ──────────────────────────────────────────────────────────────
    /** Field-level user corrections applied after initial extraction. */
    userCorrections: { type: [CorrectionSchema], default: [] },

    /** Number of times this case has been updated with new conversation text. */
    extractionVersion: { type: Number, default: 1 },

    /** Raw JSON response from Gemini — stored for audit / replay. */
    rawGeminiResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true, // createdAt, updatedAt
    collection: "legal_cases",
  }
);

// Index for quick lookup by urgency + completeness (useful for dashboards)
LegalCaseSchema.index({ urgency: 1, caseCompleteness: -1 });
LegalCaseSchema.index({ createdAt: -1 });

export const LegalCase = mongoose.model("LegalCase", LegalCaseSchema);

