/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse and enforces usage limits
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth';

/**
 * Rate limiter for TTS endpoint
 * Limits: Configurable via TTS_RATE_LIMIT_MAX (default: 50 for dev, 10 for production)
 * This prevents API quota exhaustion and abuse
 */
const TTS_RATE_LIMIT_MAX = process.env.TTS_RATE_LIMIT_MAX 
  ? parseInt(process.env.TTS_RATE_LIMIT_MAX, 10) 
  : (process.env.NODE_ENV === 'production' ? 10 : 50); // More lenient for development

const TTS_RATE_LIMIT_WINDOW_MS = process.env.TTS_RATE_LIMIT_WINDOW_MS
  ? parseInt(process.env.TTS_RATE_LIMIT_WINDOW_MS, 10)
  : 15 * 60 * 1000; // 15 minutes

export const ttsRateLimiter = rateLimit({
  windowMs: TTS_RATE_LIMIT_WINDOW_MS,
  max: TTS_RATE_LIMIT_MAX,
  message: {
    error: 'Too many TTS requests',
    message: `Please wait ${Math.ceil(TTS_RATE_LIMIT_WINDOW_MS / 60000)} minutes before making more requests. Consider upgrading your plan for higher limits.`,
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req: Request) => {
    // Skip rate limiting in development if DISABLE_RATE_LIMIT is set
    if (process.env.DISABLE_RATE_LIMIT === 'true' && process.env.NODE_ENV !== 'production') {
      return true;
    }
    return false; // Rate limit everyone, but use user ID if available
  },
  keyGenerator: (req: Request) => {
    // Use user ID for rate limiting (so limits are per-user)
    // Fall back to IP address for unauthenticated requests (using IPv6-safe helper)
    const authReq = req as AuthenticatedRequest;
    if (authReq.userId) {
      return authReq.userId;
    }
    // ipKeyGenerator(ip: string) — pass request IP for proper IPv6 handling
    return ipKeyGenerator(req.ip ?? 'unknown');
  },
  handler: (req: Request, res) => {
    const windowMinutes = Math.ceil(TTS_RATE_LIMIT_WINDOW_MS / 60000);
    res.status(429).json({
      error: 'Too many TTS requests',
      message: `Please wait ${windowMinutes} minute${windowMinutes !== 1 ? 's' : ''} before making more requests. Consider upgrading your plan for higher limits.`,
      retryAfter: Math.ceil(TTS_RATE_LIMIT_WINDOW_MS / 1000), // seconds
      limit: TTS_RATE_LIMIT_MAX,
      window: windowMinutes,
    });
  },
});

/**
 * General API rate limiter
 * Limits: 100 requests per 15 minutes per IP/user
 * Applied to all API endpoints
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: 'Too many API requests',
    message: 'Please wait before making more requests.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    if (authReq.userId) {
      return authReq.userId;
    }
    return ipKeyGenerator(req.ip ?? 'unknown');
  },
});
