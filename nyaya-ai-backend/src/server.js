import app from "./app.js";
import config from "./config/env.js";
import { connectDatabase } from "./config/db.js";

const startServer = async () => {
  // Connect to MongoDB
  await connectDatabase();

  const server = app.listen(config.port, () => {
    console.log(`[Server] NyayaAI backend running on port ${config.port} (${config.env})`);
    console.log(`[Server] Health check: http://localhost:${config.port}/api/v1/health`);
  });

  // Graceful shutdown
  const handleShutdown = (signal) => {
    console.log(`[Server] ${signal} signal received: closing HTTP server`);
    server.close(() => {
      console.log("[Server] HTTP server closed");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
};

startServer().catch((err) => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});
