/**
 * TTS Messages API Routes
 * Handles TTS message logging and retrieval
 */

import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth, getUserId } from "../middleware/auth";
import { getPool, query, queryOne } from "../db";
import type { TTSMessage, CreateTTSMessageInput } from "../types/database";

const router = Router();

/**
 * GET /api/tts/messages
 * Get all TTS messages for the authenticated user
 */
router.get("/messages", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { meeting_id, status, limit = "100", offset = "0" } = req.query;

    let sql = `
      SELECT t.*, m.title as meeting_title
      FROM tts_messages t
      LEFT JOIN meetings m ON t.meeting_id = m.id
      WHERE t.user_id = $1
    `;
    const params: any[] = [userId];

    if (meeting_id && typeof meeting_id === "string") {
      sql += " AND t.meeting_id = $2";
      params.push(meeting_id);
    }

    if (status && typeof status === "string") {
      const paramIndex = params.length + 1;
      sql += ` AND t.status = $${paramIndex}`;
      params.push(status);
    }

    sql += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

    const messages = await query(sql, params);

    res.json(messages);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching TTS messages:", msg);
    res.status(500).json({ error: err.message || "Failed to fetch TTS messages" });
  }
});

/**
 * GET /api/tts/messages/:id
 * Get a single TTS message by ID
 */
router.get("/messages/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const message = await queryOne<TTSMessage>(
      "SELECT * FROM tts_messages WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!message) {
      return res.status(404).json({ error: "TTS message not found" });
    }

    res.json(message);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching TTS message:", msg);
    res.status(500).json({ error: err.message || "Failed to fetch TTS message" });
  }
});

/**
 * POST /api/tts/messages
 * Log a TTS message (called after successful TTS generation)
 */
router.post("/messages", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const input: CreateTTSMessageInput = req.body;

    // Validation
    if (!input.text_input || typeof input.text_input !== "string") {
      return res.status(400).json({ error: "text_input is required" });
    }

    if (input.text_input.length > 500) {
      return res.status(400).json({ error: "Text input exceeds 500 character limit" });
    }

    // If meeting_id is provided, verify it belongs to user
    if (input.meeting_id) {
      const meeting = await queryOne(
        "SELECT id FROM meetings WHERE id = $1 AND user_id = $2",
        [input.meeting_id, userId]
      );

      if (!meeting) {
        return res.status(404).json({ error: "Meeting not found" });
      }
    }

    // Insert TTS message
    const result = await queryOne<TTSMessage>(
      `INSERT INTO tts_messages (
        user_id, meeting_id, text_input, text_length, voice_used, language, speed, pitch, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        userId,
        input.meeting_id || null,
        input.text_input,
        input.text_input.length,
        input.voice_used || "alloy",
        input.language || null,
        input.speed || 1.0,
        input.pitch || 1.0,
        "sent", // Status is 'sent' when logging after successful generation
      ]
    );

    res.status(201).json(result);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error creating TTS message:", msg);
    res.status(500).json({ error: err.message || "Failed to create TTS message" });
  }
});

/**
 * PUT /api/tts/messages/:id/status
 * Update TTS message status (e.g., mark as failed)
 */
router.put("/messages/:id/status", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const { status, error_message } = req.body;
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    if (!status || !["pending", "sent", "failed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Check if message exists and belongs to user
    const existing = await queryOne<TTSMessage>(
      "SELECT * FROM tts_messages WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!existing) {
      return res.status(404).json({ error: "TTS message not found" });
    }

    // Update status
    const updated = await queryOne<TTSMessage>(
      `UPDATE tts_messages 
       SET status = $1, error_message = $2
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [status, error_message || null, id, userId]
    );

    res.json(updated);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error updating TTS message status:", msg);
    res.status(500).json({ error: err.message || "Failed to update TTS message status" });
  }
});

/**
 * PATCH /api/tts/messages/:id/duration
 * Update audio duration for a TTS message (e.g. from client after playback ends if server could not compute it)
 */
router.patch("/messages/:id/duration", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const { audio_duration_seconds } = req.body;
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const duration = typeof audio_duration_seconds === "number" ? audio_duration_seconds : parseFloat(audio_duration_seconds);
    if (Number.isNaN(duration) || duration < 0 || duration > 86400) {
      return res.status(400).json({ error: "audio_duration_seconds must be a number between 0 and 86400" });
    }

    const existing = await queryOne<TTSMessage>(
      "SELECT id FROM tts_messages WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    if (!existing) {
      return res.status(404).json({ error: "TTS message not found" });
    }

    const updated = await queryOne<TTSMessage>(
      `UPDATE tts_messages SET audio_duration_seconds = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
      [Math.round(duration), id, userId]
    );

    res.json(updated);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error updating TTS message duration:", msg);
    res.status(500).json({ error: err.message || "Failed to update duration" });
  }
});

export default router;
