import mongoose from "mongoose";
import config from "./env.js";

/**
 * Connect to MongoDB with reconnect and error event listeners.
 */
export const connectDatabase = async () => {
  try {
    const conn = await mongoose.connect(config.mongodb.uri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`[Database] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);

    mongoose.connection.on("error", (err) => {
      console.error("[Database] Runtime connection error:", err.message);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("[Database] MongoDB disconnected. Attempting to reconnect...");
    });

    return conn;
  } catch (error) {
    console.error("[Database] Initial connection failed:", error.message);
    // Don't crash immediately in dev to allow health checks to surface the status, but log clearly
    if (config.env === "production") {
      process.exit(1);
    }
  }
};

export const isDbConnected = () => mongoose.connection.readyState === 1;
