import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

export const dynamicParams = true;

type Params = { params: Promise<{ ico: string }> };

export async function generateMetadata({ params }: Params) {
  const { ico } = await params;
  if (!/^\d{8,10}$/.test(ico)) return {};

  const company = await prisma.company.findUnique({ where: { ico } });
  if (!company) return {};

  return {
    title: `${company.name || `IČO ${ico}`} (${ico}) — Business Risk Report | Verifa.sk`,
    description: `Automatizovaný forenzný report pre ${company.name || `IČO ${ico}`} (${ico}). Preverte si finančné zdravie a rizikové faktory.`,
    robots: { index: true, follow: true },
  };
}

export default async function IcoRedirectPage({ params }: Params) {
  const { ico } = await params;

  if (!/^\d{8,10}$/.test(ico)) {
    notFound();
  }

  const company = await prisma.company.findUnique({ where: { ico } });

  if (!company) {
    redirect(`/dashboard?ico=${ico}`);
  }

  const slug = slugify(company.name);
  redirect(`/firma/${ico}-${slug}`);
}
