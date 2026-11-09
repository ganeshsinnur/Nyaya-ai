import { LegalCase } from "../models/case.model.js";
import { AppError } from "../utils/apiResponse.js";

/**
 * Serialises a conversation array into a plain text string for storage.
 * @param {Array<{role: string, content: string}>} conversation
 * @returns {string}
 */
const serialiseConversation = (conversation) =>
  conversation.map((m) => `[${m.role.toUpperCase()}]: ${m.content}`).join("\n\n");

export class CaseService {
  /**
   * Creates a new LegalCase document from the extracted data.
   *
   * @param {Array<{role: string, content: string}>} conversation
   * @param {object} extracted  Zod-validated extraction result
   * @param {object} raw        Raw Gemini JSON (stored for audit)
   * @returns {Promise<import('mongoose').Document>}
   */
  static async createCase(conversation, extracted, raw) {
    const doc = await LegalCase.create({
      conversationText: serialiseConversation(conversation),
      ...extracted,
      rawGeminiResponse: raw,
      extractionVersion: 1,
    });
    return doc;
  }

  /**
   * Performs an incremental update: merges new extraction results onto an
   * existing case document rather than overwriting it wholesale.
   * Arrays are appended (deduped for primitive values), scalars are replaced
   * only when the new value is non-null.
   *
   * @param {string} caseId     MongoDB ObjectId string
   * @param {Array<{role: string, content: string}>} conversation
   * @param {object} extracted
   * @param {object} raw
   * @returns {Promise<import('mongoose').Document>}
   */
  static async updateCase(caseId, conversation, extracted, raw) {
    const existing = await LegalCase.findById(caseId);
    if (!existing) {
      throw new AppError(`Case with id ${caseId} not found`, 404);
    }

    // ── Scalar fields: only update when new value is non-null ────────────
    const scalarFields = [
      "category",
      "subCategory",
      "urgency",
      "caseCompleteness",
    ];
    for (const field of scalarFields) {
      if (extracted[field] !== null && extracted[field] !== undefined) {
        existing[field] = extracted[field];
      }
    }

    // ── Jurisdiction: merge sub-fields ───────────────────────────────────
    if (extracted.jurisdiction?.state) {
      existing.jurisdiction.state = extracted.jurisdiction.state;
    }
    if (extracted.jurisdiction?.city) {
      existing.jurisdiction.city = extracted.jurisdiction.city;
    }

    // ── Financial details ────────────────────────────────────────────────
    if (extracted.financialDetails?.amount !== null) {
      existing.financialDetails.amount = extracted.financialDetails.amount;
    }
    if (extracted.financialDetails?.currency) {
      existing.financialDetails.currency = extracted.financialDetails.currency;
    }

    // ── Array fields: append unique new entries ──────────────────────────
    const appendUnique = (existingArr, newArr) => {
      const set = new Set(existingArr.map(String));
      for (const item of newArr) {
        const key = String(item);
        if (!set.has(key)) {
          set.add(key);
          existingArr.push(item);
        }
      }
    };

    appendUnique(existing.parties, extracted.parties);
    appendUnique(existing.evidence, extracted.evidence);
    appendUnique(existing.userClaims, extracted.userClaims);
    appendUnique(existing.missingInformation, extracted.missingInformation);
    appendUnique(existing.assumptions, extracted.assumptions);
    appendUnique(existing.contradictions, extracted.contradictions);

    // Events are objects, so dedupe by description
    const existingDescriptions = new Set(existing.events.map((e) => e.description));
    for (const event of extracted.events) {
      if (!existingDescriptions.has(event.description)) {
        existing.events.push(event);
        existingDescriptions.add(event.description);
      }
    }

    // ── Audit fields ─────────────────────────────────────────────────────
    existing.conversationText = serialiseConversation(conversation);
    existing.rawGeminiResponse = raw;
    existing.extractionVersion += 1;

    await existing.save();
    return existing;
  }

  /**
   * Applies user-supplied field-level corrections to a case.
   * Stores originals in `userCorrections` for audit.
   *
   * @param {string} caseId
   * @param {Array<{field: string, value: unknown}>} corrections
   * @returns {Promise<import('mongoose').Document>}
   */
  static async correctCase(caseId, corrections) {
    const existing = await LegalCase.findById(caseId);
    if (!existing) {
      throw new AppError(`Case with id ${caseId} not found`, 404);
    }

    for (const { field, value } of corrections) {
      // Record what was there before
      const originalValue = CaseService._getNestedField(existing, field);
      existing.userCorrections.push({
        field,
        originalValue,
        correctedValue: value,
        correctedAt: new Date(),
      });

      // Apply the correction
      CaseService._setNestedField(existing, field, value);
    }

    await existing.save();
    return existing;
  }

  /**
   * Returns a single case by id.
   * @param {string} caseId
   */
  static async getCase(caseId) {
    const doc = await LegalCase.findById(caseId).lean();
    if (!doc) throw new AppError(`Case with id ${caseId} not found`, 404);
    return doc;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  static _getNestedField(obj, path) {
    return path.split(".").reduce((cur, key) => cur?.[key], obj);
  }

  static _setNestedField(obj, path, value) {
    const keys = path.split(".");
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] === undefined || cur[keys[i]] === null) {
        cur[keys[i]] = {};
      }
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
    // Mark nested path as modified for Mongoose
    obj.markModified(keys[0]);
  }
}

