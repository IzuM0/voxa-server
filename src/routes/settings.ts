/**
 * User Settings API Routes
 * Handles user preferences and settings
 */

import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth, getUserId } from "../middleware/auth";
import { getPool, query, queryOne } from "../db";
import type { UserSettings, UpdateUserSettingsInput } from "../types/database";

const router = Router();

/**
 * GET /api/settings
 * Get user settings (or create defaults if they don't exist)
 */
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    let settings = await queryOne<UserSettings>(
      "SELECT * FROM user_settings WHERE user_id = $1",
      [userId]
    );

    // Create default settings if they don't exist
    if (!settings) {
      settings = await queryOne<UserSettings>(
        `INSERT INTO user_settings (user_id, preferred_voice, default_speed, default_pitch, default_language)
         VALUES ($1, 'alloy', 1.0, 1.0, 'en-US')
         RETURNING *`,
        [userId]
      );
    }

    res.json(settings);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching user settings:", msg);
    res.status(500).json({ error: err.message || "Failed to fetch user settings" });
  }
});

/**
 * PUT /api/settings
 * Update user settings
 */
router.put("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const input: UpdateUserSettingsInput = req.body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.preferred_voice !== undefined) {
      const validVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
      if (!validVoices.includes(input.preferred_voice)) {
        return res.status(400).json({ error: "Invalid voice" });
      }
      updates.push(`preferred_voice = $${paramIndex++}`);
      values.push(input.preferred_voice);
    }

    if (input.default_speed !== undefined) {
      if (input.default_speed < 0.5 || input.default_speed > 2.0) {
        return res.status(400).json({ error: "Speed must be between 0.5 and 2.0" });
      }
      updates.push(`default_speed = $${paramIndex++}`);
      values.push(input.default_speed);
    }

    if (input.default_pitch !== undefined) {
      if (input.default_pitch < 0.5 || input.default_pitch > 2.0) {
        return res.status(400).json({ error: "Pitch must be between 0.5 and 2.0" });
      }
      updates.push(`default_pitch = $${paramIndex++}`);
      values.push(input.default_pitch);
    }

    if (input.default_language !== undefined) {
      updates.push(`default_language = $${paramIndex++}`);
      values.push(input.default_language);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // Check if settings exist, create if not
    const existing = await queryOne<UserSettings>(
      "SELECT * FROM user_settings WHERE user_id = $1",
      [userId]
    );

    if (!existing) {
      // Create with defaults, then update
      await query(
        `INSERT INTO user_settings (user_id, preferred_voice, default_speed, default_pitch, default_language)
         VALUES ($1, 'alloy', 1.0, 1.0, 'en-US')`,
        [userId]
      );
    }

    // Update settings
    values.push(userId);
    const sql = `UPDATE user_settings 
                 SET ${updates.join(", ")}, updated_at = NOW()
                 WHERE user_id = $${paramIndex++}
                 RETURNING *`;

    const updated = await queryOne<UserSettings>(sql, values);

    res.json(updated);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error updating user settings:", msg);
    res.status(500).json({ error: err.message || "Failed to update user settings" });
  }
});

export default router;
