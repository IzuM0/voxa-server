/**
 * Analytics API Routes
 * Provides usage statistics and analytics data
 */

import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth, getUserId } from "../middleware/auth";
import { getPool, query, isDatabaseConnectionError } from "../db";
import type { UsageStats, PlatformStats, VoiceStats, MonthlyUsage } from "../types/database";

const router = Router();

/**
 * GET /api/analytics/stats
 * Get overall usage statistics for the user
 */
router.get("/stats", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    // Single query for meeting stats (count, total duration, avg duration)
    const [meetingsRow, ttsRow] = await Promise.all([
      query<{ count: string; sum_duration: string; avg_duration: string }>(
        `SELECT
           COUNT(*)::text as count,
           COALESCE(SUM(duration), 0)::text as sum_duration,
           COALESCE(AVG(duration), 0)::text as avg_duration
         FROM meetings WHERE user_id = $1`,
        [userId]
      ),
      query<{ sent_count: string; total_chars: string }>(
        `SELECT
           COUNT(CASE WHEN status = 'sent' THEN 1 END)::text as sent_count,
           COALESCE(SUM(text_length), 0)::text as total_chars
         FROM tts_messages WHERE user_id = $1`,
        [userId]
      ),
    ]);

    const m = meetingsRow[0];
    const t = ttsRow[0];
    const totalMeetings = Math.max(0, Number(m?.count) || 0);
    const totalDurationSeconds = Math.max(0, Number(m?.sum_duration) || 0);
    const averageMeetingDurationSeconds = Math.max(0, Number(m?.avg_duration) || 0);
    const totalTtsMessages = Math.max(0, Number(t?.sent_count) || 0);
    const totalCharacters = Math.max(0, Number(t?.total_chars) || 0);

    const stats: UsageStats = {
      total_meetings: totalMeetings,
      total_tts_messages: totalTtsMessages,
      total_characters: totalCharacters,
      total_duration_seconds: totalDurationSeconds,
      average_meeting_duration_seconds: Math.round(averageMeetingDurationSeconds),
    };

    res.json(stats);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching analytics stats:", msg);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({ error: "Database is temporarily unavailable. Check your network and try again." });
    }
    res.status(500).json({ error: err.message || "Failed to fetch analytics stats" });
  }
});

/**
 * GET /api/analytics/platforms
 * Get platform distribution statistics
 */
router.get("/platforms", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    // Get platform counts
    const platformCounts = await query<{ platform: string; count: string }>(
      `SELECT platform, COUNT(*) as count
       FROM meetings
       WHERE user_id = $1
       GROUP BY platform
       ORDER BY count DESC`,
      [userId]
    );

    const total = platformCounts.reduce((sum, p) => sum + (Number(p.count) || 0), 0);

    const stats: PlatformStats[] = platformCounts.map((p) => {
      const count = Math.max(0, Number(p.count) || 0);
      return {
        platform: p.platform as any,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    });

    res.json(stats);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching platform stats:", msg);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({ error: "Database is temporarily unavailable. Check your network and try again." });
    }
    res.status(500).json({ error: err.message || "Failed to fetch platform stats" });
  }
});

/**
 * GET /api/analytics/voices
 * Get voice usage statistics
 */
router.get("/voices", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const voiceCounts = await query<{ voice_used: string; count: string }>(
      `SELECT voice_used, COUNT(*) as count
       FROM tts_messages
       WHERE user_id = $1
       GROUP BY voice_used
       ORDER BY count DESC`,
      [userId]
    );

    const stats: VoiceStats[] = voiceCounts.map((v) => ({
      voice: v.voice_used as any,
      count: Math.max(0, Number(v.count) || 0),
    }));

    res.json(stats);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching voice stats:", msg);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({ error: "Database is temporarily unavailable. Check your network and try again." });
    }
    res.status(500).json({ error: err.message || "Failed to fetch voice stats" });
  }
});

/**
 * GET /api/analytics/monthly
 * Get monthly usage trends
 */
router.get("/monthly", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { months = "6" } = req.query;
    const monthsCount = Math.min(24, Math.max(1, parseInt(months as string, 10) || 6));

    // Get monthly meeting counts
    const monthlyMeetings = await query<{ month: string; count: string }>(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*) as count
       FROM meetings
       WHERE user_id = $1
         AND created_at >= NOW() - ($2 * INTERVAL '1 month')
       GROUP BY TO_CHAR(created_at, 'YYYY-MM')
       ORDER BY month ASC`,
      [userId, monthsCount]
    );

    // Get monthly character usage
    const monthlyChars = await query<{ month: string; sum: string }>(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COALESCE(SUM(text_length), 0) as sum
       FROM tts_messages
       WHERE user_id = $1
         AND created_at >= NOW() - ($2 * INTERVAL '1 month')
       GROUP BY TO_CHAR(created_at, 'YYYY-MM')
       ORDER BY month ASC`,
      [userId, monthsCount]
    );

    // Combine data
    const monthMap = new Map<string, MonthlyUsage>();

    monthlyMeetings.forEach((m) => {
      monthMap.set(m.month, {
        month: m.month,
        meetings: Math.max(0, Number(m.count) || 0),
        characters: 0,
      });
    });

    monthlyChars.forEach((c) => {
      const existing = monthMap.get(c.month) || {
        month: c.month,
        meetings: 0,
        characters: 0,
      };
      existing.characters = Math.max(0, Number(c.sum) || 0);
      monthMap.set(c.month, existing);
    });

    const stats: MonthlyUsage[] = Array.from(monthMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    res.json(stats);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching monthly stats:", msg);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({ error: "Database is temporarily unavailable. Check your network and try again." });
    }
    res.status(500).json({ error: err.message || "Failed to fetch monthly stats" });
  }
});

/**
 * GET /api/analytics/daily-activity
 * Get daily activity pattern (messages per day of week)
 */
router.get("/daily-activity", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    if (!pool) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const activity = await query<{ day: string; count: string }>(
      `SELECT TO_CHAR(created_at, 'Dy') as day, COUNT(*) as count
       FROM tts_messages
       WHERE user_id = $1
       GROUP BY TO_CHAR(created_at, 'Dy'), EXTRACT(DOW FROM created_at)
       ORDER BY EXTRACT(DOW FROM created_at)`,
      [userId]
    );

    res.json(
      activity.map((a) => ({
        day: a.day,
        messages: Math.max(0, Number(a.count) || 0),
      }))
    );
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error fetching daily activity:", msg);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({ error: "Database is temporarily unavailable. Check your network and try again." });
    }
    res.status(500).json({ error: err.message || "Failed to fetch daily activity" });
  }
});

export default router;
