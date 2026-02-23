/**
 * Meetings API Routes
 * Handles CRUD operations for meetings
 */

import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth, getUserId } from "../middleware/auth";
import { getPool, query, queryOne, isDatabaseConnectionError } from "../db";
import type { Meeting, CreateMeetingInput, UpdateMeetingInput } from "../types/database";

const router = Router();

/**
 * GET /api/meetings
 * Get all meetings for the authenticated user
 */
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { status, limit = "50", offset = "0" } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offsetNum = Math.max(0, parseInt(offset as string, 10) || 0);

    let sql: string;
    const params: (string | number)[] = [userId];

    if (status && typeof status === "string") {
      sql = "SELECT * FROM meetings WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4";
      params.push(status, limitNum, offsetNum);
    } else {
      sql = "SELECT * FROM meetings WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3";
      params.push(limitNum, offsetNum);
    }

    const meetings = await query<Meeting>(sql, params);

    res.json(meetings);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching meetings:", msg);
    res.status(500).json({ error: err.message || "Failed to fetch meetings" });
  }
});

/**
 * GET /api/meetings/:id/tts-logs
 * Get TTS messages for a specific meeting (must be before GET /:id so path matches correctly)
 */
router.get("/:id/tts-logs", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const meeting = await queryOne<Meeting>(
      "SELECT * FROM meetings WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const messages = await query(
      "SELECT * FROM tts_messages WHERE meeting_id = $1 AND user_id = $2 ORDER BY created_at ASC",
      [id, userId]
    );

    res.json(messages);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching TTS logs:", msg);
    res.status(500).json({ error: err.message || "Failed to fetch TTS logs" });
  }
});

/**
 * GET /api/meetings/:id/analytics
 * Per-meeting analytics: message count, characters, audio seconds, most used voice, average message length.
 * All aggregation is done in SQL; scoped strictly to the authenticated user.
 */
router.get("/:id/analytics", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const meeting = await queryOne<Meeting>(
      "SELECT id FROM meetings WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const rows = await query<{
      total_messages: string;
      total_characters: string;
      total_audio_seconds: string;
      most_used_voice: string | null;
      average_message_length: string;
    }>(
      `SELECT
         COUNT(*)::text AS total_messages,
         COALESCE(SUM(text_length), 0)::text AS total_characters,
         COALESCE(SUM(audio_duration_seconds), 0)::text AS total_audio_seconds,
         (SELECT voice_used FROM tts_messages t2
          WHERE t2.meeting_id = $1 AND t2.user_id = $2
          GROUP BY voice_used ORDER BY COUNT(*) DESC LIMIT 1) AS most_used_voice,
         CASE WHEN COUNT(*) > 0 THEN (SUM(text_length)::float / COUNT(*))::text ELSE '0' END AS average_message_length
       FROM tts_messages
       WHERE meeting_id = $1 AND user_id = $2`,
      [id, userId]
    );

    const row = rows[0];
    const totalMessages = Math.max(0, parseInt(row?.total_messages ?? "0", 10));
    const totalCharacters = Math.max(0, parseInt(row?.total_characters ?? "0", 10));
    const totalAudioSeconds = Math.max(0, parseFloat(row?.total_audio_seconds ?? "0") || 0);
    const avgMessageLength = totalMessages > 0 ? totalCharacters / totalMessages : 0;

    res.json({
      meeting_id: id,
      total_messages: totalMessages,
      total_characters: totalCharacters,
      total_audio_seconds: totalAudioSeconds,
      most_used_voice: row?.most_used_voice ?? null,
      average_message_length: Math.round(avgMessageLength * 100) / 100,
    });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching meeting analytics:", msg);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({ error: "Database is temporarily unavailable." });
    }
    res.status(500).json({ error: err.message || "Failed to fetch meeting analytics" });
  }
});

/**
 * GET /api/meetings/:id
 * Get a single meeting by ID
 */
