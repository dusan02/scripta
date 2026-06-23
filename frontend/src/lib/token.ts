import crypto from "crypto";

/**
 * Hash a token using SHA-256 before storing in the database.
 * This ensures that even if the database is compromised,
 * the raw tokens (sent via email) cannot be recovered.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
