import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

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

/**
 * GET /r/{token} — public HTML report view, authorized by share token.
 * No login required; the token IS the credential (192-bit, unguessable).
 * Revocable by the owner via DELETE /api/reports/[id]/share.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;
    if (!/^[a-f0-9]{32,64}$/.test(token)) {
      return htmlResponse(notFoundHtml(), 404);
    }

    const report = await prisma.reportRequest.findUnique({
      where: { shareToken: token },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        resultHtmlPath: true,
      },
    });

    if (!report || report.deletedAt) {
      return htmlResponse(notFoundHtml(), 404);
    }
    if (report.status !== "COMPLETED" && report.status !== "PARTIAL") {
      return htmlResponse(notFoundHtml(), 422);
    }

    const htmlPath = report.resultHtmlPath;
    if (!htmlPath) {
      return htmlResponse(notFoundHtml(), 404);
    }

    // ── S3 mode: stream the object through the server (no expiry, no S3 URL exposure)
    if (!htmlPath.startsWith("local://")) {
      const s3 = getS3Client();
      if (!s3) {
        return htmlResponse(notFoundHtml(), 500);
      }
      try {
        const obj = await s3.send(new GetObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: htmlPath,
        }));
        const bytes = await obj.Body?.transformToByteArray();
        if (!bytes) {
          return htmlResponse(notFoundHtml(), 404);
        }
        return new NextResponse(bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": String(bytes.length),
            "Cache-Control": "private, no-store",
            "X-Robots-Tag": "noindex, nofollow",
          },
        });
      } catch (s3Err) {
        console.error("[share] S3 fetch failed:", s3Err);
        return htmlResponse(notFoundHtml(), 404);
      }
    }

    // ── Local filesystem mode (dev fallback)
    let localPath = htmlPath.replace(/^local:\/\//, "");
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
      return htmlResponse(notFoundHtml(), 403);
    }
    if (!existsSync(resolvedFilePath)) {
      return htmlResponse(notFoundHtml(), 404);
    }

    const stat = statSync(resolvedFilePath);
    const nodeStream = createReadStream(resolvedFilePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(stat.size),
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    console.error("GET /r/[token] error:", error);
    return htmlResponse(notFoundHtml(), 500);
  }
}

function htmlResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="sk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Verifa.sk — Report</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #334155; }
  .box { text-align: center; padding: 2rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { color: #64748b; margin: 0; font-size: .9rem; }
</style>
</head>
<body>
<div class="box">
  <h1>Report sa nenašiel alebo link expiroval</h1>
  <p>Požiadajte odosielateľa o nový zdieľaný link.</p>
</div>
</body>
</html>`;
}
