import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getCreditOverview } from "@/lib/credits";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const overview = await getCreditOverview(session.user.id);
    return NextResponse.json(overview);
  } catch (error) {
    console.error("GET /api/credits/batches error:", error);
    return NextResponse.json({ error: "Failed to fetch credit overview" }, { status: 500 });
  }
}
