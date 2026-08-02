import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Log an admin action to the AdminAuditLog table.
 *
 * @param adminUserId - The ID of the admin performing the action
 * @param action - The action type (e.g., "MESSAGE_SEND", "FEEDBACK_UPDATE")
 * @param targetId - Optional ID of the target entity (e.g., userId, feedbackId)
 * @param metadata - Optional additional context
 * @param req - Optional NextRequest for IP/user-agent extraction
 */
export async function logAdminAction(
  adminUserId: string,
  action: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
  req?: NextRequest
): Promise<void> {
  try {
    const ipAddress = req
      ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null
      : null;

    await prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        targetId: targetId || null,
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        ipAddress,
      },
    });
  } catch (error) {
    // Audit logging should never break the main operation
    console.error("[AUDIT] Failed to log admin action:", error);
  }
}
