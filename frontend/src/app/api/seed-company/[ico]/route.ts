import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { seedFromRuz } from "@/lib/ruz";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Admin-triggered RÚZ seed for a single company.
 *
 * Delegates to the single shared parser (lib/ruz.ts::seedFromRuz) — the same
 * battle-tested code path the cron reseed-all job uses over 500k companies.
 * This route previously contained a duplicated `any`-typed parser that had
 * drifted from the shared one; it was removed so that parsing invariants
 * (balance-sheet check, dataQualityStatus, PARSER_ERROR marking) are
 * enforced in exactly one place.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ico: string }> }
) {
  const [, error] = await requireAdmin(req);
  if (error) return error;

  const { ico } = await params;
  if (!/^\d{8,10}$/.test(ico)) {
    return NextResponse.json({ error: "Invalid IČO format" }, { status: 400 });
  }

  try {
    const company = await seedFromRuz(ico);
    if (!company) {
      return NextResponse.json({ success: false, error: "Entity not found in RÚZ" }, { status: 404 });
    }

    const stmts = company.financialStatements;
    return NextResponse.json({
      success: true,
      company: {
        name: company.name,
        ico: company.ico,
        city: company.city,
        legalForm: company.legalForm,
      },
      statements: stmts.length,
      fsCount: company.fsCount,
      years: stmts.map((s) => s.year),
      dataQuality: stmts.map((s) => ({ year: s.year, status: s.dataQualityStatus })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Seed failed";
    console.error(`[seed-company] ${ico} failed:`, error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
