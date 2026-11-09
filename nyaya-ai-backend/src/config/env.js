import dotenv from "dotenv";

dotenv.config();

const config = Object.freeze({
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "5000", 10),
  mongodb: {
    uri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/nyaya_ai",
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
  },
});

export default config;
