import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLangFromHeaders, generatePageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  return generatePageMetadata("pricing", lang);
}

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
