import { isDbConnected } from "../config/db.js";
import { GeminiService } from "../services/ai/gemini.service.js";
import { sendResponse } from "../utils/apiResponse.js";
import config from "../config/env.js";

/**
 * Health check controller reporting server, uptime, and database status.
 */
export const getHealth = async (req, res, next) => {
  try {
    const dbStatus = isDbConnected() ? "connected" : "disconnected";

    return sendResponse(res, 200, {
      success: true,
      message: "NyayaAI backend service is operational",
      data: {
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        environment: config.env,
        services: {
          database: dbStatus,
          geminiConfigured: Boolean(config.gemini.apiKey),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Gemini connectivity test endpoint.
 */
export const testGemini = async (req, res, next) => {
  try {
    const { prompt } = req.body;

    const result = await GeminiService.generateLegalTestResponse(prompt);

    return sendResponse(res, 200, {
      success: true,
      message: "Gemini AI connection successful",
      data: {
        prompt,
        response: result.text,
        model: result.model,
      },
    });
  } catch (error) {
    next(error);
  }
};
