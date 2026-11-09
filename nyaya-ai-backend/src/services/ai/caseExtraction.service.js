import { getGeminiClient, GEMINI_DEFAULT_MODEL } from "../../config/gemini.js";
import { AppError } from "../../utils/apiResponse.js";
import { extractedCaseSchema } from "../../validators/case.validator.js";

// ─── Gemini JSON Schema for structured output ─────────────────────────────────
// Defined once so it can be passed directly to the Gemini API.
const CASE_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", nullable: true },
    subCategory: { type: "string", nullable: true },
    jurisdiction: {
      type: "object",
      properties: {
        state: { type: "string", nullable: true },
        city: { type: "string", nullable: true },
      },
    },
    parties: { type: "array", items: { type: "string" } },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", nullable: true },
          description: { type: "string" },
          peopleInvolved: { type: "array", items: { type: "string" } },
        },
        required: ["description"],
      },
    },
    financialDetails: {
      type: "object",
      properties: {
        amount: { type: "number", nullable: true },
        currency: { type: "string" },
      },
    },
    evidence: { type: "array", items: { type: "string" } },
    userClaims: { type: "array", items: { type: "string" } },
    missingInformation: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
    urgency: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
    },
    caseCompleteness: { type: "integer" },
  },
  required: [
    "category",
    "subCategory",
    "jurisdiction",
    "parties",
    "events",
    "financialDetails",
    "evidence",
    "userClaims",
    "missingInformation",
    "assumptions",
    "contradictions",
    "urgency",
    "caseCompleteness",
  ],
};

// ─── System instruction ───────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `
You are NyayaAI's legal case extraction engine for India.
Your only job is to extract structured information from the conversation provided.

STRICT RULES:
1. Extract information ONLY from what is explicitly stated.
2. Never invent dates, names, amounts, or facts.
3. Use null for fields where information is unavailable.
4. Distinguish allegations (userClaims) from independently stated facts.
5. If the user's story contains internal contradictions, list them in the
   "contradictions" array — verbatim quotes where possible.
6. List every piece of information you would still need in "missingInformation".
7. If you must make a reasonable inference, record it in "assumptions" and
   NEVER treat it as an established fact.
8. Preserve original user statements in "userClaims" wherever possible.
9. Dates must be in YYYY-MM-DD format or null — never approximate.
10. caseCompleteness (0–100) reflects how much actionable legal information
    is present: 0 = almost nothing, 100 = fully detailed.
11. Output ONLY valid JSON matching the given schema.
`.trim();

// ─── Service ──────────────────────────────────────────────────────────────────

export class CaseExtractionService {
  /**
   * Extracts a structured legal case from a conversation array.
   *
   * @param {Array<{role: string, content: string}>} conversation
   * @param {string} [model]
   * @returns {Promise<{extracted: object, raw: object}>}
   */
  static async extractFromConversation(
    conversation,
    model = GEMINI_DEFAULT_MODEL
  ) {
    const client = getGeminiClient();

    // Build a readable transcript for the model
    const transcript = conversation
      .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join("\n\n");

    const prompt = `
Below is a conversation between a user and a legal assistant.
Extract the structured legal case information exactly as instructed.

---CONVERSATION START---
${transcript}
---CONVERSATION END---
`.trim();

    let raw;
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: CASE_EXTRACTION_RESPONSE_SCHEMA,
          temperature: 0, // deterministic extraction
        },
      });

      raw = JSON.parse(response.text);
    } catch (error) {
      console.error("[CaseExtractionService] Gemini call failed:", error.message);
      throw new AppError(`Gemini extraction failed: ${error.message}`, 502);
    }

    // ── Validate Gemini's output with Zod before trusting it ─────────────
    const validation = extractedCaseSchema.safeParse(raw);
    if (!validation.success) {
      const issues = validation.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      console.error("[CaseExtractionService] Zod validation failed:", issues);
      throw new AppError(
        "Gemini returned an invalid response structure",
        502,
        issues
      );
    }

    return { extracted: validation.data, raw };
  }
}

