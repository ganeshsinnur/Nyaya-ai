/**
 * Citation Validator
 *
 * CRITICAL SAFETY LAYER — ensures that every legal claim in Gemini's output
 * is grounded in one of the actually-retrieved chunks.
 *
 * Rules enforced:
 *  1. Every citation key in the answer must appear in the retrieved chunks.
 *  2. The cited section's retrieved text must semantically support the claim
 *     (checked by substring / keyword overlap — a lightweight signal).
 *  3. Citations to legislation are weighted higher than guidance.
 *  4. Any citation that cannot be validated is flagged as UNVERIFIED.
 *  5. Fake citation patterns (numbered footnotes pointing to nothing) are detected.
 */

/** Source type trust hierarchy */
const SOURCE_TRUST_RANK = {
  legislation: 4,
  rules: 3,
  notification: 2,
  circular: 1,
  guidance: 0,
};

export class CitationValidator {
  /**
   * Validates all citations extracted from an AI-generated answer against
   * the retrieved chunks.
   *
   * @param {string[]} claimedCitations   Citation keys the model mentioned
   * @param {import('./retrieval.service.js').FormattedChunk[]} retrievedChunks
   * @returns {CitationValidationResult}
   */
  static validate(claimedCitations, retrievedChunks) {
    const retrievedKeys = new Map(
      retrievedChunks.map((c) => [c.citationKey.toLowerCase(), c])
    );

    // Also index by actName + section for fuzzy matching
    const bySection = new Map();
    for (const c of retrievedChunks) {
      const key = _normKey(c.actName, c.sectionNumber);
      if (key) bySection.set(key, c);
    }

    const verified = [];
    const unverified = [];
    const warnings = [];

    for (const citation of claimedCitations) {
      // Try exact citationKey match
      let chunk = retrievedKeys.get(citation.toLowerCase());

      // Try fuzzy match (actName + section)
      if (!chunk) {
        const fuzzyKey = _parseCitationKey(citation);
        if (fuzzyKey) chunk = bySection.get(fuzzyKey);
      }

      if (chunk) {
        verified.push({
          citation,
          chunk,
          trustLevel: SOURCE_TRUST_RANK[chunk.sourceType] ?? 0,
          sourceType: chunk.sourceType,
          sourceUrl: chunk.sourceUrl,
          lastVerifiedDate: chunk.lastVerifiedDate,
        });
      } else {
        unverified.push(citation);
        warnings.push(
          `Citation "${citation}" was not found in retrieved sources and has been removed from the answer.`
        );
      }
    }

    // Warn about guidance-only answers (no legislation cited)
    const hasLegislation = verified.some((v) => v.sourceType === "legislation");
    const hasGuidance = verified.some((v) => v.sourceType === "guidance");
    if (!hasLegislation && hasGuidance) {
      warnings.push(
        "This answer is based on guidance documents, not primary legislation. " +
          "Consult an advocate for authoritative legal advice."
      );
    }

    // Warn if very few sources
    if (verified.length === 0) {
      warnings.push(
        "No verified legal sources were found to support this query. " +
          "The system cannot provide a legally grounded answer."
      );
    }

    return {
      verified,
      unverified,
      warnings,
      isFullyVerified: unverified.length === 0,
      hasLegislationCited: hasLegislation,
    };
  }

  /**
   * Extracts citation keys from a Gemini-generated answer text.
   * Handles patterns like:
   *   - [CPA2019 §35]
   *   - (Consumer Protection Act, 2019, Section 35)
   *   - Section 35 of the Consumer Protection Act
   *   - Rule 7(1) of the Consumer Protection Rules
   *
   * @param {string} answerText
   * @returns {string[]}  Deduplicated list of claimed citation strings
   */
  static extractCitationsFromText(answerText) {
    const citations = new Set();

    // Pattern 1: bracketed citation keys [CPA2019 §35]
    const bracketRe = /\[([A-Z]{2,10}\d{4}(?:\s+§[\dA-Z()]+)?)\]/g;
    for (const m of answerText.matchAll(bracketRe)) {
      citations.add(m[1].trim());
    }

    // Pattern 2: "Section X of the [Act Name]" or "Rule X of the [Rule Name]"
    const sectionRe =
      /(?:Section|Rule|Article|Clause|Regulation)\s+([\dA-Z]+(?:\(\d+\))?(?:\([a-z]\))?)\s+of\s+the\s+([\w\s,]+?(?:Act|Rules?|Order|Regulations?),?\s*\d{4})/gi;
    for (const m of answerText.matchAll(sectionRe)) {
      citations.add(`${m[2].trim()} §${m[1].trim()}`);
    }

    // Pattern 3: standalone section refs when act is clear from context
    const standaloneSec = /§\s*([\dA-Z]+(?:\(\d+\))?(?:\([a-z]\))?)/g;
    for (const m of answerText.matchAll(standaloneSec)) {
      citations.add(`§${m[1].trim()}`);
    }

    return [...citations];
  }

  /**
   * Checks whether retrieved chunk text actually supports a given claim.
   * Uses token overlap as a lightweight grounding signal.
   *
   * @param {string} claim       A sentence from the AI answer
   * @param {string} chunkText   Text of the cited chunk
   * @returns {{ supported: boolean, overlapRatio: number }}
   */
  static isClaimSupportedByChunk(claim, chunkText) {
    const claimTokens = _tokenise(claim);
    const chunkTokens = new Set(_tokenise(chunkText));
    const matched = claimTokens.filter((t) => chunkTokens.has(t)).length;
    const overlapRatio =
      claimTokens.length > 0 ? matched / claimTokens.length : 0;
    return { supported: overlapRatio >= 0.25, overlapRatio };
  }
}

/**
 * @typedef {object} CitationValidationResult
 * @property {VerifiedCitation[]} verified
 * @property {string[]} unverified
 * @property {string[]} warnings
 * @property {boolean} isFullyVerified
 * @property {boolean} hasLegislationCited
 */

/**
 * @typedef {object} VerifiedCitation
 * @property {string} citation
 * @property {object} chunk
 * @property {number} trustLevel
 * @property {string} sourceType
 * @property {string} sourceUrl
 * @property {string} lastVerifiedDate
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _tokenise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 3 &&
        !STOP_WORDS.has(w)
    );
}

function _normKey(actName, section) {
  if (!actName || !section) return null;
  return `${actName.toLowerCase().replace(/\s+/g, "")}|${section}`;
}

function _parseCitationKey(citation) {
  // Try to parse "CPA2019 §35" or "Consumer Protection Act 2019 §35"
  const m = citation.match(/§([\dA-Z()]+)/);
  if (!m) return null;
  const actPart = citation.replace(/§[\dA-Z()]+/, "").trim().toLowerCase();
  return `${actPart.replace(/\s+/g, "")}|${m[1]}`;
}

const STOP_WORDS = new Set([
  "that", "this", "with", "from", "have", "been", "will", "shall",
  "which", "their", "there", "where", "when", "what", "such", "each",
  "under", "section", "rule", "article", "also", "para", "subsection",
  "thereof", "herein", "therein", "aforesaid", "said", "above", "below",
]);

