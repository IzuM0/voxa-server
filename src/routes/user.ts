/**
 * User Profile API Routes
 * Handles user profile management (name, avatar)
 * Note: Email and password are managed by Supabase auth
 */

import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth, getUserId } from "../middleware/auth";
import { getPool, query, queryOne, isDatabaseConnectionError } from "../db";

const router = Router();

/**
 * User Profile type
 */
interface UserProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

interface UpdateUserProfileInput {
  display_name?: string;
  avatar_url?: string;
}

/**
 * GET /api/user/profile
 * Get user profile information
 */
router.get("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    let profile = await queryOne<UserProfile>(
      "SELECT * FROM user_profiles WHERE user_id = $1",
      [userId]
    );

    // Create default profile if it doesn't exist
    if (!profile) {
      profile = await queryOne<UserProfile>(
        `INSERT INTO user_profiles (user_id, display_name, avatar_url)
         VALUES ($1, NULL, NULL)
         RETURNING *`,
        [userId]
      );
    }

    res.json(profile);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching user profile:", msg);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({
        error: "Database is temporarily unavailable. Check your network and try again.",
      });
    }
    res.status(500).json({ error: err.message || "Failed to fetch user profile" });
  }
});

/**
 * PUT /api/user/profile
 * Update user profile information
 */
router.put("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const input: UpdateUserProfileInput = req.body;

    // Validate input
    if (input.display_name !== undefined && input.display_name.length > 255) {
      return res.status(400).json({ error: "Display name is too long (max 255 characters)" });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.display_name !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(input.display_name || null);
    }

    if (input.avatar_url !== undefined) {
      updates.push(`avatar_url = $${paramIndex++}`);
      values.push(input.avatar_url || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // Check if profile exists, create if not
    const existing = await queryOne<UserProfile>(
      "SELECT * FROM user_profiles WHERE user_id = $1",
      [userId]
    );

    if (!existing) {
      // Create with defaults, then update
      await query(
        `INSERT INTO user_profiles (user_id, display_name, avatar_url)
         VALUES ($1, NULL, NULL)`,
        [userId]
      );
    }

    // Update profile
    values.push(userId);
    const sql = `UPDATE user_profiles 
                 SET ${updates.join(", ")}, updated_at = NOW()
                 WHERE user_id = $${paramIndex++}
                 RETURNING *`;

    const updated = await queryOne<UserProfile>(sql, values);

    res.json(updated);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error updating user profile:", msg);
    res.status(500).json({ error: err.message || "Failed to update user profile" });
  }
});

/**
 * DELETE /api/user
 * Delete user account and all associated data
 * Note: This only deletes data from our database. Supabase auth user must be deleted separately.
 */
router.delete("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    // Delete user data in order (respecting foreign keys)
    // Note: This is a cascading delete - all user's data will be removed
    
    // Delete TTS messages
    await query("DELETE FROM tts_messages WHERE user_id = $1", [userId]);
    
    // Delete meetings
    await query("DELETE FROM meetings WHERE user_id = $1", [userId]);
    
    // Delete user settings
    await query("DELETE FROM user_settings WHERE user_id = $1", [userId]);
    
    // Delete user profile
    await query("DELETE FROM user_profiles WHERE user_id = $1", [userId]);

    res.status(204).send();
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error deleting user account:", msg);
    res.status(500).json({ error: err.message || "Failed to delete user account" });
  }
});

export default router;
