import { getGeminiClient, GEMINI_DEFAULT_MODEL } from "../../config/gemini.js";
import { AppError } from "../../utils/apiResponse.js";

/**
 * Service to handle Google Gemini AI interactions.
 */
export class GeminiService {
  /**
   * Generates a simple text response given a prompt.
   * @param {string} prompt
   * @param {string} [model]
   * @returns {Promise<{ text: string, model: string }>}
   */
  static async generateLegalTestResponse(prompt, model = GEMINI_DEFAULT_MODEL) {
    try {
      const client = getGeminiClient();

      const response = await client.models.generateContent({
        model,
        contents: prompt,
      });

      return {
        text: response.text,
        model,
      };
    } catch (error) {
      console.error("[GeminiService] API generation failed:", error.message);
      throw new AppError(`Gemini service error: ${error.message}`, 502);
    }
  }
}
