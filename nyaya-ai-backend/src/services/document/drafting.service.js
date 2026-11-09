import { getGeminiClient, GEMINI_DEFAULT_MODEL } from "../../config/gemini.js";
import { AppError } from "../../utils/apiResponse.js";

// ─── Document type display names ──────────────────────────────────────────────
export const DOCUMENT_TYPE_LABELS = {
  consumer_complaint: "Consumer Complaint",
  refund_request: "Refund Request Letter",
  legal_notice: "Legal Notice",
  legal_notice_reply: "Reply to Legal Notice",
  grievance_application: "Grievance Application",
};

// ─── Gemini structured response schema ────────────────────────────────────────
const DOCUMENT_GENERATION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    sections: {
      type: "object",
      properties: {
        header: { type: "string", description: "Forum/authority name and address header" },
        reference: { type: "string", description: "Reference/subject line" },
        date: { type: "string", description: "Date line" },
        from: { type: "string", description: "Complainant/sender details" },
        to: { type: "string", description: "Opposite party/recipient details" },
        salutation: { type: "string" },
        factStatement: {
          type: "string",
          description: "Statement of facts as provided by the user. Mark missing info with [PLACEHOLDER: description].",
        },
        legalGrounds: {
          type: "string",
          description: "Legal arguments citing specific retrieved provisions. Clearly separated from user facts.",
        },
        prayer: { type: "string", description: "Relief sought / request / demand" },
        closing: { type: "string", description: "Closing line and signature block" },
        annexures: { type: "string", description: "List of supporting documents/evidence" },
      },
      required: [
        "header", "reference", "date", "from", "to",
        "salutation", "factStatement", "legalGrounds",
        "prayer", "closing",
      ],
    },
    placeholders: {
      type: "array",
      items: { type: "string" },
      description: "List of all [PLACEHOLDER: ...] markers the user needs to fill",
    },
    citationKeysUsed: {
      type: "array",
      items: { type: "string" },
      description: "Citation keys from the retrieved sources that were referenced",
    },
  },
  required: ["title", "sections", "placeholders", "citationKeysUsed"],
};

// ─── System instruction ───────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `
You are NyayaAI's legal document drafting engine for India.

ABSOLUTE RULES:
1. NEVER invent names, dates, addresses, amounts, or any factual detail not
   explicitly present in the case information or provided by the user.
