import { z } from "zod";

// ─── Shared primitives ────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

const sourceType = z.enum([
  "legislation",
  "rules",
  "notification",
  "guidance",
  "circular",
]);

// ─── POST /api/legal/ingest ───────────────────────────────────────────────────

/**
 * Document-level metadata supplied with every ingestion request.
 * The actual document content arrives either as a multipart file upload
 * (PDF) or as a `text` field in the JSON body.
 */
export const ingestDocumentSchema = z.object({
  documentTitle: z
    .string()
    .min(5, "Document title must be at least 5 characters")
    .max(300),

  actName: z
    .string()
    .min(3, "Act name is required")
    .max(300),

  sourceType,

  sourceUrl: z
    .string()
    .url("sourceUrl must be a valid URL")
    .refine(
      (url) => url.startsWith("https://"),
      "sourceUrl must use HTTPS to ensure source authenticity"
    ),

  jurisdiction: z.string().default("India"),

  publicationDate: isoDate.nullable().optional().default(null),

  lastVerifiedDate: isoDate,

  tags: z.array(z.string().min(1)).max(20).optional().default([]),

  /**
   * Raw document text — provide this when uploading plain text instead of a PDF.
   * Mutually exclusive with multipart PDF upload.
   */
  text: z.string().min(100, "Text must be at least 100 characters").optional(),
});

// ─── POST /api/legal/search ───────────────────────────────────────────────────

export const searchSchema = z.object({
  query: z
    .string()
    .min(3, "Query must be at least 3 characters")
    .max(2000, "Query must not exceed 2000 characters"),

  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(8),

  filters: z
    .object({
      sourceType: sourceType.optional(),
      actName: z.string().optional(),
      jurisdiction: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional()
    .default({}),

  mode: z
    .enum(["hybrid", "semantic", "keyword"])
    .optional()
    .default("hybrid"),
});

// ─── POST /api/legal/analyze ──────────────────────────────────────────────────

export const analyzeSchema = z.object({
  query: z
    .string()
    .min(3, "Query must be at least 3 characters")
    .max(3000, "Query must not exceed 3000 characters"),

  /**
   * Optional extracted case context from the case extraction engine.
   * When provided, it is used to narrow the retrieval and enrich the prompt.
   */
  caseContext: z
    .object({
      category: z.string().nullable().optional(),
      subCategory: z.string().nullable().optional(),
      parties: z.array(z.string()).optional().default([]),
      financialDetails: z
        .object({
          amount: z.number().nullable().optional(),
          currency: z.string().optional().default("INR"),
        })
        .optional(),
      urgency: z
        .enum(["low", "medium", "high", "critical"])
        .optional()
        .default("low"),
    })
    .optional()
    .default({}),

  topK: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .default(8),
});

