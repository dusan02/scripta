import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    if (!report) {
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

    let filePath = report.resultFilePath;

    // In Docker, results are shared via volume at /app/results
    // resultFilePath may be /app/results/<id>/evidence_binder.pdf (from worker)
    const resultsDir = process.env.RESULTS_DIR || "/app/results";

    // Strip leading "results/" if RESULTS_DIR already ends with /results (avoids double results/results/)
    if (!path.isAbsolute(filePath) && filePath.startsWith("results/") && resultsDir.endsWith("/results")) {
      filePath = filePath.slice("results/".length);
    }

    const resolvedFilePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(resultsDir, filePath);

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
    filePath = resolvedFilePath;

    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: "Result file not found on disk" },
        { status: 404 }
      );
    }

    const stat = statSync(filePath);
    const nodeStream = createReadStream(filePath);

    // Convert Node.js ReadStream to Web ReadableStream.
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="evidence-binder-${params.id}.pdf"`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/reports/[id]/download error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
