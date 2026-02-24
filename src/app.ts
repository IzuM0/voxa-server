/**
 * Express app factory. Used by index.ts and by tests (supertest).
 */

import express, { Response } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import dotenv from "dotenv";
import { getPool } from "./db/index";
import { optionalAuth, requireAuth, AuthenticatedRequest } from "./middleware/auth";
import { ttsRateLimiter, apiRateLimiter } from "./middleware/rateLimit";
import meetingsRouter from "./routes/meetings";
import ttsRouter from "./routes/tts";
import settingsRouter from "./routes/settings";
import analyticsRouter from "./routes/analytics";
import userRouter from "./routes/user";
import {
  MAX_TTS_CHARS,
  TtsServiceError,
  logTtsMessagePending,
  updateTtsMessageFailed,
  updateTtsMessageSent,
  generateTtsWav,
} from "./services/tts";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.openai.com", "https://*.supabase.co"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Normalize: no trailing slash so CORS matches browser origin exactly
const rawFrontendUrl = process.env.VITE_FRONTEND_URL || process.env.FRONTEND_URL || "http://localhost:5173";
const frontendUrl = rawFrontendUrl.replace(/\/+$/, "") || rawFrontendUrl;
app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use("/api", apiRateLimiter);
app.use(optionalAuth);

app.post("/api/tts/stream", ttsRateLimiter, requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { text, voice, language, speed, pitch, meeting_id } = req.body ?? {};

  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Text is required." });
  }

  if (text.length > MAX_TTS_CHARS) {
    return res.status(400).json({
      error: `Text is too long. Maximum allowed length is ${MAX_TTS_CHARS} characters.`,
    });
  }

  let dbMessageId: string | null = null;
  if (req.userId) {
    try {
      dbMessageId = await logTtsMessagePending(req.userId, {
        text,
        voice,
        language,
        speed,
        pitch,
        meeting_id,
      });
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error("Failed to log TTS message to database:", msg);
    }
  }

  try {
    const { wavBuffer, audioDurationSeconds } = await generateTtsWav({
      text,
      voice,
      language,
      speed,
      pitch,
    });

    res.status(200);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", String(wavBuffer.length));
    res.send(wavBuffer);

    if (dbMessageId && req.userId) {
      await updateTtsMessageSent(dbMessageId, req.userId, audioDurationSeconds);
    }
  } catch (err) {
    if (err instanceof TtsServiceError) {
      if (dbMessageId && req.userId) {
        await updateTtsMessageFailed(dbMessageId, req.userId, err.details ?? err.message);
      }
      const body: Record<string, unknown> = { error: err.message, statusCode: err.statusCode };
      if (err.details !== undefined) body.details = err.details;
      if (!res.headersSent) return res.status(err.statusCode).json(body);
      if (!res.writableEnded) res.end();
      return;
    }

    if (dbMessageId && req.userId) {
      await updateTtsMessageFailed(
        dbMessageId,
        req.userId,
        err instanceof Error ? err.message : "Unexpected error"
      );
    }
    if (!res.headersSent) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Unexpected error while generating TTS audio.",
      });
    }
    if (!res.writableEnded) res.end();
  }
});

app.get("/api/health", async (_req, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(200).json({ status: "ok", database: "not-configured" });
    }
    await pool.query("SELECT 1");
    return res.status(200).json({ status: "ok", database: "connected" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ status: "error", database: "error", message });
  }
});

app.use("/api/meetings", meetingsRouter);
app.use("/api/tts", ttsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/user", userRouter);

export { app };
