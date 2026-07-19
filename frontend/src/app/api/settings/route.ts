import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { SOURCE_IDS } from "@/lib/sources";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { orsrExtractType: true, crzDateFrom: true, rozhodnutiaDateFrom: true, vestnikDateFrom: true, defaultSources: true, reportLanguage: true, attachmentsConfig: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      orsrExtractType: dbUser.orsrExtractType,
      crzDateFrom: dbUser.crzDateFrom?.toISOString().split("T")[0] ?? null,
      rozhodnutiaDateFrom: dbUser.rozhodnutiaDateFrom?.toISOString().split("T")[0] ?? null,
      vestnikDateFrom: dbUser.vestnikDateFrom?.toISOString().split("T")[0] ?? null,
      defaultSources: dbUser.defaultSources,
      reportLanguage: dbUser.reportLanguage,
      attachmentsConfig: dbUser.attachmentsConfig,
    });
  } catch (error) {
    console.error("GET /api/settings error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { orsrExtractType, crzDateFrom, rozhodnutiaDateFrom, vestnikDateFrom, defaultSources, reportLanguage, attachmentsConfig } = body;

    const data: Record<string, unknown> = {};

    if (orsrExtractType !== undefined) {
      if (orsrExtractType !== "CURRENT" && orsrExtractType !== "FULL") {
        return NextResponse.json(
          { error: "orsrExtractType must be 'CURRENT' or 'FULL'" },
          { status: 400 }
        );
      }
      data.orsrExtractType = orsrExtractType;
    }

    if (crzDateFrom !== undefined) {
      if (crzDateFrom === null || crzDateFrom === "") {
        data.crzDateFrom = null;
      } else {
        const parsed = new Date(crzDateFrom);
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "crzDateFrom must be a valid date (YYYY-MM-DD)" },
            { status: 400 }
          );
        }
        data.crzDateFrom = parsed;
      }
    }

    if (rozhodnutiaDateFrom !== undefined) {
      if (rozhodnutiaDateFrom === null || rozhodnutiaDateFrom === "") {
        data.rozhodnutiaDateFrom = null;
      } else {
        const parsed = new Date(rozhodnutiaDateFrom);
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "rozhodnutiaDateFrom must be a valid date (YYYY-MM-DD)" },
            { status: 400 }
          );
        }
        data.rozhodnutiaDateFrom = parsed;
      }
    }

    if (vestnikDateFrom !== undefined) {
      if (vestnikDateFrom === null || vestnikDateFrom === "") {
        data.vestnikDateFrom = null;
      } else {
        const parsed = new Date(vestnikDateFrom);
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "vestnikDateFrom must be a valid date (YYYY-MM-DD)" },
            { status: 400 }
          );
        }
        data.vestnikDateFrom = parsed;
      }
    }

    if (defaultSources !== undefined) {
      if (!Array.isArray(defaultSources)) {
        return NextResponse.json(
          { error: "defaultSources must be an array of strings" },
          { status: 400 }
        );
      }
      const allowedSources = new Set(SOURCE_IDS);
      const validSources = defaultSources.filter((s: unknown) => typeof s === "string" && allowedSources.has(s as string));
      if (validSources.length === 0 && defaultSources.length > 0) {
        return NextResponse.json(
          { error: "defaultSources contains no valid source IDs" },
          { status: 400 }
        );
      }
      data.defaultSources = validSources;
    }

    if (reportLanguage !== undefined) {
      const normalizedLang = typeof reportLanguage === "string" ? reportLanguage.toLowerCase() : null;
      if (!normalizedLang || !["sk", "en", "de"].includes(normalizedLang)) {
        return NextResponse.json(
          { error: "reportLanguage must be 'sk', 'en', or 'de'" },
          { status: 400 }
        );
      }
      data.reportLanguage = normalizedLang;
    }

    if (attachmentsConfig !== undefined) {
      if (attachmentsConfig === null) {
        data.attachmentsConfig = null;
      } else if (typeof attachmentsConfig === "object" && !Array.isArray(attachmentsConfig)) {
        const validKeys = ["obchodny_register", "zivnostensky_register", "auditorska_sprava", "uctovna_zavierka_a_poznámky"];
        const filtered: Record<string, boolean> = {};
        for (const [key, val] of Object.entries(attachmentsConfig)) {
          if (validKeys.includes(key) && typeof val === "boolean") {
            filtered[key] = val;
          }
        }
        data.attachmentsConfig = filtered;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data,
    });

    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    console.error("PATCH /api/settings error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
