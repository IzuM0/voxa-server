import path from "path";
import dotenv from "dotenv";
import { initializeDatabase } from "./db/index";
import { app } from "./app";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

if (process.env.NODE_ENV === "development") {
  if (process.env.DATABASE_URL) {
    console.log("📂 DATABASE_URL loaded");
  } else {
    console.warn("⚠️  DATABASE_URL not set — add it to server/.env to enable database");
  }
  if (process.env.OPENAI_API_KEY) {
    console.log("🔑 OPENAI_API_KEY loaded — TTS is enabled");
  } else {
    console.warn("⚠️  OPENAI_API_KEY not set — add it to server/.env to enable text-to-speech");
  }
  if (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) {
    console.log("🔐 SUPABASE_URL loaded — JWT verification enabled");
  } else {
    console.warn("⚠️  SUPABASE_URL not set — JWT verification will fail. Add VITE_SUPABASE_URL or SUPABASE_URL to server/.env");
  }
}

const ttsRateLimitMax = process.env.TTS_RATE_LIMIT_MAX
  ? parseInt(process.env.TTS_RATE_LIMIT_MAX, 10)
  : process.env.NODE_ENV === "production" ? 10 : 50;
const ttsRateLimitWindow = process.env.TTS_RATE_LIMIT_WINDOW_MS
  ? parseInt(process.env.TTS_RATE_LIMIT_WINDOW_MS, 10) / 60000
  : 15;
if (process.env.NODE_ENV === "development") {
  if (process.env.DISABLE_RATE_LIMIT === "true") {
    console.log("⚠️  Rate limiting DISABLED (development mode)");
  } else {
    console.log(`🚦 Rate limiting: ${ttsRateLimitMax} TTS requests per ${ttsRateLimitWindow} minutes`);
  }
}

let dbInitialized = false;
initializeDatabase()
  .then(() => {
    dbInitialized = true;
    if (process.env.NODE_ENV === "development") console.log("✅ Database ready");
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("⚠️  Database initialization failed:", message);
    if (process.env.NODE_ENV === "development") {
      console.log("⚠️  Server will continue without database features");
    }
  });

const port = process.env.PORT || 4000;
app.listen(port, () => {
  if (process.env.NODE_ENV === "development") {
    console.log(`Voxa backend listening on http://localhost:${port}`);
  }
});
