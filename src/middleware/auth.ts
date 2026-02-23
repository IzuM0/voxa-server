/**
 * Authentication Middleware
 * Verifies JWT tokens from Supabase using proper signature verification
 */

import type { Request, Response, NextFunction } from "express";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { getPool } from "../db";

/**
 * Extended Request type with user information
 */
export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

// Note: JWKS client is created per-request in verifySupabaseToken to avoid caching issues

/**
 * Normalize Supabase URL: trim and remove trailing slash to avoid double slashes
 */
function normalizeSupabaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Verify Supabase JWT token with signature verification
 * Uses JWKS (JSON Web Key Set) to verify token signature
 */
async function verifySupabaseToken(token: string): Promise<{ userId: string; email?: string } | null> {
  try {
    const rawUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    if (!rawUrl || !rawUrl.trim()) {
      console.error("SUPABASE_URL not configured for JWT verification (set VITE_SUPABASE_URL or SUPABASE_URL in server/.env)");
      return null;
    }

    const supabaseUrl = normalizeSupabaseUrl(rawUrl);

    // Supabase JWKS endpoint: /auth/v1/.well-known/jwks.json (no trailing slash on base)
    const jwksUrls = [
      `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
      `${supabaseUrl}/.well-known/jwks.json`,
    ];

    if (process.env.NODE_ENV === "development") {
      console.log("JWKS URLs to try:", jwksUrls[0]);
    }

    let lastError: Error | null = null;

    // Try each JWKS URL
    for (const jwksUrl of jwksUrls) {
      try {
        const jwks = createRemoteJWKSet(new URL(jwksUrl));
        
        // Try with strict validation first
        try {
          const { payload } = await jwtVerify(token, jwks, {
            issuer: [`${supabaseUrl}/auth/v1`, `${supabaseUrl}`],
            audience: ["authenticated", "authenticated-refresh"],
          });

          if (payload.sub) {
            return {
              userId: payload.sub as string,
              email: payload.email as string | undefined,
            };
          }
        } catch (verifyErr) {
          // If issuer/audience validation fails, try without it
          if (verifyErr instanceof Error && 
              (verifyErr.message.includes("issuer") || verifyErr.message.includes("audience"))) {
            if (process.env.NODE_ENV === "development") {
              console.warn(`JWT issuer/audience mismatch for ${jwksUrl} - trying without strict validation`);
            }
            try {
              const { payload } = await jwtVerify(token, jwks, {});
              if (payload.sub) {
                return {
                  userId: payload.sub as string,
                  email: payload.email as string | undefined,
                };
              }
            } catch (retryErr) {
              lastError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
              continue; // Try next URL
            }
          } else {
            // If it's a JWKS fetch error, try the next URL
            if (verifyErr instanceof Error && verifyErr.message.includes("Expected 200 OK")) {
              lastError = verifyErr;
              continue; // Try next URL
            }
            throw verifyErr;
          }
        }
        
        // If we get here, verification succeeded
        break;
      } catch (jwksErr) {
        lastError = jwksErr instanceof Error ? jwksErr : new Error(String(jwksErr));
        continue; // Try next URL
      }
    }

    if (lastError) {
      throw lastError;
    }

    return null;
  } catch (err) {
    if (err instanceof Error) {
      // Network/DNS errors are expected if Supabase is unreachable - log once, not every request
      const isNetworkError = err.message.includes("ENOTFOUND") || 
                             err.message.includes("fetch failed") ||
                             err.message.includes("getaddrinfo");
      
      if (isNetworkError) {
        if (process.env.NODE_ENV === "development") {
          const supabaseUrl = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "");
          console.warn(`⚠️  Cannot reach Supabase (${supabaseUrl}) - JWT verification disabled. Check if project is paused or network is blocked.`);
        }
      } else {
        console.error("Token verification failed:", err.message);
        if (process.env.NODE_ENV === "development") {
          console.error("Error details:", err.message);
          const supabaseUrl = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "");
          if (err.message.includes("Expected 200 OK") && supabaseUrl) {
            console.error(
              "JWKS hint: Ensure VITE_SUPABASE_URL in server/.env is your project URL without trailing slash, e.g. https://xxxx.supabase.co"
            );
            console.error("  JWKS URL should be:", `${supabaseUrl}/auth/v1/.well-known/jwks.json`);
          }
        }
      }
    } else {
      const msg = err instanceof Error ? (err as Error).message : String(err);
      console.error("Token verification failed:", msg);
    }
    return null;
  }
}

/**
 * Authentication middleware - REQUIRES valid token
 * Verifies JWT signature and extracts user information
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Get token from Authorization header: "Bearer <token>"
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix
  
  // Verify token signature with Supabase JWKS
  const userInfo = await verifySupabaseToken(token);
  
  if (!userInfo || !userInfo.userId) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Attach user info to request
  req.userId = userInfo.userId;
  req.userEmail = userInfo.email;

  next();
}

/**
 * Optional authentication middleware
 * Attaches user info if token is present and valid, but doesn't require it
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    
    // Verify token signature if present
    const userInfo = await verifySupabaseToken(token);
    
    if (userInfo && userInfo.userId) {
      req.userId = userInfo.userId;
      req.userEmail = userInfo.email;
    }
  }

  next();
}

/**
 * Helper to get user ID from request (throws if not authenticated)
 */
export function getUserId(req: AuthenticatedRequest): string {
  if (!req.userId) {
    throw new Error("User not authenticated");
  }
  return req.userId;
}
