import { z } from "zod";

// ─── POST /api/documents/generate ─────────────────────────────────────────────

export const generateDocumentSchema = z.object({
  documentType: z.enum([
    "consumer_complaint",
    "refund_request",
    "legal_notice",
    "legal_notice_reply",
    "grievance_application",
  ]),

  /**
   * Link to an existing extracted case.
   * Mutually exclusive with `caseData` — if both are provided, `caseId` wins.
   */
  caseId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, "caseId must be a valid MongoDB ObjectId")
    .optional(),

  /**
   * Inline case data (alternative to linking via caseId).
   */
  caseData: z
    .object({
      category: z.string().nullable().optional(),
      subCategory: z.string().nullable().optional(),
      jurisdiction: z
        .object({
          state: z.string().nullable().optional(),
          city: z.string().nullable().optional(),
        })
        .optional(),
      parties: z.array(z.string()).optional().default([]),
      events: z
        .array(
          z.object({
            date: z.string().nullable().optional(),
            description: z.string(),
            peopleInvolved: z.array(z.string()).optional().default([]),
          })
        )
        .optional()
        .default([]),
      financialDetails: z
        .object({
          amount: z.number().nullable().optional(),
          currency: z.string().optional().default("INR"),
        })
        .optional(),
      evidence: z.array(z.string()).optional().default([]),
      userClaims: z.array(z.string()).optional().default([]),
      urgency: z
        .enum(["low", "medium", "high", "critical"])
        .optional()
        .default("low"),
    })
    .optional(),

  /** Free-text user instructions to guide the document style or content. */
  additionalInstructions: z
    .string()
    .max(2000, "Additional instructions must not exceed 2000 characters")
    .optional(),
});

// ─── PATCH /api/documents/:id/fill-placeholders ──────────────────────────────

export const fillPlaceholdersSchema = z.object({
  /**
   * Map of placeholder description → replacement value.
   * The keys must match exactly the placeholder strings returned in the
   * document's `placeholders` array.
   */
  fills: z
    .record(
      z.string().min(1, "Placeholder key cannot be empty"),
      z.string().min(1, "Replacement value cannot be empty")
    )
    .refine(
      (obj) => Object.keys(obj).length >= 1,
      "At least one placeholder fill is required"
    ),
});

// ─── Param validation helpers ─────────────────────────────────────────────────

export const documentIdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "id must be a valid MongoDB ObjectId"),
});

