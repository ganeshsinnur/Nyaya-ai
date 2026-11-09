import { z } from "zod";

export const geminiTestSchema = z.object({
  prompt: z
    .string({
      invalid_type_error: "Prompt must be a string",
    })
    .trim()
    .min(3, "Prompt must be at least 3 characters long")
    .max(500, "Prompt must not exceed 500 characters")
    .optional()
    .default("Explain what consumer court is in India in one brief sentence."),
});
