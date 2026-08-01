import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sanitizeFilename } from "@/lib/sanitize";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy-init S3 client singleton.
let _s3Client: S3Client | null = null;
function getS3Client(): S3Client | null {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;

  if (!_s3Client) {
    _s3Client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _s3Client;
}

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
        { error: "Report is not ready for download", status: report.status },
        { status: 422 }
      );
    }

    if (!report.resultFilePath) {
      return NextResponse.json(
        { error: "Result file path not set" },
        { status: 404 }
      );
    }

    const filePath = report.resultFilePath;
    const filename = sanitizeFilename(req.nextUrl.searchParams.get("filename") || `evidence-binder-${params.id}.pdf`);

    // ── S3 mode: generate presigned URL and redirect ──────────────────────
    // The worker stores the S3 object key (e.g. "reports/{id}/evidence_binder.pdf")
    // in resultFilePath. We generate a short-lived presigned URL (60s) and
    // return a 302 redirect so the browser downloads directly from S3.
    if (!filePath.startsWith("local://")) {
      const s3 = getS3Client();
      if (!s3) {
        return NextResponse.json(
          { error: "S3 storage not configured" },
          { status: 500 }
        );
      }

      const bucket = process.env.S3_BUCKET!;
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: filePath,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      });

      try {
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
        return NextResponse.redirect(presignedUrl, { status: 302 });
      } catch (s3Err) {
        console.error("[download] Presigned URL generation failed:", s3Err);
        return NextResponse.json(
          { error: "Failed to generate download URL" },
          { status: 500 }
        );
      }
    }

    // ── Local filesystem mode (dev fallback) ──────────────────────────────
    // The worker stores a "local://" prefixed path. We strip the prefix and
    // serve the file directly from disk.
    let localPath = filePath.replace(/^local:\/\//, "");

    const resultsDir = process.env.RESULTS_DIR || "/app/results";

    // Strip leading "results/" if RESULTS_DIR already ends with /results
    if (!path.isAbsolute(localPath) && localPath.startsWith("results/") && resultsDir.endsWith("/results")) {
      localPath = localPath.slice("results/".length);
    }

    // Map absolute /app/results/ paths (from worker inside Docker) to local RESULTS_DIR
    if (path.isAbsolute(localPath) && localPath.startsWith("/app/results/")) {
      localPath = localPath.slice("/app/results/".length);
    }

    const resolvedFilePath = path.isAbsolute(localPath)
      ? localPath
      : path.resolve(resultsDir, localPath);

    // Path traversal protection
    const resolvedResultsDir = path.resolve(resultsDir);
    const relativePath = path.relative(resolvedResultsDir, resolvedFilePath);
    if (
      relativePath.startsWith("..") ||
      relativePath.includes("\0") ||
      path.isAbsolute(relativePath)
    ) {
      return NextResponse.json(
        { error: "Invalid file path" },
        { status: 403 }
      );
    }

    if (!existsSync(resolvedFilePath)) {
      return NextResponse.json(
        { error: "Result file not found on disk" },
        { status: 404 }
      );
    }

    const stat = statSync(resolvedFilePath);
    const nodeStream = createReadStream(resolvedFilePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    const disposition = req.nextUrl.searchParams.get("filename") ? "attachment" : "inline";

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/reports/[id]/download error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