2. For every missing piece of information, insert a placeholder in this exact
   format: [PLACEHOLDER: description of what is needed].
   Examples: [PLACEHOLDER: Complainant's full address]
             [PLACEHOLDER: Date of purchase]
             [PLACEHOLDER: Order/Invoice number]
3. ONLY cite legal provisions that appear in the RETRIEVED LEGAL SOURCES.
   Use the exact citationKey provided for each source.
4. CLEARLY SEPARATE user-provided facts (in factStatement) from legal arguments
   (in legalGrounds). Never mix them.
5. Maintain a professional, formal, but understandable Indian legal writing style.
6. NEVER claim this document has been legally reviewed.
7. NEVER instruct the user to send notices, file complaints, or contact third
   parties — only draft the document.
8. Include the appropriate forum/authority in the header based on case jurisdiction
   and financial amounts (District/State/National Commission for consumer cases).
9. All monetary amounts must use the Indian format (e.g., Rs. 1,00,000).
10. For legal notices, include a reasonable response deadline (typically 15–30 days).

DOCUMENT TYPES:
- consumer_complaint: Formal complaint to Consumer Disputes Redressal Commission
- refund_request: Professional letter demanding refund from a business
- legal_notice: Formal legal notice before filing a case
- legal_notice_reply: Formal reply to a received legal notice
- grievance_application: Application to a grievance redressal authority

OUTPUT FORMAT: Valid JSON matching the given schema. Every section is a string.
`.trim();

// ─── Service ──────────────────────────────────────────────────────────────────

export class DocumentDraftingService {
  /**
   * Generates a structured legal document draft using Gemini.
   *
   * @param {object} params
   * @param {string} params.documentType  One of the 5 supported types
   * @param {object} params.caseData      Structured case info (from case extraction)
   * @param {import('../../services/rag/retrieval.service.js').FormattedChunk[]} params.retrievedChunks
   * @param {string} [params.additionalInstructions]  User's extra notes
   * @param {string} [params.model]
   * @returns {Promise<{ title: string, sections: object, content: string, placeholders: string[], citationKeysUsed: string[], raw: object }>}
   */
  static async generateDraft(params) {
    const {
      documentType,
      caseData,
      retrievedChunks = [],
      additionalInstructions = "",
      model = GEMINI_DEFAULT_MODEL,
    } = params;

    const typeLabel = DOCUMENT_TYPE_LABELS[documentType];
    if (!typeLabel) {
      throw new AppError(`Unsupported document type: ${documentType}`, 400);
    }

    // Build contextual prompt
    const prompt = _buildPrompt(documentType, typeLabel, caseData, retrievedChunks, additionalInstructions);

    const client = getGeminiClient();
    let raw;
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: DOCUMENT_GENERATION_SCHEMA,
          temperature: 0.15,
        },
      });
      raw = JSON.parse(response.text);
    } catch (err) {
      throw new AppError(`Document generation failed: ${err.message}`, 502);
    }

    // Validate presence of required sections
    if (!raw.sections || !raw.sections.factStatement) {
      throw new AppError("Gemini returned an incomplete document structure", 502);
    }
    const detectedPlaceholders = new Set(raw.placeholders ?? []);
    const missingInfo = Array.isArray(caseData?.missingInformation)
      ? caseData.missingInformation.filter((item) => typeof item === "string" && item.trim())
      : [];
    for (const item of missingInfo) {
      const marker = `[PLACEHOLDER: ${item.trim()}]`;
      if (!raw.sections.factStatement.includes(marker)) {
        raw.sections.factStatement += `\n\nInformation to complete: ${marker}`;
      }
      detectedPlaceholders.add(item.trim());
    }
    for (const value of Object.values(raw.sections)) {
      if (typeof value !== "string") continue;
      for (const match of value.matchAll(/\[PLACEHOLDER:\s*([^\]]+)\]/g)) {
        detectedPlaceholders.add(match[1].trim());
      }
    }

    // Assemble after enforcing placeholders so flat content and section data match.
    const content = _assembleContent(raw.sections, typeLabel, raw.title);

    return {
      title: raw.title || `${typeLabel} — Draft`,
      sections: raw.sections,
      content,
      placeholders: [...detectedPlaceholders],
      citationKeysUsed: raw.citationKeysUsed ?? [],
      raw,
    };
  }
}

// ─── Prompt construction ──────────────────────────────────────────────────────

function _buildPrompt(documentType, typeLabel, caseData, chunks, extra) {
  const caseBlock = _formatCaseData(caseData);
  const sourcesBlock = _formatSources(chunks);

  return `
Generate a ${typeLabel} document based on the case information and legal sources below.

DOCUMENT TYPE: ${documentType}
TYPE LABEL: ${typeLabel}

═══ CASE INFORMATION ═══
${caseBlock || "[No structured case data provided. Use placeholders for all missing facts.]"}

═══ RETRIEVED LEGAL SOURCES (cite ONLY these) ═══
${sourcesBlock || "[No legal sources retrieved. Do not cite any legal provisions.]"}

${extra ? `═══ ADDITIONAL USER INSTRUCTIONS ═══\n${extra}\n` : ""}
Generate the document now.
`.trim();
}

function _formatCaseData(data) {
  if (!data || Object.keys(data).length === 0) return null;
  const lines = [];
  if (data.category) lines.push(`Category: ${data.category}`);
  if (data.subCategory) lines.push(`Sub-category: ${data.subCategory}`);
  if (data.jurisdiction?.state) lines.push(`State: ${data.jurisdiction.state}`);
  if (data.jurisdiction?.city) lines.push(`City: ${data.jurisdiction.city}`);
  if (data.parties?.length) lines.push(`Parties: ${data.parties.join(", ")}`);
  if (data.events?.length) {
    lines.push("Events:");
    for (const e of data.events) {
      lines.push(`  - ${e.date ?? "[date unknown]"}: ${e.description}`);
    }
  }
  if (data.financialDetails?.amount != null) {
    lines.push(`Amount: ${data.financialDetails.currency ?? "INR"} ${data.financialDetails.amount}`);
  }
  if (data.evidence?.length) lines.push(`Evidence: ${data.evidence.join(", ")}`);
  if (data.userClaims?.length) {
    lines.push("User's statements:");
    for (const c of data.userClaims) lines.push(`  - "${c}"`);
  }
  if (data.missingInformation?.length) {
    lines.push("Information explicitly identified as missing (use placeholders; do not infer):");
    for (const item of data.missingInformation) lines.push(`  - ${item}`);
  }
  if (data.assumptions?.length) {
    lines.push("Unverified extraction assumptions (do not present as user-provided facts):");
    for (const item of data.assumptions) lines.push(`  - ${item}`);
  }
  if (data.urgency) lines.push(`Urgency: ${data.urgency}`);
  return lines.join("\n");
}

function _formatSources(chunks) {
  if (!chunks || chunks.length === 0) return null;
  return chunks
    .map((c, i) => {
      const section = c.subSection ?? c.sectionNumber ?? "—";
      return [
        `[SOURCE ${i + 1}] citationKey="${c.citationKey}"`,
        `  Act: ${c.actName}`,
        `  Section: ${section}`,
        `  Type: ${c.sourceType}`,
        `  URL: ${c.sourceUrl}`,
        `  Text: ${(c.text ?? "").slice(0, 1200)}${(c.text ?? "").length > 1200 ? "…" : ""}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

// ─── Flat content assembly ───────────────────────────────────────────────────

function _assembleContent(sections, typeLabel, title) {
  const parts = [];

  parts.push(title || typeLabel);
  parts.push("=".repeat(Math.min(title?.length ?? typeLabel.length, 60)));
  parts.push("");

  if (sections.header) parts.push(sections.header, "");
  if (sections.reference) parts.push(`Subject: ${sections.reference}`, "");
  if (sections.date) parts.push(sections.date, "");
  if (sections.from) parts.push("FROM:", sections.from, "");
  if (sections.to) parts.push("TO:", sections.to, "");
  if (sections.salutation) parts.push(sections.salutation, "");

  parts.push("STATEMENT OF FACTS:", "");
  parts.push(sections.factStatement ?? "[No facts provided]", "");

  parts.push("LEGAL GROUNDS:", "");
  parts.push(sections.legalGrounds ?? "[No legal provisions cited]", "");

  if (sections.prayer) {
    parts.push("RELIEF SOUGHT / PRAYER:", "");
    parts.push(sections.prayer, "");
  }

  if (sections.annexures) {
    parts.push("ANNEXURES:", "");
    parts.push(sections.annexures, "");
  }

  if (sections.closing) {
    parts.push("");
    parts.push(sections.closing);
  }

  return parts.join("\n");
}

