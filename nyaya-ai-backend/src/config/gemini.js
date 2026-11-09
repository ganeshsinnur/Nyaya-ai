import { GoogleGenAI } from "@google/genai";
import config from "./env.js";

let geminiClientInstance = null;

const RETRIES = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (e) =>
  [429, 500, 503, 504].includes(e?.status ?? e?.code) ||
  /"code":(429|500|503|504)|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(e?.message ?? "");

/** Retries transient Gemini failures (503 overloaded, 429 rate limit) with backoff. */
const withRetry = (fn) => async (...args) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(...args);
    } catch (err) {
      if (!isTransient(err) || attempt >= RETRIES) throw err;
      const hinted = /retry in ([\d.]+)s/i.exec(err.message ?? "");
      const wait = Math.min(hinted ? Number(hinted[1]) * 1000 + 1000 : 2000 * 2 ** attempt, 60000) + Math.random() * 500;
      console.warn(`[Gemini] transient error, retry ${attempt + 1}/${RETRIES} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
};

/**
 * Initializes and returns the GoogleGenAI client singleton.
 */
export const getGeminiClient = () => {
  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured.");
  }

  if (!geminiClientInstance) {
    geminiClientInstance = new GoogleGenAI({
      apiKey: config.gemini.apiKey,
      httpOptions: { timeout: 35_000 }, // fail fast instead of hanging; withRetry re-tries
    });
    const models = geminiClientInstance.models;
    models.generateContent = withRetry(models.generateContent.bind(models));
  }

  return geminiClientInstance;
};

export const GEMINI_DEFAULT_MODEL = config.gemini.model;