router.get("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const meeting = await queryOne<Meeting>(
      "SELECT * FROM meetings WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    res.json(meeting);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching meeting:", msg);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({
        error: "Database is temporarily unavailable. Check your network and try again.",
      });
    }
    res.status(500).json({ error: err.message || "Failed to fetch meeting" });
  }
});

/**
 * POST /api/meetings
 * Create a new meeting
 */
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const input: CreateMeetingInput = req.body;

    // Validation
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    if (!input.platform || typeof input.platform !== "string") {
      return res.status(400).json({ error: "Platform is required" });
    }

    const validPlatforms = ["google-meet", "zoom", "microsoft-teams", "other"];
    if (!validPlatforms.includes(input.platform)) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    // Insert meeting
    const result = await queryOne<Meeting>(
      `INSERT INTO meetings (user_id, title, platform, scheduled_at, meeting_url, language, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        title,
        input.platform,
        input.scheduled_at ? new Date(input.scheduled_at) : null,
        input.meeting_url || null,
        input.language || "en-US",
        "scheduled",
      ]
    );

    res.status(201).json(result);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error creating meeting:", msg);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({
        error: "Database is temporarily unavailable. Check your network and server/.env (DATABASE_URL, DB_CONNECTION_TIMEOUT_MS), then try again.",
      });
    }
    res.status(500).json({ error: err.message || "Failed to create meeting" });
  }
});

/**
 * PUT /api/meetings/:id
 * Update a meeting
 */
router.put("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    // Check if meeting exists and belongs to user
    const existing = await queryOne<Meeting>(
      "SELECT * FROM meetings WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!existing) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const input: UpdateMeetingInput = req.body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    const validPlatforms = ["google-meet", "zoom", "microsoft-teams", "other"];

    if (input.title !== undefined) {
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!title) {
        return res.status(400).json({ error: "Title cannot be empty" });
      }
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (input.platform !== undefined) {
      if (!validPlatforms.includes(input.platform)) {
        return res.status(400).json({ error: "Invalid platform" });
      }
      updates.push(`platform = $${paramIndex++}`);
      values.push(input.platform);
    }
    if (input.scheduled_at !== undefined) {
      updates.push(`scheduled_at = $${paramIndex++}`);
      values.push(input.scheduled_at ? new Date(input.scheduled_at) : null);
    }
    if (input.started_at !== undefined) {
      updates.push(`started_at = $${paramIndex++}`);
      values.push(input.started_at ? new Date(input.started_at) : null);
    }
    if (input.ended_at !== undefined) {
      updates.push(`ended_at = $${paramIndex++}`);
      values.push(input.ended_at ? new Date(input.ended_at) : null);
    }
    if (input.duration !== undefined) {
      updates.push(`duration = $${paramIndex++}`);
      values.push(input.duration);
    }
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.meeting_url !== undefined) {
      updates.push(`meeting_url = $${paramIndex++}`);
      values.push(input.meeting_url);
    }
    if (input.language !== undefined) {
      updates.push(`language = $${paramIndex++}`);
      values.push(input.language);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // Add updated_at and WHERE clause params
    values.push(id, userId);

    const sql = `UPDATE meetings 
                 SET ${updates.join(", ")}, updated_at = NOW()
                 WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
                 RETURNING *`;

    const updated = await queryOne<Meeting>(sql, values);

    res.json(updated);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error updating meeting:", msg);
    res.status(500).json({ error: err.message || "Failed to update meeting" });
  }
});

/**
 * DELETE /api/meetings/:id
 * Delete a meeting
 */
router.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    // Check if meeting exists and belongs to user
    const existing = await queryOne<Meeting>(
      "SELECT * FROM meetings WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!existing) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Delete meeting (TTS messages will have meeting_id set to NULL due to ON DELETE SET NULL)
    await query("DELETE FROM meetings WHERE id = $1 AND user_id = $2", [id, userId]);

    res.status(204).send();
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error deleting meeting:", msg);
    res.status(500).json({ error: err.message || "Failed to delete meeting" });
  }
});

export default router;
