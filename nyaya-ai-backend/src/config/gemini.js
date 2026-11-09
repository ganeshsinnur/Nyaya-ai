import { GoogleGenAI } from "@google/genai";
import config from "./env.js";

let geminiClientInstance = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (e) =>
  [429, 500, 503, 504].includes(e?.status ?? e?.code) ||
  /"code":(429|500|503|504)|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(e?.message ?? "");

const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ||
  "gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite")
  .split(",").map((m) => m.trim()).filter(Boolean);
const PASSES = 2;

/**
 * On a transient Gemini failure (503 overloaded, 429, 504 timeout) switch to the next
 * model in the chain; if every model fails, wait briefly and sweep the chain again.
 */
const withFallback = (fn) => async (params, ...rest) => {
  const chain = [params.model, ...FALLBACK_MODELS.filter((m) => m !== params.model)];
  let lastErr;
  for (let pass = 0; pass < PASSES; pass++) {
    for (const model of chain) {
      try {
        const res = await fn({ ...params, model }, ...rest);
        if (model !== params.model) console.warn(`[Gemini] served by fallback model ${model}`);
        return res;
      } catch (err) {
        if (!isTransient(err)) throw err;
        lastErr = err;
        console.warn(`[Gemini] ${model} unavailable (${String(err.message).slice(0, 60).replace(/\n/g, " ")}); trying next`);
      }
    }
    if (pass < PASSES - 1) await sleep(3000);
  }
  throw lastErr;
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
      httpOptions: { timeout: 25_000 }, // fail fast; withFallback moves to the next model
    });
    const models = geminiClientInstance.models;
    models.generateContent = withFallback(models.generateContent.bind(models));
  }

  return geminiClientInstance;
};

export const GEMINI_DEFAULT_MODEL = config.gemini.model;
