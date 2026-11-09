import { getGeminiClient, GEMINI_DEFAULT_MODEL } from "../../config/gemini.js";
import { RetrievalService } from "./retrieval.service.js";
import { CitationValidator } from "./citationValidator.service.js";
import { AppError } from "../../utils/apiResponse.js";

// ─── Gemini response schema for structured legal analysis ─────────────────────
const ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Plain-language explanation of the legal situation (2-4 sentences)",
    },
    legalProvisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          citationKey: { type: "string" },
          sectionText: { type: "string" },
          relevance: { type: "string" },
        },
        required: ["citationKey", "sectionText", "relevance"],
      },
    },
    possibleOptions: {
      type: "array",
      items: { type: "string" },
    },
    missingInformation: {
      type: "array",
      items: { type: "string" },
    },
    uncertaintyWarnings: {
      type: "array",
      items: { type: "string" },
    },
    recommendedNextSteps: {
      type: "array",
      items: { type: "string" },
    },
    confidenceLevel: {
      type: "string",
      enum: ["high", "medium", "low", "insufficient"],
    },
    abstain: {
      type: "boolean",
      description: "Set true if retrieved sources are insufficient to answer safely",
    },
    abstainReason: {
      type: "string",
      nullable: true,
    },
  },
  required: [
    "summary",
    "legalProvisions",
    "possibleOptions",
    "missingInformation",
    "uncertaintyWarnings",
    "recommendedNextSteps",
    "confidenceLevel",
    "abstain",
  ],
};

// ─── System instruction ───────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `
You are NyayaAI's legal analysis engine — a grounded legal assistant for Indian law.

ABSOLUTE RULES:
1. ONLY use information from the RETRIEVED LEGAL SOURCES provided below.
2. NEVER cite a section or provision that does not appear in the retrieved sources.
3. NEVER fabricate case law, judgements, or legal interpretations not in the sources.
4. If the retrieved sources are insufficient to answer, set abstain=true.
5. Distinguish between primary legislation (Acts), rules (secondary legislation),
   notifications, and guidance. Legislation has highest authority.
6. Always note amendments and effective dates if mentioned in sources.
7. Preserve verbatim text from sources in legalProvisions.sectionText.
8. For every legalProvision you cite, the citationKey MUST exactly match one
   provided in the retrieved sources list.
9. Never recommend illegal actions.
10. This is legal information, not legal advice — always recommend consulting an advocate.

CITATION FORMAT: Use exactly the citationKey provided for each retrieved chunk.
`.trim();

export class LegalAnalysisService {
  /**
   * Full RAG analysis pipeline:
   *   1. Retrieve relevant legal chunks (hybrid)
   *   2. Build grounded prompt
   *   3. Call Gemini with structured output
   *   4. Validate every citation against retrieved chunks
   *   5. Return fully-structured, verified legal answer
   *
   * @param {string} query     User's legal question
   * @param {object} [caseContext]  Optional extracted case fields to narrow retrieval
   * @param {object} [options]
   * @param {number} [options.topK=8]
   * @param {string} [options.model]
   * @returns {Promise<LegalAnalysisResult>}
   */
  static async analyze(query, caseContext = {}, options = {}) {
    const { topK = 8, model = GEMINI_DEFAULT_MODEL, includeRawModelOutput = false } = options;

    // ── Step 1: Retrieval ──────────────────────────────────────────────────
    let retrievedContext;
    try {
      retrievedContext = await RetrievalService.retrieve(query, { topK });
    } catch (err) {
      throw new AppError(`Retrieval failed: ${err.message}`, 502);
    }

    const { chunks } = retrievedContext;

    if (chunks.length === 0) {
      return _abstainResponse(
        query,
        "No relevant legal sources were found in the knowledge base for this query. " +
          "The knowledge base may need to be populated with relevant legal documents first.",
        []
      );
    }

    // ── Step 2: Build grounded prompt ──────────────────────────────────────
    const sourceContext = _buildSourceContext(chunks);
    const caseContextStr = _buildCaseContext(caseContext);

    const prompt = `
${caseContextStr ? `USER'S LEGAL SITUATION:\n${caseContextStr}\n\n` : ""}
USER'S QUESTION: ${query}

RETRIEVED LEGAL SOURCES (use ONLY these for your answer):
${sourceContext}

