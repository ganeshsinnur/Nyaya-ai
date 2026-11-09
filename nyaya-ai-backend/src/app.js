import express from "express";
import cors from "cors";
import apiRouter from "./routes/index.js";
import documentRoutes from "./routes/document.routes.js";
import evaluationRoutes from "./routes/evaluation.routes.js";
import { requestLogger } from "./middleware/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

const app = express();

// Standard middlewares
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Mount API routes
app.use("/api/v1", apiRouter);
// Keep the document endpoints available at the requested /api/documents path
// while the rest of the API remains versioned under /api/v1.
app.use("/api/documents", documentRoutes);
if (process.env.NYAYAI_EVALUATION_MODE === "true") {
  app.use("/api/v1/evaluation", evaluationRoutes);
}

// Root route convenience redirect / status
app.get("/", (req, res) => {
  res.json({
    name: "NyayaAI Backend API",
    version: "1.0.0",
    description: "AI-powered legal assistant for citizens in India",
    documentation: "/api/v1/health",
  });
});

// Centralized error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
