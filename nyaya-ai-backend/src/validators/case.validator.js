import { z } from "zod";

// ─── Shared primitives ────────────────────────────────────────────────────────

/** Accepts a string in YYYY-MM-DD format or null/undefined. Rejects empty strings. */
const isoDateOrNull = z
  .string()
  .nullable()
  .optional()
  .refine(
    (val) => {
      if (val === null || val === undefined) return true;
      if (val === "") return false; // empty string is not a valid date
      return /^\d{4}-\d{2}-\d{2}$/.test(val);
    },
    { message: "Date must be in YYYY-MM-DD format or null" }
  )
  .transform((val) => val ?? null);

// ─── Extracted case schema (mirrors Gemini output + MongoDB model) ────────────

export const extractedCaseSchema = z.object({
  category: z.string().nullable().default(null),
  subCategory: z.string().nullable().default(null),
  jurisdiction: z
    .object({
      state: z.string().nullable().default(null),
      city: z.string().nullable().default(null),
    })
    .default({ state: null, city: null }),
  parties: z.array(z.string()).default([]),
  events: z
    .array(
      z.object({
        date: isoDateOrNull,
        description: z.string().min(1, "Event description cannot be empty"),
        peopleInvolved: z.array(z.string()).default([]),
      })
    )
    .default([]),
  financialDetails: z
    .object({
      amount: z.number().nullable().default(null),
      currency: z.string().default("INR"),
    })
    .default({ amount: null, currency: "INR" }),
  evidence: z.array(z.string()).default([]),
  userClaims: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  urgency: z.enum(["low", "medium", "high", "critical"]).default("low"),
  caseCompleteness: z.number().int().min(0).max(100).default(0),
});

// ─── Request body schemas ─────────────────────────────────────────────────────

/**
 * POST /api/cases/extract
 * Accepts a full conversation (array of messages) or a plain text blob.
 */
export const extractCaseSchema = z.object({
  conversation: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1, "Message content cannot be empty"),
      })
    )
    .min(1, "Conversation must contain at least one message"),

  /**
   * Optional: existing caseId to perform an incremental update rather than
   * creating a fresh case document.
   */
  caseId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, "caseId must be a valid MongoDB ObjectId")
    .optional(),
});

/**
 * PATCH /api/cases/:id/correct
 * Allows the user to supply field-level corrections.
 */
export const correctCaseSchema = z.object({
  corrections: z
    .array(
      z.object({
        field: z.string().min(1, "Field name is required"),
        value: z.unknown(), // accept any JSON value
      })
    )
    .min(1, "At least one correction is required"),
});