Analyse the user's legal situation using ONLY the above sources.
`.trim();

    // ── Step 3: Gemini structured generation ──────────────────────────────
    let rawAnalysis;
    let rawModelText;
    try {
      const client = getGeminiClient();
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_RESPONSE_SCHEMA,
          temperature: 0.1, // low but slightly above 0 for natural language output
        },
      });
      rawModelText = response.text;
      rawAnalysis = JSON.parse(response.text);
    } catch (err) {
      throw new AppError(`Gemini analysis failed: ${err.message}`, 502);
    }

    // Handle model-initiated abstain
    if (rawAnalysis.abstain) {
      const abstained = _abstainResponse(
        query,
        rawAnalysis.abstainReason ??
          "Insufficient legal sources to answer this query safely.",
        chunks
      );
      if (includeRawModelOutput) {
        abstained.rawModelText = rawModelText;
        abstained.rawModelOutput = rawAnalysis;
      }
      return abstained;
    }

    // ── Step 4: Citation validation ────────────────────────────────────────
    const claimedKeys = (rawAnalysis.legalProvisions ?? []).map(
      (p) => p.citationKey
    );
    const validationResult = CitationValidator.validate(claimedKeys, chunks);

    // Remove any legalProvision whose citationKey failed validation
    const verifiedKeys = new Set(
      validationResult.verified.map((v) => v.citation)
    );
    const verifiedProvisions = (rawAnalysis.legalProvisions ?? []).filter((p) =>
      verifiedKeys.has(p.citationKey)
    );

    // ── Step 5: Assemble final answer ──────────────────────────────────────
    const citations = validationResult.verified.map((v) => ({
      citationKey: v.citation,
      actName: v.chunk.actName,
      sectionNumber: v.chunk.sectionNumber,
      subSection: v.chunk.subSection,
      documentTitle: v.chunk.documentTitle,
      sourceType: v.chunk.sourceType,
      sourceUrl: v.chunk.sourceUrl,
      publicationDate: v.chunk.publicationDate,
      lastVerifiedDate: v.chunk.lastVerifiedDate,
      jurisdiction: v.chunk.jurisdiction,
    }));

    const allWarnings = [
      ...rawAnalysis.uncertaintyWarnings,
      ...validationResult.warnings,
      !validationResult.isFullyVerified &&
        `Note: ${validationResult.unverified.length} citation(s) could not be verified and were removed: ${validationResult.unverified.join(", ")}`,
    ].filter(Boolean);

    return {
      query,
      summary: rawAnalysis.summary,
      legalProvisions: verifiedProvisions,
      citations,
      possibleOptions: rawAnalysis.possibleOptions ?? [],
      missingInformation: rawAnalysis.missingInformation ?? [],
      uncertaintyWarnings: allWarnings,
      recommendedNextSteps: rawAnalysis.recommendedNextSteps ?? [],
      confidenceLevel: rawAnalysis.confidenceLevel,
      abstain: false,
      retrievedChunks: chunks,
      citationValidation: {
        verified: validationResult.verified.length,
        unverified: validationResult.unverified,
        hasLegislationCited: validationResult.hasLegislationCited,
      },
      disclaimer:
        "This is legal information generated from retrieved official sources, " +
        "not legal advice. Always consult a qualified advocate for your specific situation.",
      ...(includeRawModelOutput && {
        rawModelText,
        rawModelOutput: rawAnalysis,
      }),
    };
  }
}

/**
 * @typedef {object} LegalAnalysisResult
 * @property {string} query
 * @property {string} summary
 * @property {object[]} legalProvisions
 * @property {object[]} citations
 * @property {string[]} possibleOptions
 * @property {string[]} missingInformation
 * @property {string[]} uncertaintyWarnings
 * @property {string[]} recommendedNextSteps
 * @property {string} confidenceLevel
 * @property {boolean} abstain
 * @property {object[]} retrievedChunks
 * @property {object} citationValidation
 * @property {string} disclaimer
 */

// ─── Prompt builders ──────────────────────────────────────────────────────────

function _buildSourceContext(chunks) {
  return chunks
    .map((c, i) => {
      const section = c.subSection ?? c.sectionNumber ?? "—";
      const lines = [
        `[SOURCE ${i + 1}] citationKey="${c.citationKey}"`,
        `  Act: ${c.actName}`,
        `  Section: ${section}`,
        `  Type: ${c.sourceType}`,
        `  URL: ${c.sourceUrl}`,
        `  Last verified: ${c.lastVerifiedDate}`,
        `  Text:`,
        `  ${c.text.slice(0, 1500)}${c.text.length > 1500 ? "…" : ""}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

function _buildCaseContext(caseContext) {
  if (!caseContext || Object.keys(caseContext).length === 0) return null;
  const lines = [];
  if (caseContext.category) lines.push(`Category: ${caseContext.category}`);
  if (caseContext.subCategory) lines.push(`Sub-category: ${caseContext.subCategory}`);
  if (caseContext.parties?.length)
    lines.push(`Parties: ${caseContext.parties.join(", ")}`);
  if (caseContext.financialDetails?.amount)
    lines.push(
      `Amount in dispute: ${caseContext.financialDetails.currency ?? "INR"} ${caseContext.financialDetails.amount}`
    );
  if (caseContext.urgency) lines.push(`Urgency: ${caseContext.urgency}`);
  return lines.join("\n");
}

function _abstainResponse(query, reason, retrievedChunks) {
  return {
    query,
    summary:
      "NyayaAI cannot provide a legally grounded answer to this query at this time.",
    legalProvisions: [],
    citations: [],
    possibleOptions: [],
    missingInformation: [],
    uncertaintyWarnings: [reason],
    recommendedNextSteps: [
      "Consult a qualified advocate or legal aid society.",
      "Contact the National Consumer Helpline at 1800-11-4000.",
      "Visit the nearest District Consumer Disputes Redressal Commission.",
    ],
    confidenceLevel: "insufficient",
    abstain: true,
    abstainReason: reason,
    retrievedChunks,
    citationValidation: {
      verified: 0,
      unverified: [],
      hasLegislationCited: false,
    },
    disclaimer:
      "This is legal information, not legal advice. Consult a qualified advocate.",
  };
}

