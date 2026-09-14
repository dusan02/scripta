import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy-init S3 client singleton (same pattern as download route).
let _s3Client: S3Client | null = null;
function getS3Client(): S3Client | null {
  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !accessKey || !secretKey) return null;

  if (!_s3Client) {
    _s3Client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });
  }
  return _s3Client;
}

const S3_KEY_PATTERN = /^reports\/[a-zA-Z0-9]{20,40}\/[a-zA-Z0-9._-]+$/;
function isValidS3Key(key: string): boolean {
  if (!key || key.length > 512) return false;
  if (key.includes("..") || key.includes("\0")) return false;
  return S3_KEY_PATTERN.test(key);
}

/**
 * GET /api/reports/[id]/html — owner-only inline view of the HTML report.
 * Returns 302 to a short-lived presigned URL (browser renders it in-tab).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const report = await prisma.reportRequest.findUnique({
      where: { id: params.id },
    });

    if (!report || report.deletedAt) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (report.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (report.status !== "COMPLETED" && report.status !== "PARTIAL") {
      return NextResponse.json(
        { error: "Report is not ready", status: report.status },
        { status: 422 }
      );
    }

    if (!report.resultHtmlPath) {
      return NextResponse.json(
        { error: "HTML view not available for this report" },
        { status: 404 }
      );
    }

    const filePath = report.resultHtmlPath;

    // ── S3 mode: presigned inline URL → 302 ──────────────────────────────
    if (!filePath.startsWith("local://")) {
      const s3 = getS3Client();
      if (!s3) {
        return NextResponse.json({ error: "S3 storage not configured" }, { status: 500 });
      }
      if (!isValidS3Key(filePath)) {
        console.error("[html] Invalid S3 key:", filePath);
        return NextResponse.json({ error: "Invalid file path" }, { status: 403 });
      }

      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: filePath,
        ResponseContentType: "text/html; charset=utf-8",
        ResponseContentDisposition: "inline",
      });

      try {
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
        return NextResponse.redirect(presignedUrl, { status: 302 });
      } catch (s3Err) {
        console.error("[html] Presigned URL generation failed:", s3Err);
        return NextResponse.json({ error: "Failed to generate view URL" }, { status: 500 });
      }
    }

    // ── Local filesystem mode (dev fallback) ─────────────────────────────
    let localPath = filePath.replace(/^local:\/\//, "");
    const resultsDir = process.env.RESULTS_DIR || "/app/results";
    if (!path.isAbsolute(localPath) && localPath.startsWith("results/") && resultsDir.endsWith("/results")) {
      localPath = localPath.slice("results/".length);
    }
    if (path.isAbsolute(localPath) && localPath.startsWith("/app/results/")) {
      localPath = localPath.slice("/app/results/".length);
    }
    const resolvedFilePath = path.isAbsolute(localPath)
      ? localPath
      : path.resolve(resultsDir, localPath);
    const resolvedResultsDir = path.resolve(resultsDir);
    const relativePath = path.relative(resolvedResultsDir, resolvedFilePath);
    if (relativePath.startsWith("..") || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 403 });
    }
    if (!existsSync(resolvedFilePath)) {
      return NextResponse.json({ error: "HTML report not found on disk" }, { status: 404 });
    }

    const stat = statSync(resolvedFilePath);
    const nodeStream = createReadStream(resolvedFilePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/reports/[id]/html error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
