import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { verifyCronSecret } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// POST /api/revalidate
// Invalidates ISR cache for firma profiles after design changes or data updates.
//
// Body: { "type": "all" | "path", "path"?: "/firma/12345678" }
//
// Auth: Bearer token via CRON_SECRET env var (same as cron endpoints)
// Rate limit: 10 calls per hour (design changes are infrequent)
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimitByKey("revalidate", {
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  let body: { type?: string; path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const type = body.type || "all";

  if (type === "path" && body.path) {
    revalidatePath(body.path);
    return NextResponse.json({ revalidated: true, path: body.path });
  }

  // Revalidate all firma profiles + sitemap
  revalidatePath("/firma", "layout");
  revalidatePath("/sitemap.xml");
  revalidateTag("firma-profile");
  return NextResponse.json({ revalidated: true, scope: "all-firma" });
}
